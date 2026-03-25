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

import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

// ---------------------------------------------------------------------------
// Configuration and dependency interfaces
// ---------------------------------------------------------------------------

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
    storeVersionedObject: (obj: any) => Promise<{idHash: string; hash: string}>;
    getObjectByIdHash: (idHash: string) => Promise<{obj: any}>;
    calculateIdHashOfObj: (obj: any) => Promise<string>;
    deleteObject?: (hash: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Structural level descriptors
// ---------------------------------------------------------------------------

/** The type names for each structural level, in order. */
const STRUCTURAL_TYPES = [
    'TimeTrieYearNode',
    'TimeTrieMonthNode',
    'TimeTrieDayNode',
    'TimeTrieHourNode',
    'TimeTrieMinuteNode'
] as const;

/** How many structural levels for each depth setting. */
const DEPTH_LEVELS: Record<TimeTrieConfig['depth'], number> = {
    day: 3,     // year → month → day
    hour: 4,    // year → month → day → hour
    minute: 5   // year → month → day → hour → minute
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/** Generate all key segments for a date, prefixed with trieId. */
function withPrefix(prefix: string, value: string): string {
    return prefix ? `${prefix}:${value}` : value;
}

function dateToKeys(date: Date, keyPrefix: string): string[] {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const h = pad2(date.getHours());
    const min = pad2(date.getMinutes());
    return [
        withPrefix(keyPrefix, `${y}`),              // year
        withPrefix(keyPrefix, `${y}-${m}`),         // month
        withPrefix(keyPrefix, `${y}-${m}-${d}`),    // day
        withPrefix(keyPrefix, `${y}-${m}-${d}T${h}`),      // hour
        withPrefix(keyPrefix, `${y}-${m}-${d}T${h}:${min}`) // minute
    ];
}

/** Safety limit for leaf key generation — prevents runaway loops from bad dates. */
const MAX_LEAF_KEYS = 10_000;

/** Generate leaf keys in a range. Returns keys at the given depth level. */
function leafKeysInRange(from: Date, to: Date, keyPrefix: string, depth: TimeTrieConfig['depth']): string[] {
    const keys: string[] = [];
    const levelIndex = DEPTH_LEVELS[depth] - 1;

    if (depth === 'day') {
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
        while (current <= end && keys.length < MAX_LEAF_KEYS) {
            keys.push(dateToKeys(current, keyPrefix)[levelIndex]);
            current.setDate(current.getDate() + 1);
        }
    } else if (depth === 'hour') {
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), to.getHours());
        while (current <= end && keys.length < MAX_LEAF_KEYS) {
            keys.push(dateToKeys(current, keyPrefix)[levelIndex]);
            current.setTime(current.getTime() + 60 * 60 * 1000);
        }
    } else {
        // minute
        const current = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes());
        const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(), to.getMinutes());
        while (current <= end && keys.length < MAX_LEAF_KEYS) {
            keys.push(dateToKeys(current, keyPrefix)[levelIndex]);
            current.setTime(current.getTime() + 60 * 1000);
        }
    }

    return keys;
}

// ---------------------------------------------------------------------------
// TimeTrie
// ---------------------------------------------------------------------------

/** @deprecated Legacy ONE-backed CRDT trie. Prefer ContentAddressedTrie/MultiTrie with persisted TrieStore adapters. */
export class TimeTrie {
    private config: TimeTrieConfig;
    private deps: TimeTrieDeps;
    private structuralLevels: number;
    private structuralTypeNames: string[];
    private structuralChildFields: string[];
    private keyPrefix: string;

    constructor(config: TimeTrieConfig, deps: TimeTrieDeps) {
        this.config = config;
        this.deps = deps;
        this.structuralLevels = DEPTH_LEVELS[config.depth];
        this.keyPrefix = config.keyPrefix ?? config.trieId;
        const structuralNodeCount = this.structuralLevels - 1;
        this.structuralTypeNames = config.structuralTypeNames ?? STRUCTURAL_TYPES.slice(0, structuralNodeCount);
        this.structuralChildFields = config.structuralChildFields ?? Array.from({length: structuralNodeCount}, () => 'children');

        if (this.structuralTypeNames.length !== structuralNodeCount) {
            throw new Error(
                `TimeTrie(${config.trieId}): expected ${structuralNodeCount} structuralTypeNames, got ${this.structuralTypeNames.length}`,
            );
        }
        if (this.structuralChildFields.length !== structuralNodeCount) {
            throw new Error(
                `TimeTrie(${config.trieId}): expected ${structuralNodeCount} structuralChildFields, got ${this.structuralChildFields.length}`,
            );
        }
    }

