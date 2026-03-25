/**
 * ChatApi - Unified API for chat operations
 *
 * Combines StoryChatPlan, StoryTopicPlan, and ChatQueries into a single
 * API with event emission for UI subscriptions.
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, HashGroup } from '@refinio/one.core/lib/recipes.js';
import type { VersionedObjectResult } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { operationRegistry } from '@refinio/api/registry';
import type { ChatMessage } from '../recipes/ChatMessageRecipe.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type {
    QueryOptions,
    TimeRange,
    MessageWithMetadata,
    ReactionGroup,
    CubeQueryEngine
} from '../queries/ChatQueries.js';
import {
    ChatEventEmitter,
    type ChatEvent,
    type ChatEventType,
    type ChatEventHandler
} from './ChatEvents.js';

// ============================================================================
// Forward declarations
// ============================================================================

interface Story {
    $type$: 'Story';
    id: string;
}

interface Plan {
    $type$: 'Plan';
    id: string;
}

interface Dimension {
    $type$: 'Dimension';
    name: string;
}

// ============================================================================
// Dependency Interfaces
// ============================================================================

/**
 * StoryFactory interface for wrapping operations
 */
export interface StoryFactory {
    wrapExecution<T>(
        metadata: ExecutionMetadata,
        operation: () => Promise<OperationResult<T>>
    ): Promise<ExecutionResult<T>>;
}

export interface PlanDefinition {
    id: string;
    name: string;
    description?: string;
    domain?: string;
    demandPatterns?: any[];
    supplyPatterns?: any[];
}

export interface ExecutionMetadata {
    title: string;
    planId: SHA256IdHash<Plan>;
    planTypeName: string;
    owner: SHA256IdHash<Person>;
    instanceVersion: string;
}

export interface OperationResult<T> {
    result: T;
    productHash: SHA256Hash<any>;
}

export interface ExecutionResult<T> {
    result: T;
    storyId?: SHA256IdHash<Story>;
    assemblyId?: SHA256IdHash<any>;
}

/**
 * Storage dependencies
 */
export interface ChatApiDeps {
    storeVersionedObject: <T>(obj: T) => Promise<VersionedObjectResult<T>>;
    storeUnversionedObject: <T>(obj: T) => Promise<{ hash: SHA256Hash<T> }>;
    getObjectByIdHash: <T>(idHash: SHA256IdHash<T>) => Promise<{ obj: T; hash: SHA256Hash<T> }>;
    getObject: <T>(hash: SHA256Hash<T>) => Promise<T>;
    calculateIdHashOfObj: <T>(obj: T) => Promise<SHA256IdHash<T>>;
    getAllVersions?: <T>(idHash: SHA256IdHash<T>) => Promise<T[]>;
}

/**
 * Dimension registry for cube indexing
 */
