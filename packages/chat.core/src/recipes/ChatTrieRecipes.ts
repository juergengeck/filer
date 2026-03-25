/**
 * ChatTrieRecipes — ONE.core recipes for per-topic message tries.
 *
 * ChatTrieNode (hash-prefix sync trie, id = trie.core hash)
 * TopicTrieNode (time-path query trie, id = trie.core hash)
 * SubjectTrieNode (subject-path query trie, id = trie.core hash)
 * ChatTrieRoot / TopicTrieRoot / SubjectTrieRoot (root pointers per topic)
 * ChatTrieEntry (durable chat atom referenced by the trie)
 * SubjectRange (subject -> start/end message hash range)
 *
 * CHUM sync: entries use referenceToObj to durable chat atoms.
 */
import type {Recipe, RecipeRule, VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {
    createPersistedTrieNodeRecipe,
    createPersistedTrieRootRecipe
} from '../../../trie.core/src/index.js';
import type {ChatTrieEmbeddingEstimate} from '../trie/embedding-estimates.js';

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

/**
 * A sync trie node persisted as a versioned singleton.
 * Identity is the trie.core-computed hash (write-once per hash).
 */
export interface ChatTrieNode {
    $type$: 'ChatTrieNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** trie.core-computed node hash — identity key */
    id: string;
    /** [chunk, child content-hash] pairs for trie reconstruction */
    children: Array<[string, string]>;
    /** Child node idHashes for CHUM traversal */
    childIds?: Set<string>;
    /** Chat atom hashes — referenceToObj for CHUM traversal */
    entries: Set<SHA256Hash>;
}

/**
 * Root pointer for a topic's sync trie.
 */
export interface ChatTrieRoot {
    $type$: 'ChatTrieRoot';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** SHA256IdHash<Topic> as string — identity key */
    id: string;
    /** Current trie root hash, or null for empty trie */
    root: string | null;
}

/**
 * Durable chat atom stored in the trie.
 * Carries the exact metadata needed to render chat directly from trie state.
 */
export interface ChatTrieEntry {
    $type$: 'ChatTrieEntry';
    /** Topic idHash as string */
    topicId: string;
    /** ChatMessage hash (or Story hash in future) */
    messageHash: SHA256Hash;
    /** Author idHash as string */
    authorId: string;
    /** Exact creation timestamp in ms since epoch */
    timestamp: number;
    /** Optional embedding footprint estimate for cross-device budget planning. */
    embeddingEstimate?: ChatTrieEmbeddingEstimate;
}

/**
 * A time trie node persisted as a versioned singleton.
 * Same shape as ChatTrieNode but distinct $type$.
 */
export interface TopicTrieNode {
    $type$: 'TopicTrieNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** trie.core-computed node hash — identity key */
    id: string;
    /** [chunk, child content-hash] pairs for trie reconstruction */
    children: Array<[string, string]>;
    /** Child node idHashes for CHUM traversal */
    childIds?: Set<string>;
    /** Chat atom hashes — referenceToObj for CHUM traversal */
    entries: Set<SHA256Hash>;
}

/**
 * Root pointer for a topic's time trie.
 */
export interface TopicTrieRoot {
    $type$: 'TopicTrieRoot';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** SHA256IdHash<Topic> as string — identity key */
    id: string;
    /** Current trie root hash, or null for empty trie */
    root: string | null;
}

/**
 * A subject trie node persisted as a versioned singleton.
 * Entries point to SubjectRange objects.
 */
export interface SubjectTrieNode {
    $type$: 'SubjectTrieNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** trie.core-computed node hash — identity key */
    id: string;
    /** [chunk, child content-hash] pairs for trie reconstruction */
    children: Array<[string, string]>;
    /** Child node idHashes for CHUM traversal */
    childIds?: Set<string>;
    /** SubjectRange object hashes */
    entries: Set<SHA256Hash>;
}

/**
 * Root pointer for a topic's subject trie.
 */
export interface SubjectTrieRoot {
    $type$: 'SubjectTrieRoot';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** SHA256IdHash<Topic> as string — identity key */
    id: string;
    /** Current trie root hash, or null for empty trie */
    root: string | null;
}

/**
 * Subject range using message/story references as boundaries.
 */
export interface SubjectRange {
    $type$: 'SubjectRange';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Deterministic identity for (topic, subject, start, end). */
    id: string;
    /** Topic idHash as string */
    topicId: string;
    /** Subject idHash as string */
    subjectId: string;
    /** Start boundary message/story hash (inclusive) */
    startMessageHash: SHA256Hash;
    /** End boundary message/story hash (inclusive) */
    endMessageHash: SHA256Hash;
    /** Cached timestamps for sorting/filtering */
    startTime: number;
    endTime: number;
    /** Optional trie pointers for acceleration; message hashes remain authoritative. */
    triePointers?: SubjectRangeTriePointers;
}

export interface SubjectRangeTriePointer {
    /** Target trie family name. */
    trie: 'time';
    /** Full path chunks from trie root to leaf. */
    path: string[];
}

export interface SubjectRangeTriePointers {
    start: SubjectRangeTriePointer;
    end: SubjectRangeTriePointer;
}

// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------

const CHAT_TRIE_ENTRY_REF_TYPE = new Set(['Story', 'ChatMessage', 'ChatTrieEntry']);
const SUBJECT_RANGE_REF_TYPE = new Set(['SubjectRange']);
const MESSAGE_REF_TYPE = new Set(['Story', 'ChatMessage']);
const SubjectRangeTriePointerRules: RecipeRule[] = [
    {
        itemprop: 'trie',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'path',
        itemtype: {
            type: 'array',
            item: {type: 'string'}
        }
    }
];

const SubjectRangeTriePointersRules: RecipeRule[] = [
    {
        itemprop: 'start',
        itemtype: {
            type: 'object',
            rules: SubjectRangeTriePointerRules
        }
    },
    {
        itemprop: 'end',
        itemtype: {
            type: 'object',
            rules: SubjectRangeTriePointerRules
        }
    }
];

const ChatTrieEmbeddingEstimateRules: RecipeRule[] = [
    {
        itemprop: 'vectorCount',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'dimensions',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'bytesPerDimension',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'estimatedBytes',
        itemtype: {type: 'number'}
    },
    {
        itemprop: 'model',
        itemtype: {type: 'string'},
        optional: true
    },
    {
        itemprop: 'abstractionLevel',
        itemtype: {type: 'number'},
        optional: true
    }
];

export const ChatTrieNodeRecipe: Recipe =
    createPersistedTrieNodeRecipe('ChatTrieNode', CHAT_TRIE_ENTRY_REF_TYPE);

export const ChatTrieRootRecipe: Recipe =
    createPersistedTrieRootRecipe('ChatTrieRoot', 'ChatTrieNode');

export const ChatTrieEntryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ChatTrieEntry',
    rule: [
        {
            itemprop: 'topicId',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'messageHash',
            itemtype: {type: 'referenceToObj', allowedTypes: MESSAGE_REF_TYPE}
        },
        {
            itemprop: 'authorId',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'embeddingEstimate',
            itemtype: {
                type: 'object',
                rules: ChatTrieEmbeddingEstimateRules
            },
            optional: true
        }
    ]
};

