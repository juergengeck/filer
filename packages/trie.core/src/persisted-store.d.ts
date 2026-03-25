import type { Recipe } from '@refinio/one.core/lib/recipes.js';
import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Hash, TrieNodeData, TrieStore } from './types.js';
export interface PersistedTrieNode {
    $type$: string;
    id: string;
    children: Array<[string, string]>;
    childIds?: Set<string>;
    entries: Set<SHA256Hash>;
}
export interface PersistedTrieRoot {
    $type$: string;
    id: string;
    root?: string | null;
    rootId?: string | null;
}
export interface PersistedTrieStoreDeps {
    storeNode(hash: Hash, children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<SHA256IdHash>;
    loadNode(hash: Hash): Promise<TrieNodeData | null>;
    storeRoot(rootId: string, rootHash: Hash | null): Promise<SHA256IdHash>;
    loadRoot(rootId: string): Promise<Hash | null>;
}
export interface OneCoreTrieStorageDeps {
    storeVersionedObject(obj: Record<string, unknown>): Promise<{
        idHash: string;
    }>;
    getObjectByIdHash(idHash: string): Promise<{
        obj: Record<string, unknown>;
    }>;
    calculateIdHashOfObj(obj: Record<string, unknown>): Promise<string>;
}
export declare class BufferedTrieStore implements TrieStore {
    private readonly inner;
    private readonly dirty;
    constructor(inner: TrieStore);
    get(hash: Hash): TrieNodeData | null;
    store(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash>;
    loadClean(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash>;
    flush(deps: PersistedTrieStoreDeps): Promise<SHA256IdHash[]>;
    hasDirty(): boolean;
}
export declare function loadTrieSubtree(nodeHash: Hash, buffered: BufferedTrieStore, deps: PersistedTrieStoreDeps): Promise<void>;
export declare function createOneCoreTrieStore(storage: OneCoreTrieStorageDeps, nodeTypeName: string, rootTypeName: string): PersistedTrieStoreDeps;
export declare function createPersistedTrieNodeRecipe(name: string, entryAllowedTypes: Set<string>): Recipe;
export declare function createPersistedTrieRootRecipe(name: string, nodeTypeName?: string): Recipe;
