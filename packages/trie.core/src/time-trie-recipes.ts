/**
 * TimeTrieRecipes — Shared structural node recipes for the reusable TimeTrie CRDT.
 *
 * Each node has `key: string` (isId) + `children: Set<SHA256IdHash>` (referenceToId).
 * Keys are prefixed with trieId for instance isolation (e.g., `presence:2026-03`).
 *
 * Hierarchy: Year → Month → Day → Hour → Minute
 * Configurable depth — consumers pick how deep the trie goes.
 *
 * CRDT Set merge: storeVersionedObject on existing nodes auto-merges
 * via add-wins Set union (same as GlueContentTrie).
 */
import type {Recipe, VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

// ---------------------------------------------------------------------------
// TypeScript interfaces
// ---------------------------------------------------------------------------

export interface TimeTrieYearNode {
    $type$: 'TimeTrieYearNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Year key, e.g. "presence:2026" */
    key: string;
    /** CRDT Set of child node idHashes */
    children: Set<SHA256IdHash>;
    /** If true, all descendants have been GC'd */
    tombstoned?: boolean;
}

export interface TimeTrieMonthNode {
    $type$: 'TimeTrieMonthNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Month key, e.g. "presence:2026-03" */
    key: string;
    /** CRDT Set of child node idHashes */
    children: Set<SHA256IdHash>;
    /** If true, all descendants have been GC'd */
    tombstoned?: boolean;
}

export interface TimeTrieDayNode {
    $type$: 'TimeTrieDayNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Day key, e.g. "presence:2026-03-03" */
    key: string;
    /** CRDT Set of child node idHashes */
    children: Set<SHA256IdHash>;
    /** If true, all descendants have been GC'd */
    tombstoned?: boolean;
}

export interface TimeTrieHourNode {
    $type$: 'TimeTrieHourNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Hour key, e.g. "presence:2026-03-03T14" */
    key: string;
    /** CRDT Set of child node idHashes */
    children: Set<SHA256IdHash>;
    /** If true, all descendants have been GC'd */
    tombstoned?: boolean;
}

export interface TimeTrieMinuteNode {
    $type$: 'TimeTrieMinuteNode';
    $versionHash$?: SHA256Hash<VersionNode>;
    /** Minute key, e.g. "presence:2026-03-03T14:30" */
    key: string;
    /** CRDT Set of child node idHashes */
    children: Set<SHA256IdHash>;
    /** If true, all descendants have been GC'd */
    tombstoned?: boolean;
}

// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------

/**
 * @deprecated TimeTrie structural recipes are for the legacy ONE-backed CRDT trie.
 * Prefer persisted ContentAddressedTrie/MultiTrie node/root recipes.
 *
 * Allowed child types for structural nodes.
 * Includes all structural levels plus use-case-specific leaf types.
 * Add new leaf types here when creating new time-trie consumers.
 */
const ALLOWED_CHILD_TYPES = new Set(['*']);

function makeTimeTrieNodeRecipe(name: string): Recipe {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'key',
                isId: true,
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'children',
                itemtype: {
                    type: 'set',
                    item: {type: 'referenceToId', allowedTypes: ALLOWED_CHILD_TYPES}
                }
            },
            {
                itemprop: 'tombstoned',
                optional: true,
                itemtype: {type: 'boolean'}
            }
        ]
    };
}

export const TimeTrieYearNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieYearNode');
export const TimeTrieMonthNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieMonthNode');
export const TimeTrieDayNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieDayNode');
export const TimeTrieHourNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieHourNode');
export const TimeTrieMinuteNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieMinuteNode');

const TimeTrieRecipes: Recipe[] = [
    TimeTrieYearNodeRecipe,
    TimeTrieMonthNodeRecipe,
    TimeTrieDayNodeRecipe,
    TimeTrieHourNodeRecipe,
    TimeTrieMinuteNodeRecipe
];

export default TimeTrieRecipes;
