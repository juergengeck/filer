import type { Hash, TrieConfig, TrieNodeData, TrieReader, TrieStore } from './types.js';
export declare class ContentAddressedTrie implements TrieReader {
    private readonly store;
    private root;
    private readonly keyFn;
    constructor(config: TrieConfig, store?: TrieStore);
    getRoot(): Hash | null;
    /** Set the root hash externally (for cold-start loading from persisted state). */
    setRoot(hash: Hash | null): void;
    getNode(hash: Hash): TrieNodeData | null;
    insert(entryHash: Hash, context?: Record<string, unknown>): Promise<void>;
    /** Collect all entry hashes stored across all leaf nodes. */
    collectAllEntries(): Hash[];
    /**
     * Walk an exact path of chunks, collect entries at target node + all descendants.
     * Returns empty array if any segment along the path is missing.
     */
    collectEntriesAtPath(chunks: string[]): Hash[];
    private insertAt;
    private collectEntriesFrom;
}
