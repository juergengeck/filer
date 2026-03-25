/**
 * MultiTrie — wraps N ContentAddressedTrie instances for atomic multi-insert.
 *
 * Same entry hash enters all constituent tries simultaneously.
 * Each trie can have a different KeyFn (hash-prefix for sync, time-path for queries).
 */
import { ContentAddressedTrie } from './trie.js';
export class MultiTrie {
    slots = new Map();
    tries = new Map();
    writeChain = Promise.resolve();
    constructor(slots) {
        for (const slot of slots) {
            if (this.slots.has(slot.name)) {
                throw new Error(`MultiTrie: duplicate trie slot '${slot.name}'`);
            }
            this.slots.set(slot.name, slot);
        }
    }
    /**
     * Insert entry into ALL constituent tries with the same context.
     *
     * Atomicity guarantee (in-memory):
     * - The insert operation is serialized across callers.
     * - If any slot insert fails, all slot roots are rolled back to their previous values.
     */
    async insert(entryHash, context = {}) {
        await this.serializeWrite(async () => {
            const tries = [...this.slots.keys()].map(name => [name, this.getTrieSync(name)]);
            const prevRoots = new Map(tries.map(([name, trie]) => [name, trie.getRoot()]));
            try {
                // Sequential by design: guarantees deterministic rollback behavior.
                for (const [, trie] of tries) {
                    await trie.insert(entryHash, context);
                }
            }
            catch (error) {
                for (const [name, trie] of tries) {
                    trie.setRoot(prevRoots.get(name) ?? null);
                }
                throw error;
            }
        });
    }
    /** Get a constituent trie by name. Throws if not found. */
    async getTrie(name) {
        return this.getTrieSync(name);
    }
    /** Get slot root hash. */
    async getRoot(name) {
        return this.getTrieSync(name).getRoot();
    }
    /** Resolve a node hash within one slot. */
    async getNode(name, hash) {
        return this.getTrieSync(name).getNode(hash);
    }
    /** Collect all entries for one slot. */
    async collectAllEntries(name) {
        return this.getTrieSync(name).collectAllEntries();
    }
    /** Collect entries at an exact path for one slot. */
    async collectEntriesAtPath(name, chunks) {
        return this.getTrieSync(name).collectEntriesAtPath(chunks);
    }
    /** Set a slot root hash externally (cold-start restore). */
    async setRoot(name, hash) {
        this.getTrieSync(name).setRoot(hash);
    }
    /** Number of constituent tries. */
    get size() {
        return this.slots.size;
    }
    getTrieSync(name) {
        const trie = this.tries.get(name);
        if (trie)
            return trie;
        const slot = this.slots.get(name);
        if (!slot)
            throw new Error(`MultiTrie: no trie named '${name}'`);
        const created = new ContentAddressedTrie(slot.config, slot.store);
        this.tries.set(name, created);
        return created;
    }
    async serializeWrite(fn) {
        const run = this.writeChain.then(fn, fn);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }
}
