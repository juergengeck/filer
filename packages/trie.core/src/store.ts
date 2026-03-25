import type {Hash, HashFn, TrieNodeData, TrieStore} from './types.js';

export class InMemoryTrieStore implements TrieStore {
    private readonly nodes = new Map<Hash, TrieNodeData>();
    private readonly hashFn: HashFn;

    constructor(hashFn: HashFn) {
        this.hashFn = hashFn;
    }

    get(hash: Hash): TrieNodeData | null {
        return this.nodes.get(hash) ?? null;
    }

    async store(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash> {
        const hash = await this.computeHash(children, entries);
        this.nodes.set(hash, {children, entries});
        return hash;
    }

    private computeHash(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash> {
        const childParts = [...children.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`);
        const entryParts = [...entries].sort();
        const content = `children[${childParts.join(',')}]entries[${entryParts.join(',')}]`;
        return this.hashFn(content);
    }
}