    /**
     * Get the singleton root node, creating it if it doesn't exist.
     * Root uses the use-case-specific rootTypeName with a deterministic id.
     */
    async getOrCreateRoot(): Promise<{obj: any; idHash: string}> {
        const rootObj = {
            $type$: this.config.rootTypeName,
            id: this.config.rootId ?? `${this.config.trieId}-trie`,
            [this.config.rootChildField]: new Set()
        };
        const idHash = await this.deps.calculateIdHashOfObj(rootObj);

        try {
            const result = await this.deps.getObjectByIdHash(idHash);
            return {obj: result.obj, idHash};
        } catch {
            const result = await this.deps.storeVersionedObject(rootObj);
            return {obj: rootObj, idHash: result.idHash};
        }
    }

    /**
     * Insert an entry hash into the trie at the given timestamp.
     * Creates any missing nodes along the path.
     * CRDT Set merge ensures concurrent inserts converge.
     *
     * @returns The idHash of the leaf node containing the entry
     */
    async insert(entryHash: string, timestamp: Date): Promise<string> {
        const keys = dateToKeys(timestamp, this.keyPrefix);

        // Build path from leaf up to root.
        // Start with the leaf node (use-case-specific type).
        const leafKey = keys[this.structuralLevels - 1];
        const leafIdHash = await this.getOrCreateLeaf(leafKey, entryHash);

        // Walk up structural levels (deepest first, excluding root level).
        let childIdHash = leafIdHash;
        for (let level = this.structuralLevels - 2; level >= 0; level--) {
            const typeName = this.structuralTypeNames[level];
            const childField = this.structuralChildFields[level];
            const key = keys[level];
            childIdHash = await this.getOrCreateStructuralNode(typeName, key, childField, childIdHash);
        }

        // Add top structural node to root
        const {obj: root} = await this.getOrCreateRoot();
        const updatedChildren = new Set(root[this.config.rootChildField] as Set<string>);
        if (!updatedChildren.has(childIdHash)) {
            updatedChildren.add(childIdHash);
            await this.deps.storeVersionedObject({
                ...root,
                [this.config.rootChildField]: updatedChildren
            });
        }

        return leafIdHash;
    }

    /**
     * Query all entry hashes within a date range [from, to] inclusive.
     * Loads leaf nodes in parallel for efficiency.
     */
    async queryRange(from: Date, to: Date): Promise<string[]> {
        const leafKeys = leafKeysInRange(from, to, this.keyPrefix, this.config.depth);
        const results: string[] = [];

        const leaves = await Promise.all(
            leafKeys.map(async key => {
                try {
                    return await this.loadLeafByKey(key);
                } catch {
                    return null;
                }
            })
        );

        for (const leaf of leaves) {
            if (leaf && !leaf.tombstoned) {
                const entries = leaf[this.config.leafEntryField] as Set<string>;
                for (const entry of entries) {
                    results.push(entry);
                }
            }
        }

        return results;
    }

    /**
     * Query all entry hashes for a specific leaf (at the configured depth).
     */
    async queryLeaf(date: Date): Promise<string[]> {
        const keys = dateToKeys(date, this.keyPrefix);
        const leafKey = keys[this.structuralLevels - 1];
        try {
            const leaf = await this.loadLeafByKey(leafKey);
            if (leaf.tombstoned) {
                return [];
            }
            return Array.from(leaf[this.config.leafEntryField] as Set<string>);
        } catch {
            return [];
        }
    }

    /**
     * Check whether an exact entry hash is already indexed at the leaf for the
     * given timestamp.
     */
    async hasEntry(entryHash: string, timestamp: Date): Promise<boolean> {
        const keys = dateToKeys(timestamp, this.keyPrefix);
        const leafKey = keys[this.structuralLevels - 1];
        try {
            const leaf = await this.loadLeafByKey(leafKey);
            if (leaf.tombstoned) {
                return false;
            }
            return (leaf[this.config.leafEntryField] as Set<string>).has(entryHash);
        } catch {
            return false;
        }
    }

    /**
     * Walk the trie newest-first and return all retained entry hashes.
     */
    async collectAllEntriesNewestFirst(): Promise<string[]> {
        try {
            const {obj: root} = await this.getOrCreateRoot();
            const entries: string[] = [];
            const yearIdHashes = await this.sortNodeIdsNewestFirst(
                Array.from(root[this.config.rootChildField] as Set<string>)
            );

            for (const yearIdHash of yearIdHashes) {
                await this.collectEntriesNewestFirstFromNode(yearIdHash, 0, entries);
            }

            return entries;
        } catch {
            return [];
        }
    }

