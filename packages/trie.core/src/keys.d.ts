/**
 * Predefined key derivation functions for ContentAddressedTrie.
 *
 * hashPrefixKeyFn — splits entry hash into fixed-size chunks (existing behaviour).
 * timePathKeyFn — derives path from context.timestamp for time-indexed queries.
 * timePathLeafKeys — enumerates all leaf-level paths in a date range.
 */
import type { KeyFn } from './types.js';
/**
 * Split the entry hash into fixed-size chunks for trie navigation.
 * E.g. chunkSize=2, maxDepth=4: 'a3f8b201...' → ['a3','f8','b2','01']
 */
export declare function hashPrefixKeyFn(chunkSize: number, maxDepth: number): KeyFn;
type TimeDepth = 'day' | 'hour' | 'minute';
/**
 * Derive trie path from context.timestamp (Date).
 * Path segments are prefixed with trieId for instance isolation.
 *
 * Throws if context.timestamp is missing — no fallbacks.
 */
export declare function timePathKeyFn(depth: TimeDepth, trieId: string): KeyFn;
/**
 * Enumerate all full leaf-level chunk arrays in a date range.
 * Each result is a complete path from root to leaf.
 * Used by callers to drive collectEntriesAtPath.
 */
export declare function timePathLeafKeys(from: Date, to: Date, trieId: string, depth: TimeDepth): string[][];
export {};
