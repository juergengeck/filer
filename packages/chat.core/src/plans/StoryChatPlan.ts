/**
 * StoryChatPlan - Chat operations using Story + Cube architecture
 *
 * This plan creates chat messages wrapped with StoryFactory for:
 * - Full provenance tracking (who, when, what)
 * - Cube indexing for efficient queries
 * - Edit/delete history via Story versioning
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { VersionedObjectResult } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { operationRegistry } from '@refinio/api/registry';
import type { ChatMessage } from '../recipes/ChatMessageRecipe.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

/**
 * StoryFactory interface from refinio.api
 * Wraps operations to create Story objects for audit trail
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
    assemblyId?: SHA256IdHash<Assembly>;
}

// Types from assembly.core (canonical definitions)
import type { Plan, Story, Assembly } from '@refinio/assembly.core';

/**
 * Storage dependencies injected from platform
 */
export interface StoryChatPlanDeps {
    storeVersionedObject: <T>(obj: T) => Promise<VersionedObjectResult<T>>;
    getObjectByIdHash: <T>(idHash: SHA256IdHash<T>) => Promise<{ obj: T }>;
    getObject: <T>(hash: SHA256Hash<T>) => Promise<T>;
    calculateIdHashOfObj: <T>(obj: T) => Promise<SHA256IdHash<T>>;
}

/**
 * Chat Plan definition for StoryFactory registration
 */
export const CHAT_PLAN: PlanDefinition = {
    id: 'ChatPlan',
    name: 'Chat Plan',
    description: 'Creates and manages chat messages using Story + Cube architecture',
    domain: 'chat',
    supplyPatterns: [
        { type: 'ChatMessage', description: 'Chat messages' }
    ]
};

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreateMessageRequest {
    topicIdHash: SHA256IdHash<Topic>;
    content: string;
    replyTo?: SHA256Hash<ChatMessage>;
    attachments?: SHA256Hash<any>[];
}

export interface CreateMessageResponse {
    messageHash: SHA256Hash<ChatMessage>;
    messageIdHash: SHA256IdHash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface CreateReactionRequest {
    topicIdHash: SHA256IdHash<Topic>;
    targetMessageHash: SHA256Hash<ChatMessage>;
    reaction: string;  // emoji
}

export interface CreateReactionResponse {
    reactionHash: SHA256Hash<ChatMessage>;
    reactionIdHash: SHA256IdHash<ChatMessage>;
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

export interface RemoveReactionRequest {
    reactionIdHash: SHA256IdHash<ChatMessage>;
}

export interface RemoveReactionResponse {
    messageHash: SHA256Hash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

// ============================================================================
// StoryChatPlan Implementation
// ============================================================================

/**
 * StoryChatPlan - Chat operations with Story tracking
 *
 * Usage:
 * ```typescript
 * const chatPlan = new StoryChatPlan(storyFactory, deps, ownerIdHash, '1.0.0');
 * await chatPlan.init();
 *
 * const result = await chatPlan.createMessage({
 *     topicIdHash,
 *     content: 'Hello world!'
 * });
 * ```
 */
export class StoryChatPlan {
    private planIdHash: SHA256IdHash<Plan> | undefined;

    constructor(
        private storyFactory: StoryFactory,
        private deps: StoryChatPlanDeps,
        private owner: SHA256IdHash<Person>,
        private instanceVersion: string = '1.0.0'
    ) {}

    /**
     * Initialize the plan - must be called before other methods
     */
    async init(): Promise<void> {
        this.planIdHash = await operationRegistry.resolvePlanId(CHAT_PLAN);
    }

    /**
     * Generate a UUID for message identity
     */
    private generateId(): string {
        return crypto.randomUUID();
    }

    /**
     * Ensure plan is initialized
     */
    private ensureInitialized(): void {
        if (!this.planIdHash) {
            throw new Error('StoryChatPlan not initialized. Call init() first.');
        }
    }

    // ========================================================================
    // Create Message
    // ========================================================================

    /**
     * Create a new chat message
     *
     * Creates a ChatMessage and wraps with StoryFactory for provenance tracking.
     * The Story captures who created the message and when.
     */
    async createMessage(request: CreateMessageRequest): Promise<CreateMessageResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Message in ${String(request.topicIdHash).substring(0, 8)}`,
                planId: this.planIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                const message: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: this.generateId(),
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

        return {
            messageHash: result.result.messageHash,
            messageIdHash: result.result.messageIdHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Create Reaction
    // ========================================================================

    /**
     * Create a reaction to a message
     *
     * Reactions are ChatMessages with:
     * - reaction field set (emoji)
     * - replyTo pointing to target message
     * - no content
     */
    async createReaction(request: CreateReactionRequest): Promise<CreateReactionResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Reaction ${request.reaction}`,
                planId: this.planIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Get topic from target message
                const targetMessage = await this.deps.getObject<ChatMessage>(request.targetMessageHash);

                const reaction: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: this.generateId(),
                    topic: targetMessage.topic,
                    replyTo: request.targetMessageHash,
                    reaction: request.reaction
                    // No content for reactions
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

        return {
            reactionHash: result.result.reactionHash,
            reactionIdHash: result.result.reactionIdHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Edit Message
    // ========================================================================

    /**
     * Edit an existing message
     *
     * Creates a new version of the message with updated content.
     * The Story chain tracks edit history.
     */
    async editMessage(request: EditMessageRequest): Promise<EditMessageResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Edit message',
                planId: this.planIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current message
                const current = await this.deps.getObjectByIdHash<ChatMessage>(request.messageIdHash);

                // Verify ownership - check original Story
                // For now, we trust the caller. In production, check Story.owner
                // TODO: Add ownership verification via Story lookup

                // Create new version with updated content
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

        return {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Delete Message
    // ========================================================================

    /**
     * Delete a message (soft delete via tombstone)
     *
     * Creates a new version with deleted=true and content cleared.
     * Original content preserved in earlier Story versions.
     */
    async deleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Delete message',
                planId: this.planIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current message
                const current = await this.deps.getObjectByIdHash<ChatMessage>(request.messageIdHash);

                // Verify ownership
                // TODO: Add ownership verification via Story lookup

                // Create tombstone version
                const tombstone: ChatMessage = {
                    $type$: 'ChatMessage',
                    id: current.obj.id,
                    topic: current.obj.topic,
                    replyTo: current.obj.replyTo,
                    reaction: current.obj.reaction,
                    // Content cleared
                    content: undefined,
                    attachments: undefined,
                    // Deletion marker
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

        return {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Remove Reaction
    // ========================================================================

    /**
     * Remove a reaction
     *
     * Creates a new version with reaction cleared.
     */
    async removeReaction(request: RemoveReactionRequest): Promise<RemoveReactionResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: 'Remove reaction',
                planId: this.planIdHash!,
                planTypeName: 'ChatPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current reaction
                const current = await this.deps.getObjectByIdHash<ChatMessage>(request.reactionIdHash);

                // Verify this is a reaction
                if (!current.obj.reaction) {
                    throw new Error('Message is not a reaction');
                }

                // Create version with reaction cleared
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

        return {
            messageHash: result.result.messageHash,
            storyIdHash: result.storyId!
        };
    }
}
