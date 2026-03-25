import type { TrieReader, DiffResult } from './types.js';
/**
 * Compute entries present in remote but missing from local.
 * Skips identical subtrees via hash comparison (Merkle optimization).
 * Complexity: O(changed nodes), not O(total nodes).
 */
export declare function diff(local: TrieReader, remote: TrieReader): DiffResult;
