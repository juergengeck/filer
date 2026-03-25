import type { Hash, HashFn, TrieNodeData, TrieStore } from './types.js';
export declare class InMemoryTrieStore implements TrieStore {
    private readonly nodes;
    private readonly hashFn;
    constructor(hashFn: HashFn);
    get(hash: Hash): TrieNodeData | null;
    store(children: ReadonlyMap<string, Hash>, entries: ReadonlySet<Hash>): Promise<Hash>;
    private computeHash;
}
