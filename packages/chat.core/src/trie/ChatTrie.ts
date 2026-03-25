import {
    ContentAddressedTrie,
    MultiTrie,
    sha256HashFn,
    diff,
    hashPrefixKeyFn,
    timePathKeyFn,
    timePathLeafKeys,
    BufferedTrieStore,
    loadTrieSubtree
} from '../../../trie.core/src/index.js';
import type {Hash, KeyFn, TrieConfig, TrieNodeData, TrieReader} from '../../../trie.core/src/index.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {
    ChatTrieConfig,
    ChatTrieRangeDeps,
    ChatTrieStoreDeps,
    SubjectMessageRange,
    SubjectMessageRangeInput
} from './types.js';

const SUBJECT_PATH_CHUNK_SIZE = 4;

function subjectPathFromId(subjectId: string): string[] {
    const normalized = subjectId.trim();
    if (!normalized) {
        throw new Error('subjectId is required');
    }
    const chunks: string[] = [];
    for (let i = 0; i < normalized.length; i += SUBJECT_PATH_CHUNK_SIZE) {
        chunks.push(`sid:${normalized.slice(i, i + SUBJECT_PATH_CHUNK_SIZE)}`);
    }
    return chunks;
}

function toTriePath(path: ReturnType<KeyFn>): string[] {
    return Array.isArray(path[0]) ? path[0] as string[] : path as string[];
}

const subjectPathKeyFn: KeyFn = (_entryHash, context) => {
    const subjectId = context.subjectId;
    if (typeof subjectId !== 'string') {
        throw new Error('subjectPathKeyFn requires context.subjectId (string)');
    }
    return subjectPathFromId(subjectId);
};

/**
 * Per-topic unified trie: one insert writes to both sync and time tries.
 *
 * - Sync trie (hash-prefix): Merkle diff for CHUM sync. Root hash IS the manifest.
 * - Time trie (time-path): minute-level queries for message retrieval.
 *
 * Same Story hash enters both tries. MultiTrie handles the atomic dual-insert.
 */
export class ChatTrie {
    private readonly multi: MultiTrie;
    private readonly subjectTrie: ContentAddressedTrie;
    private readonly syncBuffered: BufferedTrieStore;
    private readonly timeBuffered: BufferedTrieStore;
    private readonly subjectBuffered: BufferedTrieStore;
    private readonly topicId: string;
    private readonly syncDeps: ChatTrieStoreDeps;
    private readonly timeDeps: ChatTrieStoreDeps;
    private readonly subjectDeps: ChatTrieStoreDeps;
    private readonly rangeDeps: ChatTrieRangeDeps;
    private readonly timeTrieId: string;
    private readonly timePathKey: KeyFn;

    constructor(config: ChatTrieConfig) {
        this.topicId = config.topicId;
        this.syncDeps = config.syncDeps;
        this.timeDeps = config.timeDeps;
        this.subjectDeps = config.subjectDeps;
        this.rangeDeps = config.rangeDeps;
        this.timeTrieId = `topic-${config.topicId}`;
        this.timePathKey = timePathKeyFn('minute', this.timeTrieId);

        this.syncBuffered = new BufferedTrieStore(config.syncStore);
        this.timeBuffered = new BufferedTrieStore(config.timeStore);
        this.subjectBuffered = new BufferedTrieStore(config.subjectStore);

        const syncConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 4,
            hashFn: sha256HashFn,
            keyFn: hashPrefixKeyFn(2, 4)
        };

        const timeConfig: TrieConfig = {
            chunkSize: 2,
            maxDepth: 5,
            hashFn: sha256HashFn,
            keyFn: this.timePathKey
        };

        const subjectConfig: TrieConfig = {
            chunkSize: SUBJECT_PATH_CHUNK_SIZE,
            maxDepth: 64 / SUBJECT_PATH_CHUNK_SIZE,
            hashFn: sha256HashFn,
            keyFn: subjectPathKeyFn
        };

