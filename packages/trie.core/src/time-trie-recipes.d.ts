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
import type { Recipe, VersionNode } from '@refinio/one.core/lib/recipes.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
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
export declare const TimeTrieYearNodeRecipe: Recipe;
export declare const TimeTrieMonthNodeRecipe: Recipe;
export declare const TimeTrieDayNodeRecipe: Recipe;
export declare const TimeTrieHourNodeRecipe: Recipe;
export declare const TimeTrieMinuteNodeRecipe: Recipe;
declare const TimeTrieRecipes: Recipe[];
export default TimeTrieRecipes;
