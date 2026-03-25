import {createOneCoreTrieStore as createPersistedOneCoreTrieStore} from '../../../trie.core/src/index.js';
import type {Hash, OneCoreTrieStorageDeps} from '../../../trie.core/src/index.js';
import type {
    ChatTrieEntry,
    ChatTrieEntryStoreDeps,
    ChatTrieRangeDeps,
    ChatTrieStoreDeps,
    SubjectMessageRange
} from '../trie/types.js';
import type {
    ChatTrieEntry as ChatTrieEntryObject,
    ChatTrieNode,
    ChatTrieRoot,
    TopicTrieNode,
    TopicTrieRoot,
    SubjectTrieNode,
    SubjectTrieRoot,
    SubjectRange
} from '../recipes/ChatTrieRecipes.js';

/**
 * Injected ONE.core storage functions.
 * The consuming platform provides these — chat.core never imports ONE.core directly.
 */
export interface OneCoreStorageDeps extends OneCoreTrieStorageDeps {
    storeUnversionedObject(obj: Record<string, unknown>): Promise<{hash: string}>;
    getObject(hash: string): Promise<Record<string, unknown>>;
}

/**
 * Creates ChatTrieStoreDeps for the sync trie (ChatTrieNode/ChatTrieRoot).
 */
export function createOneCoreTrieStore(storage: OneCoreStorageDeps): ChatTrieStoreDeps {
    return createPersistedOneCoreTrieStore(storage, 'ChatTrieNode', 'ChatTrieRoot');
}

/**
 * Creates ChatTrieStoreDeps for the time trie (TopicTrieNode/TopicTrieRoot).
 */
export function createTopicTrieStore(storage: OneCoreStorageDeps): ChatTrieStoreDeps {
    return createPersistedOneCoreTrieStore(storage, 'TopicTrieNode', 'TopicTrieRoot');
}

/**
 * Creates ChatTrieStoreDeps for the subject trie (SubjectTrieNode/SubjectTrieRoot).
 */
export function createSubjectTrieStore(storage: OneCoreStorageDeps): ChatTrieStoreDeps {
    return createPersistedOneCoreTrieStore(storage, 'SubjectTrieNode', 'SubjectTrieRoot');
}

/**
 * Creates deps for SubjectRange object persistence.
 */
export function createSubjectRangeStore(storage: OneCoreStorageDeps): ChatTrieRangeDeps {
    return {
        async storeRange(range: SubjectMessageRange): Promise<Hash> {
            const obj: SubjectRange = {
                $type$: 'SubjectRange',
                id: range.id,
                topicId: range.topicId,
                subjectId: range.subjectId,
                startMessageHash: range.startMessageHash as unknown as SubjectRange['startMessageHash'],
                endMessageHash: range.endMessageHash as unknown as SubjectRange['endMessageHash'],
                startTime: range.startTime,
                endTime: range.endTime,
                triePointers: range.triePointers
                    ? {
                        start: {
                            trie: range.triePointers.start.trie,
                            path: [...range.triePointers.start.path]
                        },
                        end: {
                            trie: range.triePointers.end.trie,
                            path: [...range.triePointers.end.path]
                        }
                    }
                    : undefined
            };
            const result = await storage.storeVersionedObject(obj as unknown as Record<string, unknown>);
            return result.idHash as Hash;
        },

        async loadRange(rangeHash: Hash): Promise<SubjectMessageRange | null> {
            try {
                const result = await storage.getObjectByIdHash(rangeHash);
                const obj = result.obj as unknown as SubjectRange;
                return {
                    id: obj.id,
                    topicId: obj.topicId,
                    subjectId: obj.subjectId,
                    startMessageHash: obj.startMessageHash as unknown as Hash,
                    endMessageHash: obj.endMessageHash as unknown as Hash,
                    startTime: obj.startTime,
                    endTime: obj.endTime,
                    triePointers: obj.triePointers
                        ? {
                            start: {
                                trie: obj.triePointers.start.trie,
                                path: [...obj.triePointers.start.path]
                            },
                            end: {
                                trie: obj.triePointers.end.trie,
                                path: [...obj.triePointers.end.path]
                            }
                        }
                        : undefined
                };
            } catch {
                return null;
            }
        }
    };
}

/**
 * Creates deps for ChatTrieEntry object persistence.
 */
export function createChatTrieEntryStore(storage: OneCoreStorageDeps): ChatTrieEntryStoreDeps {
    return {
        async storeEntry(entry: ChatTrieEntry): Promise<Hash> {
            const obj: ChatTrieEntryObject = {
                $type$: 'ChatTrieEntry',
                topicId: entry.topicId,
                messageHash: entry.messageHash as unknown as ChatTrieEntryObject['messageHash'],
                authorId: entry.authorId,
                timestamp: entry.timestamp,
                ...(entry.embeddingEstimate ? {
                    embeddingEstimate: {
                        vectorCount: entry.embeddingEstimate.vectorCount,
                        dimensions: entry.embeddingEstimate.dimensions,
                        bytesPerDimension: entry.embeddingEstimate.bytesPerDimension,
                        estimatedBytes: entry.embeddingEstimate.estimatedBytes,
                        ...(entry.embeddingEstimate.model ? {model: entry.embeddingEstimate.model} : {}),
                        ...(typeof entry.embeddingEstimate.abstractionLevel === 'number'
                            ? {abstractionLevel: entry.embeddingEstimate.abstractionLevel}
                            : {})
                    }
                } : {})
            };
            const result = await storage.storeUnversionedObject(obj as unknown as Record<string, unknown>);
            return result.hash as Hash;
        },

        async loadEntry(entryHash: Hash): Promise<ChatTrieEntry | null> {
            try {
                const obj = await storage.getObject(entryHash);
                if (obj.$type$ !== 'ChatTrieEntry') {
                    return null;
                }
                const entry = obj as unknown as ChatTrieEntryObject;
                return {
                    topicId: entry.topicId,
                    messageHash: entry.messageHash as unknown as Hash,
                    authorId: entry.authorId,
                    timestamp: entry.timestamp,
                    ...(entry.embeddingEstimate ? {
                        embeddingEstimate: {
                            vectorCount: entry.embeddingEstimate.vectorCount,
                            dimensions: entry.embeddingEstimate.dimensions,
                            bytesPerDimension: entry.embeddingEstimate.bytesPerDimension,
                            estimatedBytes: entry.embeddingEstimate.estimatedBytes,
                            ...(entry.embeddingEstimate.model ? {model: entry.embeddingEstimate.model} : {}),
                            ...(typeof entry.embeddingEstimate.abstractionLevel === 'number'
                                ? {abstractionLevel: entry.embeddingEstimate.abstractionLevel}
                                : {})
                        }
                    } : {})
                };
            } catch {
                return null;
            }
        }
    };
}