export interface DimensionRegistry {
    getDimensionHash(name: string): Promise<SHA256Hash<Dimension>>;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Message operations
export interface SendMessageRequest {
    topicIdHash: SHA256IdHash<Topic>;
    content: string;
    replyTo?: SHA256Hash<ChatMessage>;
    attachments?: SHA256Hash<any>[];
}

export interface SendMessageResponse {
    messageHash: SHA256Hash<ChatMessage>;
    messageIdHash: SHA256IdHash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface EditMessageRequest {
    messageIdHash: SHA256IdHash<ChatMessage>;
    newContent: string;
}

export interface EditMessageResponse {
    messageHash: SHA256Hash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface DeleteMessageRequest {
    messageIdHash: SHA256IdHash<ChatMessage>;
    reason?: string;
}

export interface DeleteMessageResponse {
    messageHash: SHA256Hash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

// Reaction operations
export interface AddReactionRequest {
    targetMessageHash: SHA256Hash<ChatMessage>;
    reaction: string;
}

export interface AddReactionResponse {
    reactionHash: SHA256Hash<ChatMessage>;
    reactionIdHash: SHA256IdHash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface RemoveReactionRequest {
    reactionIdHash: SHA256IdHash<ChatMessage>;
}

export interface RemoveReactionResponse {
    messageHash: SHA256Hash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

// Topic operations
export interface CreateTopicRequest {
    name: string;
    participants: SHA256IdHash<Person>[];
}

export interface CreateTopicResponse {
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface RenameTopicRequest {
    topicIdHash: SHA256IdHash<Topic>;
    newName: string;
}

export interface RenameTopicResponse {
    topicHash: SHA256Hash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface AddParticipantRequest {
    topicIdHash: SHA256IdHash<Topic>;
    participant: SHA256IdHash<Person>;
}

export interface AddParticipantResponse {
    topicHash: SHA256Hash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface RemoveParticipantRequest {
    topicIdHash: SHA256IdHash<Topic>;
    participant: SHA256IdHash<Person>;
}

export interface RemoveParticipantResponse {
    topicHash: SHA256Hash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

// ============================================================================
// Plan Constants
// ============================================================================

const CHAT_PLAN: PlanDefinition = {
    id: 'ChatPlan',
    name: 'Chat Plan',
    description: 'Creates and manages chat messages using Story + Cube architecture',
    domain: 'chat',
    supplyPatterns: [{ type: 'ChatMessage', description: 'Chat messages' }]
};

const TOPIC_PLAN: PlanDefinition = {
    id: 'TopicPlan',
    name: 'Topic Plan',
    description: 'Creates and manages conversation topics using Story + Cube architecture',
    domain: 'chat',
    supplyPatterns: [{ type: 'Topic', description: 'Conversation topics' }]
};

// ============================================================================
// ChatApi Implementation
// ============================================================================

/**
 * ChatApi - Unified API for chat operations with event emission
 *
 * Usage:
 * ```typescript
 * const api = new ChatApi(storyFactory, deps, cube, owner);
 * await api.init();
 *
 * // Subscribe to events
 * api.on('messageCreated', (event) => {
 *     console.log('New message:', event.content);
 * });
 *
 * // Send a message
 * const result = await api.sendMessage({
 *     topicIdHash,
 *     content: 'Hello world!'
 * });
 *
 * // Query messages
 * const messages = await api.getMessagesInTopic(topicIdHash);
 * ```
 */
export class ChatApi {
    private chatPlanIdHash: SHA256IdHash<Plan> | undefined;
    private topicPlanIdHash: SHA256IdHash<Plan> | undefined;
    private events: ChatEventEmitter;
    private instanceVersion: string;

    constructor(
        private storyFactory: StoryFactory,
        private deps: ChatApiDeps,
        private cube: CubeQueryEngine | undefined,
        private owner: SHA256IdHash<Person>,
        instanceVersion: string = '1.0.0'
    ) {
        this.events = new ChatEventEmitter();
        this.instanceVersion = instanceVersion;
    }

    /**
     * Initialize the API - registers plans with StoryFactory
     */
    async init(): Promise<void> {
        this.chatPlanIdHash = await operationRegistry.resolvePlanId(CHAT_PLAN);
        this.topicPlanIdHash = await operationRegistry.resolvePlanId(TOPIC_PLAN);
    }

    /**
     * Ensure API is initialized
     */
    private ensureInitialized(): void {
        if (!this.chatPlanIdHash || !this.topicPlanIdHash) {
            throw new Error('ChatApi not initialized. Call init() first.');
        }
    }

    // ========================================================================
    // Event Subscription
    // ========================================================================

    /**
     * Subscribe to a specific event type
     */
    on<T extends ChatEventType>(
        type: T,
        handler: ChatEventHandler<Extract<ChatEvent, { type: T }>>
    ): () => void {
        return this.events.on(type, handler);
    }

    /**
     * Subscribe to all events
     */
    onAny(handler: ChatEventHandler): () => void {
        return this.events.onAny(handler);
    }

    /**
     * Unsubscribe from events
     */
    off<T extends ChatEventType>(
        type: T,
        handler: ChatEventHandler<Extract<ChatEvent, { type: T }>>
    ): void {
        this.events.off(type, handler);
    }

    /**
     * Get the event emitter for advanced usage
     */
    getEventEmitter(): ChatEventEmitter {
        return this.events;
    }

    // ========================================================================
    // Message Operations
    // ========================================================================

