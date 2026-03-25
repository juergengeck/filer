/**
 * MultiTrie — wraps N ContentAddressedTrie instances for atomic multi-insert.
 *
 * Same entry hash enters all constituent tries simultaneously.
 * Each trie can have a different KeyFn (hash-prefix for sync, time-path for queries).
 */

import type {Hash, TrieConfig, TrieNodeData, TrieStore} from './types.js';
import {ContentAddressedTrie} from './trie.js';

export interface TrieSlot {
    name: string;
    config: TrieConfig;
    store?: TrieStore;
}

export class MultiTrie {
    private readonly slots = new Map<string, TrieSlot>();
    private readonly tries = new Map<string, ContentAddressedTrie>();
    private writeChain: Promise<void> = Promise.resolve();

    constructor(slots: TrieSlot[]) {
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
    async insert(entryHash: Hash, context: Record<string, unknown> = {}): Promise<void> {
        await this.serializeWrite(async () => {
            const tries = [...this.slots.keys()].map(name => [name, this.getTrieSync(name)] as const);
            const prevRoots = new Map<string, Hash | null>(
                tries.map(([name, trie]) => [name, trie.getRoot()])
            );

            try {
                // Sequential by design: guarantees deterministic rollback behavior.
                for (const [, trie] of tries) {
                    await trie.insert(entryHash, context);
                }
            } catch (error) {
                for (const [name, trie] of tries) {
                    trie.setRoot(prevRoots.get(name) ?? null);
                }
                throw error;
            }
        });
    }

    /** Get a constituent trie by name. Throws if not found. */
    async getTrie(name: string): Promise<ContentAddressedTrie> {
        return this.getTrieSync(name);
    }

    /** Get slot root hash. */
    async getRoot(name: string): Promise<Hash | null> {
        return this.getTrieSync(name).getRoot();
    }

    /** Resolve a node hash within one slot. */
    async getNode(name: string, hash: Hash): Promise<TrieNodeData | null> {
        return this.getTrieSync(name).getNode(hash);
    }

    /** Collect all entries for one slot. */
    async collectAllEntries(name: string): Promise<Hash[]> {
        return this.getTrieSync(name).collectAllEntries();
    }

    /** Collect entries at an exact path for one slot. */
    async collectEntriesAtPath(name: string, chunks: string[]): Promise<Hash[]> {
        return this.getTrieSync(name).collectEntriesAtPath(chunks);
    }

    /** Set a slot root hash externally (cold-start restore). */
    async setRoot(name: string, hash: Hash | null): Promise<void> {
        this.getTrieSync(name).setRoot(hash);
    }

    /** Number of constituent tries. */
    get size(): number {
        return this.slots.size;
    }

    private getTrieSync(name: string): ContentAddressedTrie {
        const trie = this.tries.get(name);
        if (trie) return trie;

        const slot = this.slots.get(name);
        if (!slot) throw new Error(`MultiTrie: no trie named '${name}'`);

        const created = new ContentAddressedTrie(slot.config, slot.store);
        this.tries.set(name, created);
        return created;
    }

    private async serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(fn, fn);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }
}
