/**
 * TimeTrie — Reusable time-trie CRDT for time-ordered event streams.
 *
 * Organizes entries in a hierarchical time-based trie with configurable depth:
 *   Root → Year → Month → Day → [Hour → [Minute →]] Leaf
 *
 * Root and leaf types are use-case-specific (e.g., PresenceTrieRoot, PresenceLeafNode).
 * Intermediate nodes use shared TimeTrieRecipes (Year/Month/Day/Hour/Minute).
 *
 * Keys are prefixed with trieId for instance isolation (e.g., `presence:2026-03`).
 *
 * CRDT Set merge: storeVersionedObject on existing nodes auto-merges
 * via add-wins Set union. Concurrent inserts from multiple peers converge.
 *
 * Dependencies are injected (no direct ONE.core imports at runtime).
 */
/** @deprecated Legacy ONE-backed CRDT trie. Prefer ContentAddressedTrie/MultiTrie with persisted TrieStore adapters. */
export interface TimeTrieConfig {
    /** Instance identity — prefixes all keys for isolation ('presence', 'content', etc.) */
    trieId: string;
    /** Optional key prefix for structural/leaf keys. Defaults to `trieId`. Use '' for legacy unprefixed keys. */
    keyPrefix?: string;
    /** Optional deterministic id for the root object. Defaults to `${trieId}-trie`. */
    rootId?: string;
    /** How deep the structural trie goes before hitting the leaf */
    depth: 'day' | 'hour' | 'minute';
    /** Use-case-specific root recipe type name (e.g., 'PresenceTrieRoot') */
    rootTypeName: string;
    /** Field on root that holds year idHashes (e.g., 'years') */
    rootChildField: string;
    /**
     * Optional per-level structural node type names from year downward.
     * Defaults to the shared TimeTrie structural recipe names.
     */
    structuralTypeNames?: string[];
    /**
     * Optional per-level structural child fields from year downward.
     * Defaults to `children` at every structural level.
     */
    structuralChildFields?: string[];
    /** Use-case-specific leaf recipe type name (e.g., 'PresenceLeafNode') */
    leafTypeName: string;
    /** Set field on leaf that holds entries (e.g., 'events', 'entries') */
    leafEntryField: string;
}
/** @deprecated Legacy ONE-backed CRDT trie. Prefer ContentAddressedTrie/MultiTrie with persisted TrieStore adapters. */
export interface TimeTrieDeps {
    storeVersionedObject: (obj: any) => Promise<{
        idHash: string;
        hash: string;
    }>;
    getObjectByIdHash: (idHash: string) => Promise<{
        obj: any;
    }>;
    calculateIdHashOfObj: (obj: any) => Promise<string>;
    deleteObject?: (hash: string) => Promise<void>;
}
/** @deprecated Legacy ONE-backed CRDT trie. Prefer ContentAddressedTrie/MultiTrie with persisted TrieStore adapters. */
export declare class TimeTrie {
    private config;
    private deps;
    private structuralLevels;
    private structuralTypeNames;
    private structuralChildFields;
    private keyPrefix;
    constructor(config: TimeTrieConfig, deps: TimeTrieDeps);
    /**
     * Get the singleton root node, creating it if it doesn't exist.
     * Root uses the use-case-specific rootTypeName with a deterministic id.
     */
    getOrCreateRoot(): Promise<{
        obj: any;
        idHash: string;
    }>;
    /**
     * Insert an entry hash into the trie at the given timestamp.
     * Creates any missing nodes along the path.
     * CRDT Set merge ensures concurrent inserts converge.
     *
     * @returns The idHash of the leaf node containing the entry
     */
    insert(entryHash: string, timestamp: Date): Promise<string>;
    /**
     * Query all entry hashes within a date range [from, to] inclusive.
     * Loads leaf nodes in parallel for efficiency.
     */
    queryRange(from: Date, to: Date): Promise<string[]>;
    /**
     * Query all entry hashes for a specific leaf (at the configured depth).
     */
    queryLeaf(date: Date): Promise<string[]>;
    /**
     * Check whether an exact entry hash is already indexed at the leaf for the
     * given timestamp.
     */
    hasEntry(entryHash: string, timestamp: Date): Promise<boolean>;
    /**
     * Walk the trie newest-first and return all retained entry hashes.
     */
    collectAllEntriesNewestFirst(): Promise<string[]>;
    /**
     * Collect all entry hashes reachable from the trie root.
     */
    collectAllEntries(): Promise<string[]>;
    /**
     * Mark a leaf node as tombstoned for GC.
     * @returns Number of entries that were in the leaf
     */
    tombstoneLeaf(leafKey: string): Promise<number>;
    /**
     * Walk the trie oldest-first and tombstone leaves older than cutoff.
     *
     * @param maxUnitsToKeep Units from now to retain (days/hours/minutes depending on depth)
     * @returns Total number of entries reclaimed
     */
    reclaimStorage(maxUnitsToKeep: number): Promise<number>;
    /**
     * Recursively walk structural nodes and tombstone old leaves.
     */
    private reclaimFromNode;
    private collectEntriesFromNode;
    private collectEntriesNewestFirstFromNode;
    /**
     * Parse a leaf key back to a Date for cutoff comparison.
     * Key format: `{trieId}:{date-part}` where date-part depends on depth.
     */
    private parseLeafKey;
    /**
     * Get or create a structural trie node (Year/Month/Day/Hour).
     * Adds childIdHash to its `children` set via CRDT merge.
     */
    private getOrCreateStructuralNode;
    /**
     * Get or create a use-case-specific leaf node.
     * Adds entryHash to its entry set (leafEntryField) via CRDT merge.
     */
    private getOrCreateLeaf;
    /**
     * Load a leaf node by computing its idHash from the key.
     * Throws if the leaf doesn't exist.
     */
    private loadLeafByKey;
    private sortNodeIdsNewestFirst;
}
