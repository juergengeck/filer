import {InMemoryTrieStore, sha256HashFn} from '../../../trie.core/src/index.js';
import type {Hash} from '../../../trie.core/src/index.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {OEvent} from '@refinio/one.models/lib/misc/OEvent.js';
import {ChatTrie} from '../trie/ChatTrie.js';
import {
    summarizeChatTrieEmbeddingEstimates,
    type ChatTrieEmbeddingEstimateSummary
} from '../trie/embedding-estimates.js';
import type {
    ChatTrieEntry,
    ChatTrieEntryStoreDeps,
    ChatTrieRangeDeps,
    ChatTrieStoreDeps,
    SubjectMessageRange,
    SubjectMessageRangeInput
} from '../trie/types.js';

export interface ChatTrieMessageIndexedEvent extends ChatTrieEntry {
    entryHash: Hash;
}

export interface ChatTrieIndexResult {
    entryHashes: Hash[];
    persistedObjectIds: SHA256IdHash[];
}

export interface TopicEmbeddingEstimateSummary extends ChatTrieEmbeddingEstimateSummary {
    topicId: string;
}

/**
 * Manages per-topic ChatTrie instances.
 *
 * Hook into channelManager.onUpdated at the wiring layer - this manager
 * handles trie creation, message insertion, persistence, and cold-start loading.
 */
export class ChatTrieManager {
    private readonly tries = new Map<string, ChatTrie>();
    private readonly topicMutationChains = new Map<string, Promise<void>>();
    public readonly onMessageIndexed = new OEvent<(event: ChatTrieMessageIndexedEvent) => void>();

    constructor(
        private readonly syncDeps: ChatTrieStoreDeps,
        private readonly timeDeps: ChatTrieStoreDeps,
        private readonly subjectDeps: ChatTrieStoreDeps,
        private readonly rangeDeps: ChatTrieRangeDeps,
        private readonly entryDeps?: ChatTrieEntryStoreDeps
    ) {}

    /**
     * Reload a topic trie from persisted roots and emit only newly discovered
     * entries. This is the import-side path for CHUM-synced trie state.
     */
    async reloadTopic(
        topicId: string,
        options: {emitEvent?: boolean} = {}
    ): Promise<Hash[]> {
        return await this.serializeTopicMutation(topicId, async () => {
            const [syncRoot, timeRoot, subjectRoot] = await Promise.all([
                this.syncDeps.loadRoot(topicId),
                this.timeDeps.loadRoot(topicId),
                this.subjectDeps.loadRoot(topicId)
            ]);

            if (syncRoot === null && timeRoot === null && subjectRoot === null) {
                this.tries.delete(topicId);
                return [];
            }

            const syncStore = new InMemoryTrieStore(sha256HashFn);
            const timeStore = new InMemoryTrieStore(sha256HashFn);
            const subjectStore = new InMemoryTrieStore(sha256HashFn);
            const trie = await ChatTrie.load({
                topicId,
                syncDeps: this.syncDeps,
                syncStore,
                timeDeps: this.timeDeps,
                timeStore,
                subjectDeps: this.subjectDeps,
                subjectStore,
                rangeDeps: this.rangeDeps
            });
            const currentEntries = await trie.getAllEntries();
            const liveTrie = this.tries.get(topicId);
            const liveEntryList = liveTrie
                ? await liveTrie.getAllEntries()
                : [];
            const liveEntries = new Set(liveEntryList);
            const loadedIsStrictSubsetOfLive = liveEntryList.length > currentEntries.length
                && currentEntries.every(entryHash => liveEntries.has(entryHash));

            // Root updates can arrive while local sends are still flushing newer trie state.
            // Chat is append-only here, so a persisted snapshot must never shrink the topic.
            // Compare against the trie that is live at commit time, not the trie that was live
            // when reload started, otherwise an older reload can still clobber newer local sends.
            if (liveTrie && loadedIsStrictSubsetOfLive) {
                return [];
            }

            this.tries.set(topicId, trie);

            const baselineEntries = liveTrie ? liveEntries : new Set<Hash>();
            const newEntryHashes = currentEntries.filter(entryHash => !baselineEntries.has(entryHash));

            if (options.emitEvent !== false && this.entryDeps) {
                const indexedEvents = (await Promise.all(
                    newEntryHashes.map(async (entryHash) => {
                        const entry = await this.entryDeps!.loadEntry(entryHash);
                        if (!entry || entry.topicId !== topicId) {
                            return null;
                        }
                        return {...entry, entryHash};
                    })
                )).filter((entry): entry is ChatTrieMessageIndexedEvent => entry !== null);

                indexedEvents.forEach(event => this.onMessageIndexed.emit(event));
            }

            return newEntryHashes;
        });
    }