    /**
     * Send a new message
     */
    async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Message in ${String(request.topicIdHash).substring(0, 8)}`,
                planId: this.chatPlanIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const message: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: crypto.randomUUID(),
                    topic: request.topicIdHash,
                    content: request.content,
                    replyTo: request.replyTo,
                    attachments: request.attachments
                };

                const stored = await this.deps.storeVersionedObject(message);

                return {
                    result: {
                        messageHash: stored.hash,
                        messageIdHash: stored.idHash
                    },
                    productHash: stored.hash
                };
            }
        );

        const response: SendMessageResponse = {
            messageHash: result.result.messageHash,
            messageIdHash: result.result.messageIdHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'messageCreated',
            timestamp: Date.now(),
            actor: this.owner,
            messageHash: response.messageHash,
            messageIdHash: response.messageIdHash,
            topicIdHash: request.topicIdHash,
            storyIdHash: response.storyIdHash,
            content: request.content,
            replyTo: request.replyTo
        });

        return response;
    }

    /**
     * Edit a message
     */
    async editMessage(request: EditMessageRequest): Promise<EditMessageResponse> {
        this.ensureInitialized();

        // Load current message for event
        const current = await this.deps.getObjectByIdHash<ChatMessage>(request.messageIdHash);
        const previousContent = current.obj.content;

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Edit message',
                planId: this.chatPlanIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const updated: ChatMessage = {
                    ...current.obj,
                    content: request.newContent
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: { messageHash: stored.hash },
                    productHash: stored.hash
                };
            }
        );

        const response: EditMessageResponse = {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'messageEdited',
            timestamp: Date.now(),
            actor: this.owner,
            messageHash: response.messageHash,
            messageIdHash: request.messageIdHash,
            storyIdHash: response.storyIdHash,
            newContent: request.newContent,
            previousContent
        });

        return response;
    }

    /**
     * Delete a message
     */
    async deleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
        this.ensureInitialized();

        const current = await this.deps.getObjectByIdHash<ChatMessage>(request.messageIdHash);

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Delete message',
                planId: this.chatPlanIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const tombstone: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: current.obj.id,
                    topic: current.obj.topic,
                    replyTo: current.obj.replyTo,
                    reaction: current.obj.reaction,
                    content: undefined,
                    attachments: undefined,
                    deleted: true,
                    deletedReason: request.reason
                };

                const stored = await this.deps.storeVersionedObject(tombstone);

                return {
                    result: { messageHash: stored.hash },
                    productHash: stored.hash
                };
            }
        );

        const response: DeleteMessageResponse = {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'messageDeleted',
            timestamp: Date.now(),
            actor: this.owner,
            messageHash: response.messageHash,
            messageIdHash: request.messageIdHash,
            storyIdHash: response.storyIdHash,
            reason: request.reason
        });

        return response;
    }

    // ========================================================================
    // Reaction Operations
    // ========================================================================

    /**
     * Add a reaction to a message
     */
    async addReaction(request: AddReactionRequest): Promise<AddReactionResponse> {
        this.ensureInitialized();

        // Get target message to get topic
        const targetMessage = await this.deps.getObject<ChatMessage>(request.targetMessageHash);

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Reaction ${request.reaction}`,
                planId: this.chatPlanIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const reaction: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: crypto.randomUUID(),
                    topic: targetMessage.topic,
                    replyTo: request.targetMessageHash,
                    reaction: request.reaction
                };

                const stored = await this.deps.storeVersionedObject(reaction);

                return {
                    result: {
                        reactionHash: stored.hash,
                        reactionIdHash: stored.idHash
                    },
                    productHash: stored.hash
                };
            }
        );

        const response: AddReactionResponse = {
            reactionHash: result.result.reactionHash,
            reactionIdHash: result.result.reactionIdHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'reactionAdded',
            timestamp: Date.now(),
            actor: this.owner,
            reactionHash: response.reactionHash,
            reactionIdHash: response.reactionIdHash,
            targetMessageHash: request.targetMessageHash,
            topicIdHash: targetMessage.topic,
            storyIdHash: response.storyIdHash,
            reaction: request.reaction
        });

        return response;
    }

