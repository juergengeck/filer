import type { TrieConfig, TrieReader } from './types.js';
import { ContentAddressedTrie } from './trie.js';
/**
 * Serialized snapshot of a trie — JSON-safe, preserves all structure.
 */
export interface TrieSnapshot {
    root: string | null;
    nodes: SnapshotNode[];
}
interface SnapshotNode {
    hash: string;
    children: [string, string][];
    entries: string[];
}
/**
 * Serialize a trie into a JSON-safe snapshot.
 * Walks all reachable nodes from the root.
 */
export declare function serializeTrie(trie: TrieReader): TrieSnapshot;
/**
 * Deserialize a snapshot back into a ContentAddressedTrie.
 * Populates the store directly, then sets the root.
 */
export declare function deserializeTrie(snapshot: TrieSnapshot, config: TrieConfig): Promise<ContentAddressedTrie>;
export {};
