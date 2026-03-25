/**
 * ChatQueries - Query helpers for chat data using Cube
 *
 * Provides high-level query methods that use the Cube for efficient
 * multi-dimensional queries on chat messages and topics.
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { ChatMessage } from '../recipes/ChatMessageRecipe.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import { DIMENSION_NAMES } from '../dimensions/ChatDimensions.js';

// ============================================================================
// Forward declarations for types from refinio.api and cube.core
// ============================================================================

interface Story {
    $type$: 'Story';
    id: string;
    title: string;
    plan: SHA256IdHash<Plan>;
    product: SHA256Hash<any>;
    instanceVersion: string;
    created: number;
    duration?: number;
    owner?: SHA256IdHash<Person>;
}

interface Plan {
    $type$: 'Plan';
    id: string;
}

interface Dimension {
    $type$: 'Dimension';
    name: string;
}

interface DimensionValue {
    $type$: 'DimensionValue';
    dimensionHash: SHA256Hash<Dimension>;
    value: any;
}

interface CubeObject {
    $type$: 'CubeObject';
    oneObjectHash: SHA256Hash<Story>;
    dimensionValues: SHA256Hash<DimensionValue>[];
}

// ============================================================================
// Query Types
// ============================================================================

export interface QueryOptions {
    /** Limit number of results */
    limit?: number;
    /** Skip first N results */
    offset?: number;
    /** Sort order: 'asc' (oldest first) or 'desc' (newest first) */
    order?: 'asc' | 'desc';
    /** Include deleted messages? Default: false */
    includeDeleted?: boolean;
}

export interface TimeRange {
    start?: number;  // timestamp (inclusive)
    end?: number;    // timestamp (inclusive)
}

export interface MessageWithMetadata {
    message: ChatMessage;
    messageHash: SHA256Hash<ChatMessage>;
    storyHash: SHA256Hash<Story>;
    author: SHA256IdHash<Person> | undefined;
    created: number;
    isEdited: boolean;
}

export interface ReactionGroup {
    reaction: string;
    reactors: SHA256IdHash<Person>[];
    count: number;
}

// ============================================================================
// Cube Query Interface
// ============================================================================

export interface DimensionCriterion {
    operator: 'equals' | 'range' | 'contains' | 'exists';
    value?: any;
    start?: number;
    end?: number;
}

export interface QueryCriteria {
    [dimensionName: string]: DimensionCriterion;
}

export interface CubeQueryEngine {
    query(criteria: QueryCriteria): Promise<CubeObject[]>;
}

// ============================================================================
// Storage Dependencies
// ============================================================================

export interface ChatQueriesDeps {
    getObject: <T>(hash: SHA256Hash<T>) => Promise<T>;
    getObjectByIdHash: <T>(idHash: SHA256IdHash<T>) => Promise<{ obj: T; hash: SHA256Hash<T> }>;
    getAllVersions: <T>(idHash: SHA256IdHash<T>) => Promise<T[]>;
}

// ============================================================================
// ChatQueries Implementation
// ============================================================================

/**
 * ChatQueries - High-level query helpers for chat data
 *
 * Usage:
 * ```typescript
 * const queries = new ChatQueries(cubeEngine, deps, chatPlanIdHash);
 *
 * // Get messages in a topic
 * const messages = await queries.getMessagesInTopic(topicIdHash, {
 *     limit: 50,
 *     order: 'desc'
 * });
 *
 * // Get thread replies
 * const replies = await queries.getThread(parentMessageHash);
 *
 * // Get reactions
 * const reactions = await queries.getReactions(messageHash);
 * ```
 */
export class ChatQueries {
    constructor(
        private cube: CubeQueryEngine,
        private deps: ChatQueriesDeps,
        private chatPlanIdHash: SHA256IdHash<Plan>
    ) {}

    // ========================================================================
    // Get Messages in Topic
    // ========================================================================