    /**
     * Remove a reaction
     */
    async removeReaction(request: RemoveReactionRequest): Promise<RemoveReactionResponse> {
        this.ensureInitialized();

        const current = await this.deps.getObjectByIdHash<ChatMessage>(request.reactionIdHash);

        if (!current.obj.reaction) {
            throw new Error('Message is not a reaction');
        }

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Remove reaction',
                planId: this.chatPlanIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const updated: ChatMessage = {
                    ...current.obj,
                    reaction: undefined
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: { messageHash: stored.hash },
                    productHash: stored.hash
                };
            }
        );

        const response: RemoveReactionResponse = {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'reactionRemoved',
            timestamp: Date.now(),
            actor: this.owner,
            reactionHash: response.messageHash,
            reactionIdHash: request.reactionIdHash,
            targetMessageHash: current.obj.replyTo!,
            storyIdHash: response.storyIdHash
        });

        return response;
    }

    // ========================================================================
    // Topic Operations
    // ========================================================================

    /**
     * Create a new topic
     */
    async createTopic(request: CreateTopicRequest): Promise<CreateTopicResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Create topic: ${request.name}`,
                planId: this.topicPlanIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Ensure owner is in participants
                const allParticipants = new Set(request.participants);
                allParticipants.add(this.owner);

                // Create HashGroup
                const hashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: allParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(hashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                // Grant access to the HashGroup object itself so it can sync via CHUM
                const {createAccess} = await import('@refinio/one.core/lib/access.js');
                const {SET_ACCESS_MODE} = await import('@refinio/one.core/lib/storage-base-common.js');
                await createAccess([{
                    object: participantsHash,
                    person: [],
                    hashGroup: [participantsHash],
                    mode: SET_ACCESS_MODE.ADD
                }]);

                // Create Topic
                const topic: Topic = {
                    $type$: 'Topic',
                    id: crypto.randomUUID(),
                    name: request.name,
                    participants: participantsHash
                };

                const stored = await this.deps.storeVersionedObject(topic);

                return {
                    result: {
                        topicHash: stored.hash,
                        topicIdHash: stored.idHash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        const response: CreateTopicResponse = {
            topicHash: result.result.topicHash,
            topicIdHash: result.result.topicIdHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'topicCreated',
            timestamp: Date.now(),
            actor: this.owner,
            topicHash: response.topicHash,
            topicIdHash: response.topicIdHash,
            storyIdHash: response.storyIdHash,
            name: request.name,
            participants: Array.from(new Set([...request.participants, this.owner]))
        });

        return response;
    }

    /**
     * Rename a topic
     */
    async renameTopic(request: RenameTopicRequest): Promise<RenameTopicResponse> {
        this.ensureInitialized();

        const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);
        const previousName = current.obj.name;

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Rename topic to: ${request.newName}`,
                planId: this.topicPlanIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const updated: Topic = {
                    ...current.obj,
                    name: request.newName
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: { topicHash: stored.hash },
                    productHash: stored.hash
                };
            }
        );

