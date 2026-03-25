import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Hash, TrieNodeData, TrieStore} from './types.js';

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
    storeVersionedObject(obj: Record<string, unknown>): Promise<{idHash: string}>;
    getObjectByIdHash(idHash: string): Promise<{obj: Record<string, unknown>}>;
    calculateIdHashOfObj(obj: Record<string, unknown>): Promise<string>;
}

export class BufferedTrieStore implements TrieStore {
    private readonly inner: TrieStore;
    private readonly dirty = new Map<Hash, TrieNodeData>();

    constructor(inner: TrieStore) {
        this.inner = inner;
    }

    get(hash: Hash): TrieNodeData | null {
        return this.inner.get(hash);
    }

    async store(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash> {
        const hash = await this.inner.store(children, entries);
        const node = this.inner.get(hash);
        if (!node) {
            throw new Error(`BufferedTrieStore: stored node ${hash} missing from inner store`);
        }
        this.dirty.set(hash, node);
        return hash;
    }

    async loadClean(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash> {
        return this.inner.store(children, entries);
    }

    async flush(deps: PersistedTrieStoreDeps): Promise<SHA256IdHash[]> {
        const orderedHashes: Hash[] = [];
        const visiting = new Set<Hash>();
        const visited = new Set<Hash>();

        const visit = (hash: Hash): void => {
            if (visited.has(hash)) {
                return;
            }
            if (visiting.has(hash)) {
                throw new Error(`BufferedTrieStore: cycle detected while flushing trie node ${hash}`);
            }

            const node = this.dirty.get(hash);
            if (!node) {
                return;
            }

            visiting.add(hash);
            for (const childHash of node.children.values()) {
                if (this.dirty.has(childHash)) {
                    visit(childHash);
                }
            }
            visiting.delete(hash);
            visited.add(hash);
            orderedHashes.push(hash);
        };

        for (const hash of this.dirty.keys()) {
            visit(hash);
        }

        const storedIds: SHA256IdHash[] = [];
        for (const hash of orderedHashes) {
            const node = this.dirty.get(hash);
            if (!node) {
                continue;
            }
            storedIds.push(await deps.storeNode(hash, node.children, node.entries));
        }
        this.dirty.clear();
        return storedIds;
    }

    hasDirty(): boolean {
        return this.dirty.size > 0;
    }
}

export async function loadTrieSubtree(
    nodeHash: Hash,
    buffered: BufferedTrieStore,
    deps: PersistedTrieStoreDeps
): Promise<void> {
    if (buffered.get(nodeHash)) {
        return;
    }

    const node = await deps.loadNode(nodeHash);
    if (!node) {
        throw new Error(`Trie node not found: ${nodeHash}`);
    }

    await buffered.loadClean(node.children, node.entries);
    for (const childHash of node.children.values()) {
        await loadTrieSubtree(childHash, buffered, deps);
    }
}

export function createOneCoreTrieStore(
    storage: OneCoreTrieStorageDeps,
    nodeTypeName: string,
    rootTypeName: string
): PersistedTrieStoreDeps {
    return {
        async storeNode(hash: Hash, children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<SHA256IdHash> {
            const childIdHashes = await Promise.all(
                [...children.values()].map((value) =>
                    storage.calculateIdHashOfObj({
                        $type$: nodeTypeName,
                        id: value as string
                    })
                )
            );
            const obj: PersistedTrieNode = {
                $type$: nodeTypeName,
                id: hash as string,
                children: [...children.entries()].map(([key, value]) => [key, value as string]),
                childIds: new Set(childIdHashes),
                entries: new Set([...entries].map(entry => entry as string as SHA256Hash))
            };
            const result = await storage.storeVersionedObject(obj as unknown as Record<string, unknown>);
            return result.idHash as SHA256IdHash;
        },

        async loadNode(hash: Hash): Promise<TrieNodeData | null> {
            try {
                const idHash = await storage.calculateIdHashOfObj({
                    $type$: nodeTypeName,
                    id: hash
                });
                const result = await storage.getObjectByIdHash(idHash as SHA256IdHash<any>);
                const obj = result.obj as unknown as PersistedTrieNode;
                return {
                    children: new Map(obj.children.map(([key, value]) => [key, value as Hash])),
                    entries: new Set([...obj.entries].map(entry => entry as unknown as Hash))
                };
            } catch {
                return null;
            }
        },

        async storeRoot(rootId: string, rootHash: Hash | null): Promise<SHA256IdHash> {
            const obj: PersistedTrieRoot = {
                $type$: rootTypeName,
                id: rootId,
                root: rootHash,
                rootId: rootHash
                    ? await storage.calculateIdHashOfObj({
                        $type$: nodeTypeName,
                        id: rootHash as string
                    })
                    : null
            };
            const result = await storage.storeVersionedObject(obj as unknown as Record<string, unknown>);
            return result.idHash as SHA256IdHash;
        },

        async loadRoot(rootId: string): Promise<Hash | null> {
            try {
                const idHash = await storage.calculateIdHashOfObj({
                    $type$: rootTypeName,
                    id: rootId
                });
                const result = await storage.getObjectByIdHash(idHash as SHA256IdHash<any>);
                const obj = result.obj as unknown as PersistedTrieRoot;
                return (obj.root as Hash | null) ?? null;
            } catch {
                return null;
            }
        }
    };
}

export function createPersistedTrieNodeRecipe(
    name: string,
    entryAllowedTypes: Set<string>
): Recipe {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'id',
                isId: true,
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'children',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'array',
                        item: {type: 'string'}
                    }
                }
            },
            {
                itemprop: 'childIds',
                itemtype: {
                    type: 'set',
                    item: {type: 'referenceToId', allowedTypes: new Set([name])}
                },
                optional: true
            },
            {
                itemprop: 'entries',
                itemtype: {
                    type: 'set',
                    item: {type: 'referenceToObj', allowedTypes: entryAllowedTypes}
                }
            }
        ]
    };
}

export function createPersistedTrieRootRecipe(name: string, nodeTypeName: string = '*'): Recipe {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'id',
                isId: true,
                itemtype: {type: 'string'}
            },
            {
                itemprop: 'root',
                itemtype: {type: 'string'},
                optional: true
            },
            {
                itemprop: 'rootId',
                itemtype: {type: 'referenceToId', allowedTypes: new Set([nodeTypeName])},
                optional: true
            }
        ]
    };
}
