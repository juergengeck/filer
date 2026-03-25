import type {Hash, PersistedTrieStoreDeps, TrieStore} from '../../../trie.core/src/index.js';
import type {ChatTrieEmbeddingEstimate} from './embedding-estimates.js';

/**
 * DI for ONE.core trie node persistence.
 * ChatTrie never imports ONE.core directly.
 */
export interface ChatTrieStoreDeps extends PersistedTrieStoreDeps {}

/**
 * Chat atom stored in the trie.
 *
 * This is the durable message reference the trie indexes across multiple
 * parameters (sync, time, subject, ...). It carries the exact metadata needed
 * to render chat without a separate message index.
 */
export interface ChatTrieEntry {
    /** Topic the message belongs to. */
    topicId: string;
    /** ChatMessage hash (or Story hash in future). */
    messageHash: Hash;
    /** Author idHash as string. */
    authorId: string;
    /** Exact creation timestamp in ms since epoch. */
    timestamp: number;
    /** Optional embedding footprint estimate carried with this trie entry. */
    embeddingEstimate?: ChatTrieEmbeddingEstimate;
}

/**
 * DI for ChatTrieEntry object persistence.
 */
export interface ChatTrieEntryStoreDeps {
    /** Persist a chat trie entry and return its object hash. */
    storeEntry(entry: ChatTrieEntry): Promise<Hash>;
    /** Load a chat trie entry by object hash. */
    loadEntry(entryHash: Hash): Promise<ChatTrieEntry | null>;
}

/**
 * Subject-scoped message range.
 * Boundaries are message/story references (stable identity), not trie pointers.
 */
export interface SubjectMessageRange {
    /** Deterministic identity for this range object. */
    id: string;
    /** Topic this range belongs to. */
    topicId: string;
    /** Subject identity (typically Subject idHash as string). */
    subjectId: string;
    /** Start boundary (inclusive): message/story hash. */
    startMessageHash: Hash;
    /** End boundary (inclusive): message/story hash. */
    endMessageHash: Hash;
    /** Start timestamp (ms since epoch) for fast sorting/filtering. */
    startTime: number;
    /** End timestamp (ms since epoch) for fast sorting/filtering. */
    endTime: number;
    /**
     * Optional trie pointers used as acceleration hints.
     * Boundaries above remain the source of truth.
     */
    triePointers?: SubjectRangeTriePointers;
}

/** Input shape for creating a range. */
export interface SubjectMessageRangeInput {
    subjectId: string;
    startMessageHash: Hash;
    endMessageHash: Hash;
    startTime: Date;
    endTime: Date;
}

export interface SubjectRangeTriePointer {
    /** Which trie the pointer targets. */
    trie: 'time';
    /** Full path chunks from root to the pointed leaf. */
    path: string[];
}

export interface SubjectRangeTriePointers {
    start: SubjectRangeTriePointer;
    end: SubjectRangeTriePointer;
}

/**
 * DI for SubjectRange object persistence.
 * Separate from trie-node persistence (ChatTrieStoreDeps).
 */
export interface ChatTrieRangeDeps {
    /** Persist range object and return its idHash for trie entry indexing. */
    storeRange(range: SubjectMessageRange): Promise<Hash>;
    /** Load range object by idHash. */
    loadRange(rangeHash: Hash): Promise<SubjectMessageRange | null>;
}

export interface ChatTrieConfig {
    topicId: string;
    /** Deps + store for the sync trie (hash-prefix, ChatTrieNode) */
    syncDeps: ChatTrieStoreDeps;
    syncStore: TrieStore;
    /** Deps + store for the time trie (time-path, TopicTrieNode) */
    timeDeps: ChatTrieStoreDeps;
    timeStore: TrieStore;
    /** Deps + store for the subject trie (subject-path, SubjectTrieNode) */
    subjectDeps: ChatTrieStoreDeps;
    subjectStore: TrieStore;
    /** Deps for SubjectRange objects referenced by subject trie entries */
    rangeDeps: ChatTrieRangeDeps;
}