    /**
     * Get messages in a topic
     *
     * Queries Cube for all Stories where:
     * - topic = topicIdHash
     * - plan = ChatPlan
     *
     * @param topicIdHash - Topic to query
     * @param options - Query options (limit, offset, order, includeDeleted)
     * @param timeRange - Optional time range filter
     */
    async getMessagesInTopic(
        topicIdHash: SHA256IdHash<Topic>,
        options: QueryOptions = {},
        timeRange?: TimeRange
    ): Promise<MessageWithMetadata[]> {
        const criteria: QueryCriteria = {
            [DIMENSION_NAMES.TOPIC]: { operator: 'equals', value: topicIdHash },
            [DIMENSION_NAMES.PLAN]: { operator: 'equals', value: this.chatPlanIdHash }
        };

        // Add time range if specified
        if (timeRange && (timeRange.start !== undefined || timeRange.end !== undefined)) {
            criteria[DIMENSION_NAMES.WHEN] = {
                operator: 'range',
                start: timeRange.start,
                end: timeRange.end
            };
        }

        const cubeObjects = await this.cube.query(criteria);
        return this.hydrateCubeResults(cubeObjects, options);
    }

    // ========================================================================
    // Get Messages by Person
    // ========================================================================

    /**
     * Get messages by a person across all topics
     *
     * Queries Cube for all Stories where:
     * - who = personIdHash
     * - plan = ChatPlan
     *
     * @param personIdHash - Person to query
     * @param options - Query options
     * @param timeRange - Optional time range filter
     */
    async getMessagesByPerson(
        personIdHash: SHA256IdHash<Person>,
        options: QueryOptions = {},
        timeRange?: TimeRange
    ): Promise<MessageWithMetadata[]> {
        const criteria: QueryCriteria = {
            [DIMENSION_NAMES.WHO]: { operator: 'equals', value: personIdHash },
            [DIMENSION_NAMES.PLAN]: { operator: 'equals', value: this.chatPlanIdHash }
        };

        // Add time range if specified
        if (timeRange && (timeRange.start !== undefined || timeRange.end !== undefined)) {
            criteria[DIMENSION_NAMES.WHEN] = {
                operator: 'range',
                start: timeRange.start,
                end: timeRange.end
            };
        }

        const cubeObjects = await this.cube.query(criteria);
        return this.hydrateCubeResults(cubeObjects, options);
    }

    // ========================================================================
    // Get Thread (Replies to a Message)
    // ========================================================================

    /**
     * Get all replies to a message (thread)
     *
     * Queries Cube for all Stories where:
     * - replyTo = parentMessageHash
     * - plan = ChatPlan
     *
     * Note: This returns direct replies only. For nested threads,
     * call recursively or use getFullThread().
     *
     * @param parentMessageHash - Message to get replies for
     * @param options - Query options
     */
    async getThread(
        parentMessageHash: SHA256Hash<ChatMessage>,
        options: QueryOptions = {}
    ): Promise<MessageWithMetadata[]> {
        const criteria: QueryCriteria = {
            [DIMENSION_NAMES.REPLY_TO]: { operator: 'equals', value: parentMessageHash },
            [DIMENSION_NAMES.PLAN]: { operator: 'equals', value: this.chatPlanIdHash }
        };

        const cubeObjects = await this.cube.query(criteria);

        // Filter out reactions (they also use replyTo)
        const messages = await this.hydrateCubeResults(cubeObjects, options);
        return messages.filter(m => !m.message.reaction);
    }

    // ========================================================================
    // Get Reactions
    // ========================================================================

    /**
     * Get all reactions to a message
     *
     * Queries Cube for all Stories where:
     * - replyTo = targetMessageHash
     * - plan = ChatPlan
     *
     * Then filters for messages with reaction field set and groups by emoji.
     *
     * @param targetMessageHash - Message to get reactions for
     */
    async getReactions(
        targetMessageHash: SHA256Hash<ChatMessage>
    ): Promise<ReactionGroup[]> {
        const criteria: QueryCriteria = {
            [DIMENSION_NAMES.REPLY_TO]: { operator: 'equals', value: targetMessageHash },
            [DIMENSION_NAMES.PLAN]: { operator: 'equals', value: this.chatPlanIdHash }
        };

        const cubeObjects = await this.cube.query(criteria);

        // Group reactions by emoji
        const reactionMap = new Map<string, Set<SHA256IdHash<Person>>>();

        for (const cubeObj of cubeObjects) {
            const story = await this.deps.getObject<Story>(cubeObj.oneObjectHash);
            const message = await this.deps.getObject<ChatMessage>(
                story.product as SHA256Hash<ChatMessage>
            );

            // Only include messages with reaction field (not regular replies)
            if (message.reaction && !message.deleted && story.owner) {
                if (!reactionMap.has(message.reaction)) {
                    reactionMap.set(message.reaction, new Set());
                }
                reactionMap.get(message.reaction)!.add(story.owner);
            }
        }

        // Convert to array of ReactionGroup
        const groups: ReactionGroup[] = [];
        for (const [reaction, reactors] of reactionMap) {
            groups.push({
                reaction,
                reactors: Array.from(reactors),
                count: reactors.size
            });
        }

        // Sort by count descending
        groups.sort((a, b) => b.count - a.count);

        return groups;
    }