        this.multi = new MultiTrie([
            {name: 'sync', config: syncConfig, store: this.syncBuffered},
            {name: 'time', config: timeConfig, store: this.timeBuffered}
        ]);
        this.subjectTrie = new ContentAddressedTrie(subjectConfig, this.subjectBuffered);
    }

    /** Insert a Story hash into both tries. */
    async insert(storyHash: Hash, timestamp: Date): Promise<void> {
        await this.multi.insert(storyHash, {timestamp});
    }

    // -----------------------------------------------------------------------
    // Sync API (delegates to 'sync' trie)
    // -----------------------------------------------------------------------

    /** Sync trie root = manifest hash for CHUM. */
    async getRoot(): Promise<Hash | null> {
        return this.multi.getRoot('sync');
    }

    /** Resolve a node hash to its data (for diff). */
    async getNode(hash: Hash): Promise<TrieNodeData | null> {
        return this.multi.getNode('sync', hash);
    }

    /** All Story hashes in the sync trie. */
    async getAllEntries(): Promise<Hash[]> {
        return this.multi.collectAllEntries('sync');
    }

    /** Compute what this trie is missing compared to a remote trie. */
    async diff(remote: TrieReader | ChatTrie): Promise<Hash[]> {
        const localSync = await this.multi.getTrie('sync');
        const remoteReader: TrieReader =
            remote instanceof ChatTrie ? await remote.multi.getTrie('sync') : remote;
        return diff(localSync, remoteReader).missing;
    }

    /**
     * Apply entries from a diff result.
     * Inserts into both tries — needs timestamp per entry.
     */
    async applyDiff(missing: Hash[], timestamps: Map<Hash, Date>): Promise<void> {
        for (const entry of missing) {
            const timestamp = timestamps.get(entry);
            if (!timestamp) {
                throw new Error(`applyDiff: missing timestamp for entry ${entry}`);
            }
            await this.multi.insert(entry, {timestamp});
        }
    }

    // -----------------------------------------------------------------------
    // Query API (delegates to 'time' trie)
    // -----------------------------------------------------------------------

    /** Query Story hashes in a time range [from, to] inclusive. */
    async queryRange(from: Date, to: Date): Promise<Hash[]> {
        const paths = timePathLeafKeys(from, to, this.timeTrieId, 'minute');
        const results: Hash[] = [];
        for (const path of paths) {
            results.push(...await this.multi.collectEntriesAtPath('time', path));
        }
        return results;
    }

    // -----------------------------------------------------------------------
    // Subject range API (separate subject trie + SubjectRange objects)
    // -----------------------------------------------------------------------

    /**
     * Index a subject range by subject id.
     * Ground truth boundaries are start/end message hashes (not trie pointers).
     */
    async addSubjectRange(input: SubjectMessageRangeInput): Promise<Hash> {
        const subjectId = input.subjectId.trim();
        if (!subjectId) {
            throw new Error('addSubjectRange: subjectId is required');
        }
        const startMs = input.startTime.getTime();
        const endMs = input.endTime.getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
            throw new Error('addSubjectRange: invalid range timestamps');
        }
        if (startMs > endMs) {
            throw new Error('addSubjectRange: startTime must be <= endTime');
        }

        const id = await sha256HashFn(
            `subject-range:${this.topicId}:${subjectId}:${input.startMessageHash}:${input.endMessageHash}`
        );

        const triePointers = {
            start: {
                trie: 'time' as const,
                path: toTriePath(this.timePathKey(input.startMessageHash, {timestamp: input.startTime}))
            },
            end: {
                trie: 'time' as const,
                path: toTriePath(this.timePathKey(input.endMessageHash, {timestamp: input.endTime}))
            }
        };

        const range: SubjectMessageRange = {
            id,
            topicId: this.topicId,
            subjectId,
            startMessageHash: input.startMessageHash,
            endMessageHash: input.endMessageHash,
            startTime: startMs,
            endTime: endMs,
            triePointers
        };

        const rangeHash = await this.rangeDeps.storeRange(range);
        await this.subjectTrie.insert(rangeHash, {subjectId});
        return rangeHash;
    }

    /** Query all subject ranges for a subject in this topic, ordered by start time. */
    async querySubjectRanges(subjectId: string): Promise<SubjectMessageRange[]> {
        const normalizedSubjectId = subjectId.trim();
        const rangeHashes = this.subjectTrie.collectEntriesAtPath(subjectPathFromId(normalizedSubjectId));
        const ranges = (await Promise.all(rangeHashes.map(h => this.rangeDeps.loadRange(h))))
            .filter((range): range is SubjectMessageRange => !!range);

        return ranges
            .filter(range => range.topicId === this.topicId && range.subjectId === normalizedSubjectId)
            .sort((a, b) => (a.startTime - b.startTime) || (a.endTime - b.endTime));
    }

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------

    /** Flush dirty nodes in both tries to persistent storage. */
    async flush(): Promise<SHA256IdHash[]> {
        const promises: Promise<void>[] = [];
        const persistedIds: SHA256IdHash[] = [];
        if (this.syncBuffered.hasDirty()) {
            promises.push(
                this.syncBuffered.flush(this.syncDeps).then(async (nodeIds) => {
                    persistedIds.push(...nodeIds);
                    const rootId = await this.syncDeps.storeRoot(this.topicId, await this.getRoot());
                    persistedIds.push(rootId);
                })
            );
        }
        if (this.timeBuffered.hasDirty()) {
            promises.push(
                this.timeBuffered.flush(this.timeDeps).then(async (nodeIds) => {
                    persistedIds.push(...nodeIds);
                    const rootId = await this.timeDeps.storeRoot(this.topicId, await this.multi.getRoot('time'));
                    persistedIds.push(rootId);
                })
            );
        }
        if (this.subjectBuffered.hasDirty()) {
            promises.push(
                this.subjectBuffered.flush(this.subjectDeps).then(async (nodeIds) => {
                    persistedIds.push(...nodeIds);
                    const rootId = await this.subjectDeps.storeRoot(this.topicId, this.subjectTrie.getRoot());
                    persistedIds.push(rootId);
                })
            );
        }
        await Promise.all(promises);
        return persistedIds;
    }

    /**
     * Ensure the per-topic root singletons exist even before the first message.
     *
     * This gives CHUM a stable versioned id to follow from topic creation onward.
     */
    async ensureRoots(): Promise<SHA256IdHash[]> {
        return await Promise.all([
            this.syncDeps.storeRoot(this.topicId, await this.getRoot()),
            this.timeDeps.storeRoot(this.topicId, await this.multi.getRoot('time')),
            this.subjectDeps.storeRoot(this.topicId, this.subjectTrie.getRoot())
        ]);
    }

    /** Load from persisted roots, walking trie nodes into memory. */
    static async load(config: ChatTrieConfig): Promise<ChatTrie> {
        const chatTrie = new ChatTrie(config);

        const [syncRoot, timeRoot, subjectRoot] = await Promise.all([
            config.syncDeps.loadRoot(config.topicId),
            config.timeDeps.loadRoot(config.topicId),
            config.subjectDeps.loadRoot(config.topicId)
        ]);

        if (syncRoot) {
            await loadTrieSubtree(syncRoot, chatTrie.syncBuffered, config.syncDeps);
            await chatTrie.multi.setRoot('sync', syncRoot);
        }
        if (timeRoot) {
            await loadTrieSubtree(timeRoot, chatTrie.timeBuffered, config.timeDeps);
            await chatTrie.multi.setRoot('time', timeRoot);
        }
        if (subjectRoot) {
            await loadTrieSubtree(subjectRoot, chatTrie.subjectBuffered, config.subjectDeps);
            chatTrie.subjectTrie.setRoot(subjectRoot);
        }

        return chatTrie;
    }
}