    /**
     * Collect all entry hashes reachable from the trie root.
     */
    async collectAllEntries(): Promise<string[]> {
        try {
            const {obj: root} = await this.getOrCreateRoot();
            const children = root[this.config.rootChildField] as Set<string>;
            const entries = new Set<string>();
            for (const childIdHash of children) {
                await this.collectEntriesFromNode(childIdHash, 0, entries);
            }
            return [...entries];
        } catch {
            return [];
        }
    }

    /**
     * Mark a leaf node as tombstoned for GC.
     * @returns Number of entries that were in the leaf
     */
    async tombstoneLeaf(leafKey: string): Promise<number> {
        const leaf = await this.loadLeafByKey(leafKey);
        if (leaf.tombstoned) return 0;

        const entries = leaf[this.config.leafEntryField] as Set<string>;
        const count = entries.size;

        await this.deps.storeVersionedObject({
            ...leaf,
            tombstoned: true
        });

        // GC: delete entry objects if supported
        if (this.deps.deleteObject) {
            for (const hash of entries) {
                try {
                    await this.deps.deleteObject(hash);
                } catch {
                    // Object may already be gone or shared
                }
            }
        }

        return count;
    }

    /**
     * Walk the trie oldest-first and tombstone leaves older than cutoff.
     *
     * @param maxUnitsToKeep Units from now to retain (days/hours/minutes depending on depth)
     * @returns Total number of entries reclaimed
     */
    async reclaimStorage(maxUnitsToKeep: number): Promise<number> {
        const cutoff = new Date();
        if (this.config.depth === 'day') {
            cutoff.setDate(cutoff.getDate() - maxUnitsToKeep);
        } else if (this.config.depth === 'hour') {
            cutoff.setTime(cutoff.getTime() - maxUnitsToKeep * 60 * 60 * 1000);
        } else {
            cutoff.setTime(cutoff.getTime() - maxUnitsToKeep * 60 * 1000);
        }

        let reclaimedCount = 0;

        try {
            const {obj: root} = await this.getOrCreateRoot();
            const yearIdHashes = root[this.config.rootChildField] as Set<string>;

            for (const yearIdHash of yearIdHashes) {
                reclaimedCount += await this.reclaimFromNode(yearIdHash, 0, cutoff);
            }
        } catch (error) {
            console.warn(`[TimeTrie:${this.config.trieId}] reclaimStorage error:`, error);
        }

        return reclaimedCount;
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Recursively walk structural nodes and tombstone old leaves.
     */
    private async reclaimFromNode(idHash: string, level: number, cutoff: Date): Promise<number> {
        let reclaimed = 0;

        try {
            const {obj: node} = await this.deps.getObjectByIdHash(idHash);

            if (level === this.structuralLevels - 2) {
                // This is the parent of leaves — its children are leaf nodes
                const childField = this.structuralChildFields[level];
                const children = node[childField] as Set<string>;
                for (const childIdHash of children) {
                    try {
                        const {obj: leaf} = await this.deps.getObjectByIdHash(childIdHash);
                        if (leaf.tombstoned) continue;

                        const leafDate = this.parseLeafKey(leaf.key as string);
                        if (leafDate && leafDate < cutoff) {
                            reclaimed += await this.tombstoneLeaf(leaf.key as string);
                        }
                    } catch {
                        // Leaf not found
                    }
                }
            } else if (level < this.structuralLevels - 2) {
                // Intermediate structural node — recurse
                const childField = this.structuralChildFields[level];
                const children = node[childField] as Set<string>;
                for (const childIdHash of children) {
                    reclaimed += await this.reclaimFromNode(childIdHash, level + 1, cutoff);
                }
            }
        } catch {
            // Node not found
        }

        return reclaimed;
    }

    private async collectEntriesFromNode(idHash: string, level: number, entries: Set<string>): Promise<void> {
        try {
            const {obj: node} = await this.deps.getObjectByIdHash(idHash);

            if (level === this.structuralLevels - 1) {
                const leafEntries = node[this.config.leafEntryField] as Set<string>;
                for (const entry of leafEntries) {
                    entries.add(entry);
                }
                return;
            }

            const childField = this.structuralChildFields[level];
            const children = node[childField] as Set<string>;
            for (const childIdHash of children) {
                await this.collectEntriesFromNode(childIdHash, level + 1, entries);
            }
        } catch {
            // Missing node — ignore during best-effort traversal
        }
    }

    private async collectEntriesNewestFirstFromNode(idHash: string, level: number, entries: string[]): Promise<void> {
        try {
            const {obj: node} = await this.deps.getObjectByIdHash(idHash);

            if (level === this.structuralLevels - 1) {
                if (node.tombstoned) {
                    return;
                }
                const leafEntries = node[this.config.leafEntryField] as Set<string>;
                entries.push(...leafEntries);
                return;
            }

            const childField = this.structuralChildFields[level];
            const childIdHashes = await this.sortNodeIdsNewestFirst(
                Array.from(node[childField] as Set<string>)
            );
            for (const childIdHash of childIdHashes) {
                await this.collectEntriesNewestFirstFromNode(childIdHash, level + 1, entries);
            }
        } catch {
            // Missing node — ignore during best-effort traversal
        }
    }

    /**
     * Parse a leaf key back to a Date for cutoff comparison.
     * Key format: `{trieId}:{date-part}` where date-part depends on depth.
     */
    private parseLeafKey(key: string): Date | null {
        const prefix = this.keyPrefix ? `${this.keyPrefix}:` : '';
        if (prefix && !key.startsWith(prefix)) return null;
        const datePart = prefix ? key.substring(prefix.length) : key;

        try {
            if (this.config.depth === 'day') {
                return new Date(datePart + 'T00:00:00');
            } else if (this.config.depth === 'hour') {
                return new Date(datePart + ':00:00');
            } else {
                return new Date(datePart + ':00');
            }
        } catch {
            return null;
        }
    }

    /**
     * Get or create a structural trie node (Year/Month/Day/Hour).
     * Adds childIdHash to its `children` set via CRDT merge.
     */
    private async getOrCreateStructuralNode(
        typeName: string,
        key: string,
        childField: string,
        childIdHash: string
    ): Promise<string> {
        const skeleton = {$type$: typeName, key} as any;
        const idHash = await this.deps.calculateIdHashOfObj(skeleton);

        try {
            const {obj} = await this.deps.getObjectByIdHash(idHash);
            const updatedChildren = new Set(obj[childField] as Set<string>);
            if (updatedChildren.has(childIdHash)) {
                return idHash;
            }
            updatedChildren.add(childIdHash);
            await this.deps.storeVersionedObject({...obj, [childField]: updatedChildren});
            return idHash;
        } catch {
            const newNode = {
                $type$: typeName,
                key,
                [childField]: new Set([childIdHash])
            };
            const result = await this.deps.storeVersionedObject(newNode);
            return result.idHash;
        }
    }

    /**
     * Get or create a use-case-specific leaf node.
     * Adds entryHash to its entry set (leafEntryField) via CRDT merge.
     */
    private async getOrCreateLeaf(key: string, entryHash: string): Promise<string> {
        const skeleton = {$type$: this.config.leafTypeName, key} as any;
        const idHash = await this.deps.calculateIdHashOfObj(skeleton);

        try {
            const {obj} = await this.deps.getObjectByIdHash(idHash);
            const updatedEntries = new Set(obj[this.config.leafEntryField] as Set<string>);
            if (updatedEntries.has(entryHash)) {
                return idHash;
            }
            updatedEntries.add(entryHash);
            await this.deps.storeVersionedObject({
                ...obj,
                [this.config.leafEntryField]: updatedEntries
            });
            return idHash;
        } catch {
            const newLeaf = {
                $type$: this.config.leafTypeName,
                key,
                [this.config.leafEntryField]: new Set([entryHash])
            };
            const result = await this.deps.storeVersionedObject(newLeaf);
            return result.idHash;
        }
    }

    /**
     * Load a leaf node by computing its idHash from the key.
     * Throws if the leaf doesn't exist.
     */
    private async loadLeafByKey(key: string): Promise<any> {
        const skeleton = {$type$: this.config.leafTypeName, key} as any;
        const idHash = await this.deps.calculateIdHashOfObj(skeleton);
        const {obj} = await this.deps.getObjectByIdHash(idHash);
        return obj;
    }

    private async sortNodeIdsNewestFirst(idHashes: string[]): Promise<string[]> {
        const nodes = await Promise.all(
            idHashes.map(async idHash => {
                const {obj} = await this.deps.getObjectByIdHash(idHash);
                return {idHash, key: String(obj.key ?? '')};
            })
        );
        nodes.sort((left, right) => right.key.localeCompare(left.key));
        return nodes.map(node => node.idHash);
    }
}
