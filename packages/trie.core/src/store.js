export class InMemoryTrieStore {
    nodes = new Map();
    hashFn;
    constructor(hashFn) {
        this.hashFn = hashFn;
    }
    get(hash) {
        return this.nodes.get(hash) ?? null;
    }
    async store(children, entries) {
        const hash = await this.computeHash(children, entries);
        this.nodes.set(hash, { children, entries });
        return hash;
    }
    computeHash(children, entries) {
        const childParts = [...children.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`);
        const entryParts = [...entries].sort();
        const content = `children[${childParts.join(',')}]entries[${entryParts.join(',')}]`;
        return this.hashFn(content);
    }
}
