import { InMemoryTrieStore } from './store.js';
import { hashPrefixKeyFn } from './keys.js';
function normalizeKeyPaths(value) {
    if (value.length === 0) {
        return [];
    }
    if (Array.isArray(value[0])) {
        return value.map(path => [...path]);
    }
    return [[...value]];
}
export class ContentAddressedTrie {
    store;
    root = null;
    keyFn;
    constructor(config, store) {
        this.keyFn = config.keyFn ?? hashPrefixKeyFn(config.chunkSize, config.maxDepth);
        this.store = store ?? new InMemoryTrieStore(config.hashFn);
    }
    getRoot() {
        return this.root;
    }
    /** Set the root hash externally (for cold-start loading from persisted state). */
    setRoot(hash) {
        this.root = hash;
    }
    getNode(hash) {
        return this.store.get(hash);
    }
    async insert(entryHash, context = {}) {
        const paths = normalizeKeyPaths(this.keyFn(entryHash, context));
        let root = this.root;
        for (const chunks of paths) {
            root = await this.insertAt(root, chunks, 0, entryHash);
        }
        this.root = root;
    }
    /** Collect all entry hashes stored across all leaf nodes. */
    collectAllEntries() {
        if (this.root === null)
            return [];
        return this.collectEntriesFrom(this.root);
    }
    /**
     * Walk an exact path of chunks, collect entries at target node + all descendants.
     * Returns empty array if any segment along the path is missing.
     */
    collectEntriesAtPath(chunks) {
        let nodeHash = this.root;
        for (const chunk of chunks) {
            if (nodeHash === null)
                return [];
            const node = this.store.get(nodeHash);
            if (!node)
                return [];
            nodeHash = node.children.get(chunk) ?? null;
        }
        if (nodeHash === null)
            return [];
        return this.collectEntriesFrom(nodeHash);
    }
    async insertAt(nodeHash, chunks, depth, entryHash) {
        const existing = nodeHash ? this.store.get(nodeHash) : null;
        const children = new Map(existing?.children);
        const entries = new Set(existing?.entries);
        if (depth >= chunks.length) {
            entries.add(entryHash);
        }
        else {
            const chunk = chunks[depth];
            const childHash = children.get(chunk) ?? null;
            const newChildHash = await this.insertAt(childHash, chunks, depth + 1, entryHash);
            children.set(chunk, newChildHash);
        }
        return this.store.store(children, entries);
    }
    collectEntriesFrom(nodeHash) {
        const node = this.store.get(nodeHash);
        if (!node)
            return [];
        const result = [...node.entries];
        for (const childHash of node.children.values()) {
            result.push(...this.collectEntriesFrom(childHash));
        }
        return result;
    }
}
