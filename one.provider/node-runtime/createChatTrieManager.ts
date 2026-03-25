import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';

import {importTopLevelPackageModule} from './loadTopLevelPackageModule.js';

export type ChatTrieMessageEntry = {
    topicId: string;
    messageHash: string;
    authorId: string;
    timestamp: number;
    entryHash: string;
};

export type ChatTrieManagerLike = {
    getMessageEntries(
        topicId: string,
        options?: {limit?: number; before?: number}
    ): Promise<{entries: ChatTrieMessageEntry[]; total: number; available: number}>;
    loadExisting(topicIds: string[]): Promise<void>;
    indexMessage(
        topicId: string,
        entry: {
            topicId: string;
            messageHash: string;
            authorId: string;
            timestamp: number;
        },
        options?: {emitEvent?: boolean}
    ): Promise<unknown>;
    flushAll(): Promise<void>;
};

type ChatTrieManagerBootstrap = {
    chatTrieManager: ChatTrieManagerLike;
    shutdown(): Promise<void>;
};

type ChatTrieModels = {
    channelManager: any;
    topicModel: any;
};

function getTopicSeenHashes(
    seenMessageHashesByTopic: Map<string, Set<string>>,
    topicId: string
): Set<string> {
    let seenHashes = seenMessageHashesByTopic.get(topicId);

    if (!seenHashes) {
        seenHashes = new Set<string>();
        seenMessageHashesByTopic.set(topicId, seenHashes);
    }

    return seenHashes;
}

async function bootstrapTopicMessages(
    chatTrieManager: ChatTrieManagerLike,
    topicModel: any,
    topicId: string,
    seenHashes: Set<string>
): Promise<void> {
    const topicRoom = await topicModel.enterTopicRoom(topicId);
    const messages = await topicRoom.retrieveAllMessages();

    for (const message of messages) {
        const messageHash = String(message.dataHash);

        if (seenHashes.has(messageHash)) {
            continue;
        }

        await chatTrieManager.indexMessage(
            topicId,
            {
                topicId,
                messageHash,
                authorId: String(message.data.sender),
                timestamp: message.creationTime.getTime()
            },
            {emitEvent: false}
        );
        seenHashes.add(messageHash);
    }
}

async function bootstrapExistingTopics(
    chatTrieManager: ChatTrieManagerLike,
    topicModel: any
): Promise<Map<string, Set<string>>> {
    const topics = await topicModel.topics.all();
    const topicIds = topics.map((topic: {id: string}) => topic.id);
    const seenMessageHashesByTopic = new Map<string, Set<string>>();

    await chatTrieManager.loadExisting(topicIds);

    for (const topicId of topicIds) {
        const seenHashes = getTopicSeenHashes(seenMessageHashesByTopic, topicId);
        const existingEntries = await chatTrieManager.getMessageEntries(topicId);

        for (const entry of existingEntries.entries) {
            seenHashes.add(String(entry.messageHash));
        }

        await bootstrapTopicMessages(chatTrieManager, topicModel, topicId, seenHashes);
    }

    return seenMessageHashesByTopic;
}

async function onChannelUpdated(
    chatTrieManager: ChatTrieManagerLike,
    seenMessageHashesByTopic: Map<string, Set<string>>,
    _channelInfoIdHash: string,
    channelId: string,
    _channelOwner: string | null,
    _timeOfEarliestChange: Date,
    entries: Array<{
        isNew: boolean;
        dataHash: string;
        creationTime: number;
        author?: string;
    }>
): Promise<void> {
    const seenHashes = getTopicSeenHashes(seenMessageHashesByTopic, channelId);

    for (const entry of entries) {
        if (!entry.isNew) {
            continue;
        }

        const messageHash = String(entry.dataHash);

        if (seenHashes.has(messageHash)) {
            continue;
        }

        const obj = await getObject(messageHash);

        if (obj.$type$ !== 'ChatMessage') {
            continue;
        }

        const authorId = entry.author ? String(entry.author) : String(obj.sender);
        await chatTrieManager.indexMessage(
            channelId,
            {
                topicId: channelId,
                messageHash,
                authorId,
                timestamp: entry.creationTime
            },
            {emitEvent: false}
        );
        seenHashes.add(messageHash);
    }
}

/**
 * Create and bootstrap the shared chat trie manager from vendored top-level
 * `chat.core` / `trie.core` packages.
 *
 * @param models
 */
export async function createChatTrieManager(
    models: ChatTrieModels
): Promise<ChatTrieManagerBootstrap> {
    const chatTrieManagerModule = await importTopLevelPackageModule(
        'chat.core/dist/services/ChatTrieManager.js'
    );
    const chatTrieStoreModule = await importTopLevelPackageModule(
        'chat.core/dist/services/ChatTrieOneCoreStore.js'
    );

    const oneCoreDeps = {
        calculateIdHashOfObj,
        getObject,
        getObjectByIdHash,
        storeUnversionedObject,
        storeVersionedObject
    };

    const syncDeps = chatTrieStoreModule.createOneCoreTrieStore(oneCoreDeps);
    const timeDeps = chatTrieStoreModule.createTopicTrieStore(oneCoreDeps);
    const subjectDeps = chatTrieStoreModule.createSubjectTrieStore(oneCoreDeps);
    const rangeDeps = chatTrieStoreModule.createSubjectRangeStore(oneCoreDeps);
    const entryDeps = chatTrieStoreModule.createChatTrieEntryStore(oneCoreDeps);
    const chatTrieManager = new chatTrieManagerModule.ChatTrieManager(
        syncDeps,
        timeDeps,
        subjectDeps,
        rangeDeps,
        entryDeps
    ) as ChatTrieManagerLike;

    const seenMessageHashesByTopic = await bootstrapExistingTopics(chatTrieManager, models.topicModel);
    const disconnect = models.channelManager.onUpdated(
        onChannelUpdated.bind(null, chatTrieManager, seenMessageHashesByTopic)
    );

    return {
        chatTrieManager,
        async shutdown(): Promise<void> {
            disconnect();
            await chatTrieManager.flushAll();
        }
    };
}