    /**
     * Insert a Story hash into the topic's trie at the given timestamp.
     * Creates the trie on-demand. Flushes dirty nodes to persistent storage.
     */
    async onMessage(topicId: string, storyHash: Hash, timestamp: Date): Promise<void> {
        await this.serializeTopicMutation(topicId, async () => {
            const trie = this.getOrCreate(topicId);
            await trie.insert(storyHash, timestamp);
            await trie.flush();
        });
    }

    /**
     * Ensure the topic's trie root singletons exist even before any messages are indexed.
     */
    async ensureTopic(topicId: string): Promise<SHA256IdHash[]> {
        return await this.serializeTopicMutation(topicId, async () => {
            const trie = this.getOrCreate(topicId);
            return await trie.ensureRoots();
        });
    }

    /**
     * Create trie entries for chat atoms and index them into the topic trie.
     *
     * The same entry hash becomes the atom referenced by all trie parameters.
     */
    async indexMessages(
        topicId: string,
        entries: ChatTrieEntry[],
        options: {emitEvent?: boolean} = {}
    ): Promise<ChatTrieIndexResult> {
        return await this.serializeTopicMutation(topicId, async () => {
            if (!this.entryDeps) {
                throw new Error('ChatTrieManager: entry store is not configured');
            }

            if (entries.length === 0) {
                return {entryHashes: [], persistedObjectIds: []};
            }

            const trie = this.getOrCreate(topicId);
            const entryHashes: Hash[] = [];
            const indexedEvents: ChatTrieMessageIndexedEvent[] = [];

            for (const entry of entries) {
                const normalized: ChatTrieEntry = {
                    topicId,
                    messageHash: entry.messageHash,
                    authorId: entry.authorId,
                    timestamp: entry.timestamp,
                    ...(entry.embeddingEstimate ? {embeddingEstimate: entry.embeddingEstimate} : {})
                };
                const entryHash = await this.entryDeps.storeEntry(normalized);
                await trie.insert(entryHash, new Date(normalized.timestamp));
                entryHashes.push(entryHash);
                indexedEvents.push({...normalized, entryHash});
            }

            const persistedObjectIds = await trie.flush();
            if (options.emitEvent !== false) {
                indexedEvents.forEach(event => this.onMessageIndexed.emit(event));
            }
            return {entryHashes, persistedObjectIds};
        });
    }

    async indexMessage(
        topicId: string,
        entry: ChatTrieEntry,
        options: {emitEvent?: boolean} = {}
    ): Promise<{entryHash: Hash; persistedObjectIds: SHA256IdHash[]}> {
        const {entryHashes, persistedObjectIds} = await this.indexMessages(topicId, [entry], options);
        const [entryHash] = entryHashes;
        return {entryHash, persistedObjectIds};
    }

    /**
     * Index a subject range for a topic.
     * Boundaries use message/story hashes.
     */
    async onSubjectRange(topicId: string, range: SubjectMessageRangeInput): Promise<Hash> {
        return await this.serializeTopicMutation(topicId, async () => {
            const trie = this.getOrCreate(topicId);
            const rangeHash = await trie.addSubjectRange(range);
            await trie.flush();
            return rangeHash;
        });
    }

    /** Get the ChatTrie for a topic (for sync/diff). */
    getTrie(topicId: string): ChatTrie | undefined {
        return this.tries.get(topicId);
    }

    /** Get the root hash (sync state) for a topic. */
    async getRoot(topicId: string): Promise<Hash | null> {
        const trie = this.tries.get(topicId);
        return trie ? await trie.getRoot() : null;
    }

