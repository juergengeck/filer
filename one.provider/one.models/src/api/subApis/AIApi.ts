/**
 * AI API for ONE.models
 * Provides AI assistant functionality integrated with ONE.core
 */

import type Models from '../utils/Models.js';
import type { OneApi } from '../utils/types.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { ChatMessage } from '../../recipes/ChatRecipes.js';

export interface AIModel {
    id: string;
    name: string;
    displayName?: string;
    provider?: string;
    personId?: SHA256IdHash<Person>;
}

export interface AIResponse {
    text: string;
    modelId: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface AIApiConfig {
    enableAutoResponses?: boolean;
    defaultModel?: string;
    temperature?: number;
    maxTokens?: number;
}

export default class AIApi {
    private one: OneApi;
    private models: Models;
    private config: AIApiConfig;
    private aiModels: Map<string, AIModel>;
    private aiPersonIds: Map<string, SHA256IdHash<Person>>;
    private messageListener: any;

    constructor(one: OneApi, models: Models) {
        this.one = one;
        this.models = models;
        this.config = {};
        this.aiModels = new Map();
        this.aiPersonIds = new Map();
    }

    /**
     * Initialize the AI API
     */
    async init(config?: AIApiConfig): Promise<void> {
        this.config = config || {};
        
        // Initialize AI models registry
        await this.loadAvailableModels();
        
        // Set up message listener if auto-responses are enabled
        if (this.config.enableAutoResponses) {
            await this.setupMessageListener();
        }
    }

    /**
     * Shutdown the AI API
     */
    async shutdown(): Promise<void> {
        if (this.messageListener) {
            this.messageListener.stop();
            this.messageListener = null;
        }
    }

    /**
     * Register an AI model with the system
     */
    async registerAIModel(model: AIModel): Promise<SHA256IdHash<Person>> {
        // Create or get Person ID for the AI model
        const personId = await this.createAIPersonId(model);
        
        // Store model information
        this.aiModels.set(model.id, { ...model, personId });
        this.aiPersonIds.set(model.id, personId);
        
        // Create contact for the AI if Leute is available
        try {
            const leuteModel = this.models.getLeuteModel();
            await this.createAIContact(model, personId);
        } catch (e) {
            // LeuteModel not initialized, skip contact creation
        }
        
        return personId;
    }

    /**
     * Get all registered AI models
     */
    getAIModels(): AIModel[] {
        return Array.from(this.aiModels.values());
    }

    /**
     * Get AI model by ID
     */
    getAIModel(modelId: string): AIModel | undefined {
        return this.aiModels.get(modelId);
    }

    /**
     * Check if a person ID belongs to an AI
     */
    isAIPerson(personId: SHA256IdHash<Person>): boolean {
        const personIdStr = personId.toString();
        return Array.from(this.aiPersonIds.values()).some(
            id => id.toString() === personIdStr
        );
    }

    /**
     * Send a message as an AI to a topic
     */
    async sendAIMessage(
        topicId: string,
        text: string,
        modelId: string
    ): Promise<void> {
        const model = this.aiModels.get(modelId);
        if (!model || !model.personId) {
            throw new Error(`AI model ${modelId} not registered or missing personId`);
        }

        // Create AI message with proper identity
        const message = await this.createAIMessage(text, model.personId, topicId, modelId);

        // Post to channel with AI as owner
        await this.models.getChannelManager().postToChannel(
            topicId,
            message,
            model.personId
        );
    }

    /**
     * Generate an AI response for a user message
     */
    async generateResponse(
        userMessage: string,
        modelId: string,
        context?: any[]
    ): Promise<AIResponse> {
        // This would integrate with the actual LLM service
        // For now, return a placeholder
        return {
            text: `[AI Response from ${modelId}]: This is a placeholder response`,
            modelId,
            timestamp: Date.now()
        };
    }

    /**
     * Create or retrieve a topic for AI conversation
     */
    async getOrCreateAITopic(modelId: string): Promise<string> {
        const model = this.aiModels.get(modelId);
        if (!model || !model.personId) {
            throw new Error(`AI model ${modelId} not registered`);
        }

        // Get current user's person ID
        const myPersonId = await this.models.getLeuteModel().myMainIdentity();
        
        // Create 1-to-1 topic between user and AI
        const topic = await this.models.getTopicModel().createOneToOneTopic(
            myPersonId,
            model.personId
        );
        
        return topic.id;
    }

    // Private helper methods

    private async createAIPersonId(model: AIModel): Promise<SHA256IdHash<Person>> {
        const { calculateIdHashOfObj } = await import('@refinio/one.core/lib/util/object.js');
        const { ensureIdHash } = await import('@refinio/one.core/lib/util/type-checks.js');
        
        const personObj: Person = {
            $type$: 'Person' as const,
            email: `${model.id.replace(/[^a-z0-9]/gi, '-')}@ai.local`,
            name: model.displayName || model.name
        };
        
        const idHash = await calculateIdHashOfObj(personObj);
        return ensureIdHash<Person>(idHash);
    }

    private async createAIContact(model: AIModel, personId: SHA256IdHash<Person>): Promise<void> {
        try {
            // Check if Someone already exists
            const existing = await this.models.getLeuteModel().getSomeone(personId);
            if (existing) {
                return;
            }
        } catch (e) {
            // Someone doesn't exist, create it
        }

        // Create Profile and Someone for AI
        const ProfileModel = (await import('../../models/Leute/ProfileModel.js')).default;
        const profile = await ProfileModel.constructWithNewProfile(
            personId,
            await this.models.getLeuteModel().myMainIdentity(),
            'default'
        );

        // Add display name
        profile.personDescriptions.push({
            $type$: 'PersonName',
            name: model.displayName || model.name
        });

        await profile.saveAndLoad();

        // Create Someone
        const SomeoneModel = (await import('../../models/Leute/SomeoneModel.js')).default;
        const someone = await SomeoneModel.constructWithNewSomeone(
            this.models.getLeuteModel(),
            `ai-${model.id}`,
            profile
        );

        // Add to contacts
        await this.models.getLeuteModel().addSomeoneElse(someone.idHash);
    }

    private async createAIMessage(
        text: string,
        senderId: SHA256IdHash<Person>,
        topicId: string,
        modelId: string
    ): Promise<ChatMessage> {
        // Strip thinking tags if present
        const visibleText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || text;
        
        return {
            $type$: 'ChatMessage',
            text: visibleText,
            sender: senderId,
            attachments: undefined
        };
    }

    private async loadAvailableModels(): Promise<void> {
        // Load models from configuration or external source
        // This is a placeholder - actual implementation would load from LLM service
    }

    private async setupMessageListener(): Promise<void> {
        // Set up listener for messages in AI topics
        // This would integrate with ChannelManager.onUpdated
    }
}