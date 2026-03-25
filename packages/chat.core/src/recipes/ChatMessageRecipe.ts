/**
 * ChatMessage Recipe for ONE.core
 *
 * Defines the schema for chat messages. Messages are pure data with semantic
 * relationships. Metadata (author, timestamp) is captured by Story objects.
 *
 * Identity fields (isId: true): id, topic, replyTo, reaction
 * Mutable fields: content, attachments, deleted, deletedReason
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { Recipe } from '@refinio/one.core/lib/recipes.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
// Topic is defined in one.models - import from there for type consistency
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

/**
 * Forward declarations for types from one.core/one.models
 */
interface BlobDescriptor {
    $type$: 'BlobDescriptor';
}

/**
 * ChatMessage interface
 *
 * Message types by field combination:
 * - Regular message: id, topic, content
 * - Reply: id, topic, replyTo, content
 * - Reaction: id, topic, replyTo, reaction (no content)
 * - Deleted: id, topic, deleted=true (content cleared)
 */
export interface ChatMessage {
    $type$: 'ChatMessage';

    // ===== IDENTITY FIELDS (isId: true) =====
    /** UUID - stable across edits */
    id: string;
    /** Which conversation this message belongs to */
    topic: SHA256IdHash<Topic>;
    /** Parent message for replies/reactions */
    replyTo?: SHA256Hash<ChatMessage>;
    /** Emoji for reactions (e.g., "👍", "❤️") */
    reaction?: string;

    // ===== MUTABLE FIELDS =====
    /** Message text (undefined for reactions) */
    content?: string;
    /** File attachments */
    attachments?: SHA256Hash<BlobDescriptor>[];

    // ===== DELETION =====
    /** Tombstone marker */
    deleted?: boolean;
    /** Reason for deletion (e.g., "retracted", "moderated") */
    deletedReason?: string;
}

export const ChatMessageRecipe: Recipe = {
    $type$: 'Recipe' as const,
    name: 'ChatMessage',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^ChatMessage$/ }
        },
        // ===== IDENTITY FIELDS (isId: true) =====
        {
            itemprop: 'id',
            itemtype: { type: 'string' },
            isId: true
        },
        {
            itemprop: 'topic',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Topic'])
            },
            isId: true
        },
        {
            itemprop: 'replyTo',
            itemtype: {
                type: 'referenceToObj',
                allowedTypes: new Set(['ChatMessage'])
            },
            isId: true,
            optional: true
        },
        {
            itemprop: 'reaction',
            itemtype: { type: 'string' },
            isId: true,
            optional: true
        },
        // ===== MUTABLE FIELDS =====
        {
            itemprop: 'content',
            itemtype: { type: 'string' },
            optional: true
        },
        {
            itemprop: 'attachments',
            itemtype: {
                type: 'array',
                item: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['BlobDescriptor'])
                }
            },
            optional: true
        },
        // ===== DELETION =====
        {
            itemprop: 'deleted',
            itemtype: { type: 'boolean' },
            optional: true
        },
        {
            itemprop: 'deletedReason',
            itemtype: { type: 'string' },
            optional: true
        }
    ]
};