export const TopicTrieNodeRecipe: Recipe =
    createPersistedTrieNodeRecipe('TopicTrieNode', CHAT_TRIE_ENTRY_REF_TYPE);

export const TopicTrieRootRecipe: Recipe =
    createPersistedTrieRootRecipe('TopicTrieRoot', 'TopicTrieNode');

export const SubjectTrieNodeRecipe: Recipe =
    createPersistedTrieNodeRecipe('SubjectTrieNode', SUBJECT_RANGE_REF_TYPE);

export const SubjectTrieRootRecipe: Recipe =
    createPersistedTrieRootRecipe('SubjectTrieRoot', 'SubjectTrieNode');

export const SubjectRangeRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SubjectRange',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'topicId',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'subjectId',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'startMessageHash',
            itemtype: {type: 'referenceToObj', allowedTypes: MESSAGE_REF_TYPE}
        },
        {
            itemprop: 'endMessageHash',
            itemtype: {type: 'referenceToObj', allowedTypes: MESSAGE_REF_TYPE}
        },
        {
            itemprop: 'startTime',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'endTime',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'triePointers',
            itemtype: {
                type: 'object',
                rules: SubjectRangeTriePointersRules
            },
            optional: true
        }
    ]
};

const ChatTrieRecipes: Recipe[] = [
    ChatTrieNodeRecipe,
    ChatTrieRootRecipe,
    ChatTrieEntryRecipe,
    TopicTrieNodeRecipe,
    TopicTrieRootRecipe,
    SubjectTrieNodeRecipe,
    SubjectTrieRootRecipe,
    SubjectRangeRecipe
];

export default ChatTrieRecipes;