    /** Get indexed subject ranges for a subject within a topic. */
    async getSubjectRanges(topicId: string, subjectId: string): Promise<SubjectMessageRange[]> {
        const trie = this.tries.get(topicId);
        if (!trie) return [];
        return trie.querySubjectRanges(subjectId);
    }

    /**
     * Load chat atoms for a topic directly from trie state.
     *
     * This is the primary read path for chat. Entries are sorted ascending by
     * timestamp and can be paginated with the same cursor shape as ChatPlan.
     */
    async getMessageEntries(
        topicId: string,
        options: {limit?: number; before?: number} = {}
    ): Promise<{entries: Array<ChatTrieEntry & {entryHash: Hash}>; total: number; available: number}> {
        if (!this.entryDeps) {
            return {entries: [], total: 0, available: 0};
        }

        const trie = this.tries.get(topicId);
        if (!trie) {
            return {entries: [], total: 0, available: 0};
        }

        const allEntryHashes = await trie.getAllEntries();
        const loadedEntryResults = await Promise.all(
            allEntryHashes.map(async (entryHash) => {
                const entry = await this.entryDeps!.loadEntry(entryHash);
                if (!entry || entry.topicId !== topicId) {
                    return null;
                }
                return {...entry, entryHash};
            })
        );
        const loadedEntries = loadedEntryResults.filter((entry): entry is ChatTrieEntry & {entryHash: Hash} => entry !== null);

        loadedEntries.sort((a, b) => {
            if (a.timestamp !== b.timestamp) {
                return a.timestamp - b.timestamp;
            }
            return a.entryHash.localeCompare(b.entryHash);
        });

        const filtered = options.before === undefined
            ? loadedEntries
            : loadedEntries.filter(entry => entry.timestamp < options.before!);
        const limit = options.limit ?? filtered.length;
        const start = Math.max(0, filtered.length - limit);

        return {
            entries: filtered.slice(start),
            total: loadedEntries.length,
            available: filtered.length
        };
    }

    async getEmbeddingEstimateSummary(topicId: string): Promise<TopicEmbeddingEstimateSummary> {
        const {entries} = await this.getMessageEntries(topicId);
        return {
            topicId,
            ...summarizeChatTrieEmbeddingEstimates(entries)
        };
    }

    async getEmbeddingEstimateSummaries(topicIds?: string[]): Promise<TopicEmbeddingEstimateSummary[]> {
        const targets = topicIds ?? [...this.tries.keys()];
        return await Promise.all(targets.map(async topicId => await this.getEmbeddingEstimateSummary(topicId)));
    }

    /**
     * Cold-start: load all persisted trie roots from storage.
     * Call once during init with all known topic idHashes.
     */
    async loadExisting(topicIds: string[]): Promise<void> {
        await Promise.all(topicIds.map(async (topicId) => {
            if (this.tries.has(topicId)) return;
            await this.reloadTopic(topicId, {emitEvent: false});
        }));
    }

    /** Flush all dirty tries to persistent storage. */
    async flushAll(): Promise<void> {
        await Promise.all([...this.tries.values()].map(t => t.flush()));
    }

    private getOrCreate(topicId: string): ChatTrie {
        let trie = this.tries.get(topicId);
        if (!trie) {
            const syncStore = new InMemoryTrieStore(sha256HashFn);
            const timeStore = new InMemoryTrieStore(sha256HashFn);
            const subjectStore = new InMemoryTrieStore(sha256HashFn);
            trie = new ChatTrie({
                topicId,
                syncDeps: this.syncDeps,
                syncStore,
                timeDeps: this.timeDeps,
                timeStore,
                subjectDeps: this.subjectDeps,
                subjectStore,
                rangeDeps: this.rangeDeps
            });
            this.tries.set(topicId, trie);
        }
        return trie;
    }

    private async serializeTopicMutation<T>(topicId: string, fn: () => Promise<T>): Promise<T> {
        const current = this.topicMutationChains.get(topicId) ?? Promise.resolve();
        const run = current.then(fn, fn);
        this.topicMutationChains.set(topicId, run.then(() => undefined, () => undefined));
        return await run;
    }
}