    // ========================================================================
    // Get Full Thread (Recursive)
    // ========================================================================

    /**
     * Get full thread including nested replies
     *
     * Returns a flat array of all messages in the thread, ordered by time.
     *
     * @param rootMessageHash - Root message of the thread
     * @param maxDepth - Maximum nesting depth (default: 10)
     */
    async getFullThread(
        rootMessageHash: SHA256Hash<ChatMessage>,
        maxDepth: number = 10
    ): Promise<MessageWithMetadata[]> {
        const allMessages: MessageWithMetadata[] = [];
        const visited = new Set<string>();

        const collectReplies = async (
            parentHash: SHA256Hash<ChatMessage>,
            depth: number
        ): Promise<void> => {
            if (depth > maxDepth) return;

            const replies = await this.getThread(parentHash, { order: 'asc' });

            for (const reply of replies) {
                const hashStr = String(reply.messageHash);
                if (visited.has(hashStr)) continue;
                visited.add(hashStr);

                allMessages.push(reply);

                // Recursively get replies to this reply
                await collectReplies(reply.messageHash, depth + 1);
            }
        };

        await collectReplies(rootMessageHash, 0);

        // Sort by creation time
        allMessages.sort((a, b) => a.created - b.created);

        return allMessages;
    }

    // ========================================================================
    // Get Message Edit History
    // ========================================================================

    /**
     * Get edit history for a message
     *
     * Returns all versions of a message, ordered by time.
     *
     * @param messageIdHash - Message ID hash (stable across edits)
     */
    async getEditHistory(
        messageIdHash: SHA256IdHash<ChatMessage>
    ): Promise<Array<{
        content: string | undefined;
        editedAt: number;
        editedBy: SHA256IdHash<Person> | undefined;
    }>> {
        // Get the Story ID hash for this message
        // Story.id format: "ChatPlan.{messageIdHash}"
        // Note: This requires calculating the Story idHash from the message idHash

        // For now, we'll get the message directly and check if it has multiple versions
        // A full implementation would query Story versions

        const result = await this.deps.getObjectByIdHash<ChatMessage>(messageIdHash);
        const message = result.obj;

        // Return single entry for now (full implementation needs Story version access)
        return [{
            content: message.content,
            editedAt: Date.now(), // Would come from Story.created
            editedBy: undefined   // Would come from Story.owner
        }];
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Hydrate CubeObject results into MessageWithMetadata
     */
    private async hydrateCubeResults(
        cubeObjects: CubeObject[],
        options: QueryOptions
    ): Promise<MessageWithMetadata[]> {
        const messages: MessageWithMetadata[] = [];

        for (const cubeObj of cubeObjects) {
            const story = await this.deps.getObject<Story>(cubeObj.oneObjectHash);
            const message = await this.deps.getObject<ChatMessage>(
                story.product as SHA256Hash<ChatMessage>
            );

            // Skip deleted unless requested
            if (message.deleted && !options.includeDeleted) {
                continue;
            }

            // Skip reactions in general message queries
            if (message.reaction) {
                continue;
            }

            messages.push({
                message,
                messageHash: story.product as SHA256Hash<ChatMessage>,
                storyHash: cubeObj.oneObjectHash,
                author: story.owner,
                created: story.created,
                isEdited: false // Would need Story version count to determine
            });
        }

        // Sort by time
        const order = options.order || 'desc';
        messages.sort((a, b) =>
            order === 'asc' ? a.created - b.created : b.created - a.created
        );

        // Apply pagination
        const offset = options.offset || 0;
        const limit = options.limit || messages.length;

        return messages.slice(offset, offset + limit);
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create a ChatQueries instance
 */
export function createChatQueries(
    cube: CubeQueryEngine,
    deps: ChatQueriesDeps,
    chatPlanIdHash: SHA256IdHash<Plan>
): ChatQueries {
    return new ChatQueries(cube, deps, chatPlanIdHash);
}
