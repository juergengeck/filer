/**
 * MultiTrie — wraps N ContentAddressedTrie instances for atomic multi-insert.
 *
 * Same entry hash enters all constituent tries simultaneously.
 * Each trie can have a different KeyFn (hash-prefix for sync, time-path for queries).
 */
import type { Hash, TrieConfig, TrieNodeData, TrieStore } from './types.js';
import { ContentAddressedTrie } from './trie.js';
export interface TrieSlot {
    name: string;
    config: TrieConfig;
    store?: TrieStore;
}
export declare class MultiTrie {
    private readonly slots;
    private readonly tries;
    private writeChain;
    constructor(slots: TrieSlot[]);
    /**
     * Insert entry into ALL constituent tries with the same context.
     *
     * Atomicity guarantee (in-memory):
     * - The insert operation is serialized across callers.
     * - If any slot insert fails, all slot roots are rolled back to their previous values.
     */
    insert(entryHash: Hash, context?: Record<string, unknown>): Promise<void>;
    /** Get a constituent trie by name. Throws if not found. */
    getTrie(name: string): Promise<ContentAddressedTrie>;
    /** Get slot root hash. */
    getRoot(name: string): Promise<Hash | null>;
    /** Resolve a node hash within one slot. */
    getNode(name: string, hash: Hash): Promise<TrieNodeData | null>;
    /** Collect all entries for one slot. */
    collectAllEntries(name: string): Promise<Hash[]>;
    /** Collect entries at an exact path for one slot. */
    collectEntriesAtPath(name: string, chunks: string[]): Promise<Hash[]>;
    /** Set a slot root hash externally (cold-start restore). */
    setRoot(name: string, hash: Hash | null): Promise<void>;
    /** Number of constituent tries. */
    get size(): number;
    private getTrieSync;
    private serializeWrite;
}