        const response: RenameTopicResponse = {
            topicHash: result.result.topicHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'topicRenamed',
            timestamp: Date.now(),
            actor: this.owner,
            topicHash: response.topicHash,
            topicIdHash: request.topicIdHash,
            storyIdHash: response.storyIdHash,
            newName: request.newName,
            previousName
        });

        return response;
    }

    /**
     * Add a participant to a topic
     */
    async addParticipant(request: AddParticipantRequest): Promise<AddParticipantResponse> {
        this.ensureInitialized();

        const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);
        const currentHashGroup = await this.deps.getObject<HashGroup<Person>>(
            current.obj.participants
        );

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Add participant to topic',
                planId: this.topicPlanIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const newParticipants = new Set(currentHashGroup.person);
                newParticipants.add(request.participant);

                const newHashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: newParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(newHashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                const updated: Topic = {
                    ...current.obj,
                    participants: participantsHash
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: {
                        topicHash: stored.hash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        const response: AddParticipantResponse = {
            topicHash: result.result.topicHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'participantAdded',
            timestamp: Date.now(),
            actor: this.owner,
            topicHash: response.topicHash,
            topicIdHash: request.topicIdHash,
            storyIdHash: response.storyIdHash,
            participant: request.participant
        });

        return response;
    }

    /**
     * Remove a participant from a topic
     */
    async removeParticipant(request: RemoveParticipantRequest): Promise<RemoveParticipantResponse> {
        this.ensureInitialized();

        const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);
        const currentHashGroup = await this.deps.getObject<HashGroup<Person>>(
            current.obj.participants
        );

        // Validate
        if (String(request.participant) === String(this.owner)) {
            throw new Error('Cannot remove topic owner from participants');
        }

        const newParticipants = new Set(currentHashGroup.person);
        if (!newParticipants.has(request.participant)) {
            throw new Error('Participant not in topic');
        }

        newParticipants.delete(request.participant);

        if (newParticipants.size === 0) {
            throw new Error('Cannot remove last participant from topic');
        }

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Remove participant from topic',
                planId: this.topicPlanIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const newHashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: newParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(newHashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                const updated: Topic = {
                    ...current.obj,
                    participants: participantsHash
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: {
                        topicHash: stored.hash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        const response: RemoveParticipantResponse = {
            topicHash: result.result.topicHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };

        // Emit event
        await this.events.emit({
            type: 'participantRemoved',
            timestamp: Date.now(),
            actor: this.owner,
            topicHash: response.topicHash,
            topicIdHash: request.topicIdHash,
            storyIdHash: response.storyIdHash,
            participant: request.participant
        });

        return response;
    }

    // ========================================================================
    // Query Operations (delegate to ChatQueries if cube available)
    // ========================================================================

    /**
     * Get messages in a topic
     */
    async getMessagesInTopic(
        topicIdHash: SHA256IdHash<Topic>,
        options?: QueryOptions,
        timeRange?: TimeRange
    ): Promise<MessageWithMetadata[]> {
        if (!this.cube) {
            throw new Error('Cube not available for queries');
        }

        const { ChatQueries } = await import('../queries/ChatQueries.js');
        const queries = new ChatQueries(this.cube, this.deps, this.chatPlanIdHash!);
        return queries.getMessagesInTopic(topicIdHash, options, timeRange);
    }

    /**
     * Get messages by a person
     */
    async getMessagesByPerson(
        personIdHash: SHA256IdHash<Person>,
        options?: QueryOptions,
        timeRange?: TimeRange
    ): Promise<MessageWithMetadata[]> {
        if (!this.cube) {
            throw new Error('Cube not available for queries');
        }

        const { ChatQueries } = await import('../queries/ChatQueries.js');
        const queries = new ChatQueries(this.cube, this.deps, this.chatPlanIdHash!);
        return queries.getMessagesByPerson(personIdHash, options, timeRange);
    }

    /**
     * Get thread (replies to a message)
     */
    async getThread(
        parentMessageHash: SHA256Hash<ChatMessage>,
        options?: QueryOptions
    ): Promise<MessageWithMetadata[]> {
        if (!this.cube) {
            throw new Error('Cube not available for queries');
        }

        const { ChatQueries } = await import('../queries/ChatQueries.js');
        const queries = new ChatQueries(this.cube, this.deps, this.chatPlanIdHash!);
        return queries.getThread(parentMessageHash, options);
    }

    /**
     * Get reactions to a message
     */
    async getReactions(
        targetMessageHash: SHA256Hash<ChatMessage>
    ): Promise<ReactionGroup[]> {
        if (!this.cube) {
            throw new Error('Cube not available for queries');
        }

        const { ChatQueries } = await import('../queries/ChatQueries.js');
        const queries = new ChatQueries(this.cube, this.deps, this.chatPlanIdHash!);
        return queries.getReactions(targetMessageHash);
    }

    /**
     * Get topic participants
     */
    async getTopicParticipants(topicIdHash: SHA256IdHash<Topic>): Promise<SHA256IdHash<Person>[]> {
        const topic = await this.deps.getObjectByIdHash<Topic>(topicIdHash);
        const hashGroup = await this.deps.getObject<HashGroup<Person>>(topic.obj.participants);
        return Array.from(hashGroup.person);
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a ChatApi instance
 */
export function createChatApi(
    storyFactory: StoryFactory,
    deps: ChatApiDeps,
    owner: SHA256IdHash<Person>,
    cube?: CubeQueryEngine,
    instanceVersion?: string
): ChatApi {
    return new ChatApi(storyFactory, deps, cube, owner, instanceVersion);
}
