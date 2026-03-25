/**
 * Chat Dimensions for cube.core indexing
 *
 * Defines the cube dimensions used for efficient chat message queries.
 * These dimensions index Story objects created by ChatPlan/TopicPlan.
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';

/**
 * Dimension interface from cube.core
 */
export interface Dimension {
    $type$: 'Dimension';
    /** Dimension name (e.g., 'when', 'who', 'topic') */
    name: string;
    /** Data type: 'number' | 'hash' | 'string' */
    dataType: 'number' | 'hash' | 'string';
    /** True for standard dimensions (when, who, where) */
    standard: boolean;
    /** Whether to sync via CHUM */
    shared: boolean;
    /** Package providing this dimension */
    packageName?: string;
}

/**
 * Chat-specific dimensions for cube indexing
 */
export const CHAT_DIMENSIONS: Dimension[] = [
    {
        $type$: 'Dimension',
        name: 'when',
        dataType: 'number',      // timestamp from Story.created
        standard: true,
        shared: true,
        packageName: 'cube.time'
    },
    {
        $type$: 'Dimension',
        name: 'who',
        dataType: 'hash',        // SHA256IdHash<Person> from Story.owner
        standard: true,
        shared: true,
        packageName: 'someone.core'
    },
    {
        $type$: 'Dimension',
        name: 'topic',
        dataType: 'hash',        // SHA256IdHash<Topic> from ChatMessage.topic
        standard: false,
        shared: true,
        packageName: 'chat.core'
    },
    {
        $type$: 'Dimension',
        name: 'replyTo',
        dataType: 'hash',        // SHA256Hash<ChatMessage> from ChatMessage.replyTo
        standard: false,
        shared: true,
        packageName: 'chat.core'
    },
    {
        $type$: 'Dimension',
        name: 'plan',
        dataType: 'hash',        // SHA256IdHash<Plan> from Story.plan
        standard: false,
        shared: true,
        packageName: 'refinio.api'
    }
];

/**
 * Get a chat dimension by name
 */
export function getChatDimension(name: string): Dimension | undefined {
    return CHAT_DIMENSIONS.find(d => d.name === name);
}

/**
 * Dimension names as constants for type safety
 */
export const DIMENSION_NAMES = {
    WHEN: 'when',
    WHO: 'who',
    TOPIC: 'topic',
    REPLY_TO: 'replyTo',
    PLAN: 'plan'
} as const;

export type ChatDimensionName = typeof DIMENSION_NAMES[keyof typeof DIMENSION_NAMES];
