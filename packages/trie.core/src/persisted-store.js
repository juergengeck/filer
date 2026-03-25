export class BufferedTrieStore {
    inner;
    dirty = new Map();
    constructor(inner) {
        this.inner = inner;
    }
    get(hash) {
        return this.inner.get(hash);
    }
    async store(children, entries) {
        const hash = await this.inner.store(children, entries);
        const node = this.inner.get(hash);
        if (!node) {
            throw new Error(`BufferedTrieStore: stored node ${hash} missing from inner store`);
        }
        this.dirty.set(hash, node);
        return hash;
    }
    async loadClean(children, entries) {
        return this.inner.store(children, entries);
    }
    async flush(deps) {
        const orderedHashes = [];
        const visiting = new Set();
        const visited = new Set();
        const visit = (hash) => {
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
        const storedIds = [];
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
    hasDirty() {
        return this.dirty.size > 0;
    }
}
export async function loadTrieSubtree(nodeHash, buffered, deps) {
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
export function createOneCoreTrieStore(storage, nodeTypeName, rootTypeName) {
    return {
        async storeNode(hash, children, entries) {
            const childIdHashes = await Promise.all([...children.values()].map((value) => storage.calculateIdHashOfObj({
                $type$: nodeTypeName,
                id: value
            })));
            const obj = {
                $type$: nodeTypeName,
                id: hash,
                children: [...children.entries()].map(([key, value]) => [key, value]),
                childIds: new Set(childIdHashes),
                entries: new Set([...entries].map(entry => entry))
            };
            const result = await storage.storeVersionedObject(obj);
            return result.idHash;
        },
        async loadNode(hash) {
            try {
                const idHash = await storage.calculateIdHashOfObj({
                    $type$: nodeTypeName,
                    id: hash
                });
                const result = await storage.getObjectByIdHash(idHash);
                const obj = result.obj;
                return {
                    children: new Map(obj.children.map(([key, value]) => [key, value])),
                    entries: new Set([...obj.entries].map(entry => entry))
                };
            }
            catch {
                return null;
            }
        },
        async storeRoot(rootId, rootHash) {
            const obj = {
                $type$: rootTypeName,
                id: rootId,
                root: rootHash,
                rootId: rootHash
                    ? await storage.calculateIdHashOfObj({
                        $type$: nodeTypeName,
                        id: rootHash
                    })
                    : null
            };
            const result = await storage.storeVersionedObject(obj);
            return result.idHash;
        },
        async loadRoot(rootId) {
            try {
                const idHash = await storage.calculateIdHashOfObj({
                    $type$: rootTypeName,
                    id: rootId
                });
                const result = await storage.getObjectByIdHash(idHash);
                const obj = result.obj;
                return obj.root ?? null;
            }
            catch {
                return null;
            }
        }
    };
}
export function createPersistedTrieNodeRecipe(name, entryAllowedTypes) {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'id',
                isId: true,
                itemtype: { type: 'string' }
            },
            {
                itemprop: 'children',
                itemtype: {
                    type: 'array',
                    item: {
                        type: 'array',
                        item: { type: 'string' }
                    }
                }
            },
            {
                itemprop: 'childIds',
                itemtype: {
                    type: 'set',
                    item: { type: 'referenceToId', allowedTypes: new Set([name]) }
                },
                optional: true
            },
            {
                itemprop: 'entries',
                itemtype: {
                    type: 'set',
                    item: { type: 'referenceToObj', allowedTypes: entryAllowedTypes }
                }
            }
        ]
    };
}
export function createPersistedTrieRootRecipe(name, nodeTypeName = '*') {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'id',
                isId: true,
                itemtype: { type: 'string' }
            },
            {
                itemprop: 'root',
                itemtype: { type: 'string' },
                optional: true
            },
            {
                itemprop: 'rootId',
                itemtype: { type: 'referenceToId', allowedTypes: new Set([nodeTypeName]) },
                optional: true
            }
        ]
    };
}
