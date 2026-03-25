import type {Hash, KeyFn, TrieConfig, TrieNodeData, TrieReader, TrieStore} from './types.js';
import {InMemoryTrieStore} from './store.js';
import {hashPrefixKeyFn} from './keys.js';

function normalizeKeyPaths(value: ReturnType<KeyFn>): string[][] {
    if (value.length === 0) {
        return [];
    }

    if (Array.isArray(value[0])) {
        return (value as string[][]).map(path => [...path]);
    }

    return [[...(value as string[])]];
}

export class ContentAddressedTrie implements TrieReader {
    private readonly store: TrieStore;
    private root: Hash | null = null;
    private readonly keyFn: KeyFn;

    constructor(config: TrieConfig, store?: TrieStore) {
        this.keyFn = config.keyFn ?? hashPrefixKeyFn(config.chunkSize, config.maxDepth);
        this.store = store ?? new InMemoryTrieStore(config.hashFn);
    }

    getRoot(): Hash | null {
        return this.root;
    }

    /** Set the root hash externally (for cold-start loading from persisted state). */
    setRoot(hash: Hash | null): void {
        this.root = hash;
    }

    getNode(hash: Hash): TrieNodeData | null {
        return this.store.get(hash);
    }

    async insert(entryHash: Hash, context: Record<string, unknown> = {}): Promise<void> {
        const paths = normalizeKeyPaths(this.keyFn(entryHash, context));
        let root = this.root;

        for (const chunks of paths) {
            root = await this.insertAt(root, chunks, 0, entryHash);
        }

        this.root = root;
    }

    /** Collect all entry hashes stored across all leaf nodes. */
    collectAllEntries(): Hash[] {
        if (this.root === null) return [];
        return this.collectEntriesFrom(this.root);
    }

    /**
     * Walk an exact path of chunks, collect entries at target node + all descendants.
     * Returns empty array if any segment along the path is missing.
     */
    collectEntriesAtPath(chunks: string[]): Hash[] {
        let nodeHash = this.root;
        for (const chunk of chunks) {
            if (nodeHash === null) return [];
            const node = this.store.get(nodeHash);
            if (!node) return [];
            nodeHash = node.children.get(chunk) ?? null;
        }
        if (nodeHash === null) return [];
        return this.collectEntriesFrom(nodeHash);
    }

    private async insertAt(nodeHash: Hash | null, chunks: string[], depth: number, entryHash: Hash): Promise<Hash> {
        const existing = nodeHash ? this.store.get(nodeHash) : null;
        const children = new Map<string, Hash>(existing?.children);
        const entries = new Set<Hash>(existing?.entries);

        if (depth >= chunks.length) {
            entries.add(entryHash);
        } else {
            const chunk = chunks[depth];
            const childHash = children.get(chunk) ?? null;
            const newChildHash = await this.insertAt(childHash, chunks, depth + 1, entryHash);
            children.set(chunk, newChildHash);
        }

        return this.store.store(children, entries);
    }

    private collectEntriesFrom(nodeHash: Hash): Hash[] {
        const node = this.store.get(nodeHash);
        if (!node) return [];
        const result: Hash[] = [...node.entries];
        for (const childHash of node.children.values()) {
            result.push(...this.collectEntriesFrom(childHash));
        }
        return result;
    }
}
