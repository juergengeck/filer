/**
 * Content hash — deterministic from node content.
 * If two nodes have the same Hash, they are identical
 * (and so are all their descendants).
 */
export type Hash = string & {
    readonly __brand: 'Hash';
};
/**
 * A node in a content-addressed trie.
 * Hash is deterministic from (sorted children + sorted entries).
 */
export interface TrieNodeData {
    /** Child key prefix → child node hash */
    readonly children: ReadonlyMap<string, Hash>;
    /** Entry hashes stored at this node (leaf-level) */
    readonly entries: ReadonlySet<Hash>;
}
/**
 * Read-only view of a trie — the interface diff operates on.
 * Both local and remote tries implement this.
 */
export interface TrieReader {
    /** Current root hash, or null if empty */
    getRoot(): Hash | null;
    /** Resolve a node hash to its data */
    getNode(hash: Hash): TrieNodeData | null;
}
/**
 * Result of diffing a local trie against a remote trie.
 * Contains entries present in remote but absent in local.
 */
export interface DiffResult {
    /** Entry hashes in remote that local is missing */
    readonly missing: Hash[];
}
/**
 * Hash function — injectable, async for one.core compatibility.
 * Browser SubtleCrypto is async, so this must be too.
 */
export type HashFn = (data: string) => Promise<Hash>;
/** One root-to-leaf trie path as chunk segments. */
export type TriePath = string[];
/**
 * Key derivation function — maps an entry hash + context to one or more paths.
 * Default: hash-prefix (split hash into chunkSize pieces).
 * Time-path: derive from context.timestamp for time-indexed queries.
 * Multi-path slots can index the same entry under multiple browse keys.
 */
export type KeyFn = (entryHash: Hash, context: Record<string, unknown>) => TriePath | TriePath[];
/**
 * Configuration for trie construction.
 */
export interface TrieConfig {
    /** Characters per chunk for key splitting (default: 2) */
    chunkSize: number;
    /** Maximum trie depth in chunks (default: 4) */
    maxDepth: number;
    /** Hash function */
    hashFn: HashFn;
    /** Key derivation function (default: hash-prefix) */
    keyFn?: KeyFn;
}
/**
 * Pluggable node storage — the hash authority.
 * The store computes hashes, not the trie.
 */
export interface TrieStore {
    /** Retrieve a node by hash. */
    get(hash: Hash): TrieNodeData | null;
    /** Store a node, compute its hash, return the hash. */
    store(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash>;
}
