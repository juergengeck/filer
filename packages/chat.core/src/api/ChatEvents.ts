/**
 * ChatEvents - Event types and emitter for chat operations
 *
 * Provides a type-safe event system for chat operations.
 * UI components can subscribe to these events for real-time updates.
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { ChatMessage } from '../recipes/ChatMessageRecipe.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

// Forward declaration for Story
interface Story {
    $type$: 'Story';
    id: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Base event with common fields
 */
export interface ChatEventBase {
    /** Timestamp when event occurred */
    timestamp: number;
    /** Person who triggered the event */
    actor: SHA256IdHash<Person>;
}

/**
 * Message created event
 */
export interface MessageCreatedEvent extends ChatEventBase {
    type: 'messageCreated';
    messageHash: SHA256Hash<ChatMessage>;
    messageIdHash: SHA256IdHash<ChatMessage>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    content: string;
    replyTo?: SHA256Hash<ChatMessage>;
}

/**
 * Message edited event
 */
export interface MessageEditedEvent extends ChatEventBase {
    type: 'messageEdited';
    messageHash: SHA256Hash<ChatMessage>;
    messageIdHash: SHA256IdHash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
    newContent: string;
    previousContent?: string;
}

/**
 * Message deleted event
 */
export interface MessageDeletedEvent extends ChatEventBase {
    type: 'messageDeleted';
    messageHash: SHA256Hash<ChatMessage>;
    messageIdHash: SHA256IdHash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
    reason?: string;
}

/**
 * Reaction added event
 */
export interface ReactionAddedEvent extends ChatEventBase {
    type: 'reactionAdded';
    reactionHash: SHA256Hash<ChatMessage>;
    reactionIdHash: SHA256IdHash<ChatMessage>;
    targetMessageHash: SHA256Hash<ChatMessage>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    reaction: string;
}

/**
 * Reaction removed event
 */
export interface ReactionRemovedEvent extends ChatEventBase {
    type: 'reactionRemoved';
    reactionHash: SHA256Hash<ChatMessage>;
    reactionIdHash: SHA256IdHash<ChatMessage>;
    targetMessageHash: SHA256Hash<ChatMessage>;
    storyIdHash: SHA256IdHash<Story>;
}

/**
 * Topic created event
 */
export interface TopicCreatedEvent extends ChatEventBase {
    type: 'topicCreated';
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    name: string;
    participants: SHA256IdHash<Person>[];
}

/**
 * Topic renamed event
 */
export interface TopicRenamedEvent extends ChatEventBase {
    type: 'topicRenamed';
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    newName: string;
    previousName?: string;
}

/**
 * Participant added event
 */
export interface ParticipantAddedEvent extends ChatEventBase {
    type: 'participantAdded';
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    participant: SHA256IdHash<Person>;
}

/**
 * Participant removed event
 */
export interface ParticipantRemovedEvent extends ChatEventBase {
    type: 'participantRemoved';
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
    participant: SHA256IdHash<Person>;
}

/**
 * Union of all chat events
 */
export type ChatEvent =
    | MessageCreatedEvent
    | MessageEditedEvent
    | MessageDeletedEvent
    | ReactionAddedEvent
    | ReactionRemovedEvent
    | TopicCreatedEvent
    | TopicRenamedEvent
    | ParticipantAddedEvent
    | ParticipantRemovedEvent;

/**
 * Event type string literals
 */
export type ChatEventType = ChatEvent['type'];

// ============================================================================
// Event Handler Types
// ============================================================================

export type ChatEventHandler<T extends ChatEvent = ChatEvent> = (event: T) => void | Promise<void>;

export type MessageCreatedHandler = ChatEventHandler<MessageCreatedEvent>;
export type MessageEditedHandler = ChatEventHandler<MessageEditedEvent>;
export type MessageDeletedHandler = ChatEventHandler<MessageDeletedEvent>;
export type ReactionAddedHandler = ChatEventHandler<ReactionAddedEvent>;
export type ReactionRemovedHandler = ChatEventHandler<ReactionRemovedEvent>;
export type TopicCreatedHandler = ChatEventHandler<TopicCreatedEvent>;
export type TopicRenamedHandler = ChatEventHandler<TopicRenamedEvent>;
export type ParticipantAddedHandler = ChatEventHandler<ParticipantAddedEvent>;
export type ParticipantRemovedHandler = ChatEventHandler<ParticipantRemovedEvent>;

// ============================================================================
// ChatEventEmitter Implementation
// ============================================================================

/**
 * ChatEventEmitter - Type-safe event emitter for chat events
 *
 * Usage:
 * ```typescript
 * const emitter = new ChatEventEmitter();
 *
 * // Subscribe to specific event
 * emitter.on('messageCreated', (event) => {
 *     console.log(`New message in ${event.topicIdHash}: ${event.content}`);
 * });
 *
 * // Subscribe to all events
 * emitter.onAny((event) => {
 *     console.log(`Event: ${event.type}`);
 * });
 *
 * // Unsubscribe
 * const unsubscribe = emitter.on('messageCreated', handler);
 * unsubscribe();
 * ```
 */
export class ChatEventEmitter {
    private handlers: Map<ChatEventType, Set<ChatEventHandler<any>>> = new Map();
    private anyHandlers: Set<ChatEventHandler> = new Set();

    /**
     * Subscribe to a specific event type
     * @returns Unsubscribe function
     */
    on<T extends ChatEventType>(
        type: T,
        handler: ChatEventHandler<Extract<ChatEvent, { type: T }>>
    ): () => void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler);

        return () => {
            this.handlers.get(type)?.delete(handler);
        };
    }

    /**
     * Subscribe to all events
     * @returns Unsubscribe function
     */
    onAny(handler: ChatEventHandler): () => void {
        this.anyHandlers.add(handler);
        return () => {
            this.anyHandlers.delete(handler);
        };
    }

    /**
     * Unsubscribe from a specific event type
     */
    off<T extends ChatEventType>(
        type: T,
        handler: ChatEventHandler<Extract<ChatEvent, { type: T }>>
    ): void {
        this.handlers.get(type)?.delete(handler);
    }

    /**
     * Unsubscribe from all events
     */
    offAny(handler: ChatEventHandler): void {
        this.anyHandlers.delete(handler);
    }

    /**
     * Emit an event
     */
    async emit(event: ChatEvent): Promise<void> {
        // Call type-specific handlers
        const typeHandlers = this.handlers.get(event.type);
        if (typeHandlers) {
            for (const handler of typeHandlers) {
                try {
                    await handler(event);
                } catch (error) {
                    console.error(`[ChatEventEmitter] Handler error for ${event.type}:`, error);
                }
            }
        }

        // Call any-event handlers
        for (const handler of this.anyHandlers) {
            try {
                await handler(event);
            } catch (error) {
                console.error(`[ChatEventEmitter] Any-handler error for ${event.type}:`, error);
            }
        }
    }

    /**
     * Remove all handlers
     */
    clear(): void {
        this.handlers.clear();
        this.anyHandlers.clear();
    }

    /**
     * Get number of handlers for a type
     */
    listenerCount(type?: ChatEventType): number {
        if (type) {
            return (this.handlers.get(type)?.size || 0) + this.anyHandlers.size;
        }
        let count = this.anyHandlers.size;
        for (const handlers of this.handlers.values()) {
            count += handlers.size;
        }
        return count;
    }
}
