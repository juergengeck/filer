import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

import type {
    CachedChatMessage,
    ChatApiSendMessageOptions,
    ChatApiType,
    ChatAttachmentsInfo,
    ModelsHelperType,
    OneApi
} from '../utils/types.js';
import type {ChatMessage, Topic} from '../../recipes/ChatRecipes.js';
import type {ChannelInfo} from '../../recipes/ChannelRecipes.js';
import type {RawChannelEntry} from '../../models/ChannelManager.js';
import ChannelManager from '../../models/ChannelManager.js';
import OneObjectCache from '../utils/caches/OneObjectCache.js';
import ChatAttachmentCache from '../utils/caches/ChatAttachmentCache.js';
import RawChannelEntriesCache from '../utils/caches/RawChannelEntriesCache.js';

export default class ChatApi implements ChatApiType {
    private oneApi: OneApi;
    private models: ModelsHelperType;

    constructor(oneApi: OneApi, models: ModelsHelperType) {
        this.oneApi = oneApi;
        this.models = models;
    }

    /**
     * Get a topic by id. If the topic does not exist, it will be created.
     * @param topicId
     * @returns
     */
    public async getTopic(topicId: string): Promise<Topic> {
        let topic = await this.models.getTopicModel().topics.queryById(topicId);
        if (topic === undefined) {
            if (this.models.getTopicModel().isOneToOneChat(topicId)) {
                topic = await this.models.getTopicModel().createOneToOneTopicFromTopicId(topicId);
            } else {
                topic = await this.models.getTopicModel().createGroupTopic(topicId);
            }
        }

        return topic;
    }

    /**
     * Get all available one to one topics.
     * @returns
     */
    public async getAllOneToOneTopics(): Promise<Topic[]> {
        const topics = await this.getAllTopics();
        return topics.filter(topic => this.models.getTopicModel().isOneToOneChat(topic.id));
    }

    /**
     * Get all available group topics.
     * @returns
     */
    public async getAllGroupTopics(): Promise<Topic[]> {
        const topics = await this.getAllTopics();
        return topics.filter(topic => !this.models.getTopicModel().isOneToOneChat(topic.id));
    }

    /**
     * Get all available topics.
     * @returns
     */
    public async getAllTopics(): Promise<Topic[]> {
        return this.models.getTopicModel().topics.all();
    }

    /**
     * Get all possible one to one topic ids with other people in the leute model.
     * @returns
     */
    public async getAllPossibleOneToOneTopicIds(): Promise<string[]> {
        const myPersonId = await this.models.getLeuteModel().myMainIdentity();
        const others = await this.models.getLeuteModel().others();
        const topics: string[] = [];
        for (const other of others) {
            const otherPersonId = await other.mainIdentity();
            topics.push(
                this.models.getTopicModel().createOneToOneTopicId(myPersonId, otherPersonId)
            );
        }
        return topics;
    }

    /**
     * Get all possible group topic ids from groups in the leute model.
     * @returns
     */
    public async getAllPossibleGroupTopicIds(): Promise<string[]> {
        const groups = await this.models.getLeuteModel().groups();
        const topics: string[] = [];
        for (const group of groups) {
            topics.push(group.name);
        }
        return topics;
    }

    /**
     * Get all possible topic ids, includes one to one and group topics.
     * @returns
     */
    public async getAllPossibleTopicIds(): Promise<string[]> {
        return [
            ...(await this.getAllPossibleOneToOneTopicIds()),
            ...(await this.getAllPossibleGroupTopicIds())
        ];
    }

    /**
     * Send a message to a topic. If the topic does not exist, it will be created.
     *
     * @throws {Error} if the channel is not found
     * @param topicId
     * @param message
     * @param options.owner - owner of the channel, if not set, will try to find the owner of the topicId channel or use no owner if not found
     * @param options.author - author of the message
     * @param options.attachmentType - type of attachment to be sent, only one type of attachment can be sent at a time
     * @param options.files - array of files to be sent as attachments, only one type of attachment can be sent at a time
     * @param options.hashes - array of hashes to be sent as attachments, only one type of attachment can be sent at a time
     */
    public async sendMessage(
        topicId: string,
        message: string,
        options?: ChatApiSendMessageOptions
    ): Promise<void> {
        const ownerId = await this.getTopicRoomOwner(topicId, options?.owner);
        const topicRoom = await this.models.getTopicModel().enterTopicRoom(topicId);

        if (
            options !== undefined &&
            options.attachmentType === 'file' &&
            options.files !== undefined
        ) {
            await topicRoom.sendMessageWithAttachmentAsFile(
                message,
                options.files,
                options.author,
                ownerId
            );
        } else if (
            options !== undefined &&
            options.attachmentType === 'hash' &&
            options.hashes !== undefined
        ) {
            await topicRoom.sendMessageWithAttachmentAsHash(
                message,
                options.hashes,
                options.author,
                ownerId
            );
        } else if (
            options !== undefined &&
            options.attachmentType === 'thumbnail' &&
            options.files !== undefined
        ) {
            await topicRoom.sendMessageWithThumbnailImageAttachmentAsFile(
                message,
                options.files,
                options.author,
                ownerId
            );
        } else {
            await topicRoom.sendMessage(message, options?.author, ownerId);
        }
    }

    /**
     * Get a channel iterator for the selected chat.
     *
     * @throws {Error} if the channel is not found
     * @param topicId
     * @param ownerId
     */
    public async getMessagesChannelIterator(
        topicId: string,
        ownerId?: SHA256IdHash<Person>
    ): Promise<AsyncIterableIterator<RawChannelEntry> | undefined> {
        const topicRoomOwner = await this.getTopicRoomOwner(topicId, ownerId);
        return await this.createNewChannelIterator(topicId, topicRoomOwner);
    }

    /**
     * Get and listen for new messages in a chat.
     * Ensure to call shutdown() on the returned object when you are done listening for messages.
     *
     * @throws {Error} if the channel is not found
     * @param topicId
     * @param onUpdate - called when new messages are available or attachments are loaded
     * @param options.ownerId - owner of the channel, if not set, will try to find the owner of the topicId channel or use no owner if not found
     * @param options.batchSize - number of messages to load at a time
     * @param options.onAsyncError - called when there is an error in the async process
     * @param options.authorId - author of the messages, if not set, will use the main identity of the leute model
     */
    public async getAndListenForMessages(
        topicId: string,
        onMessagesUpdate: (messages: CachedChatMessage[]) => Promise<void> | void,
        onNewMessages: () => Promise<void> | void,
        onAttachmentUpdate: () => Promise<void> | void,
        options: {
            ownerId?: SHA256IdHash<Person>;
            batchSize?: number;
            onAsyncError?: (error: any) => void;
            authorId?: SHA256IdHash<Person>;
        }
    ): Promise<{shutdown: () => void; loadNextBatch: () => void}> {
        let messagesCache: CachedChatMessage[] = [];
        const authorId = options.authorId ?? (await this.models.getLeuteModel().myMainIdentity());
        const shutdownListeners: Array<() => void> = [];
        const attachmentCache = new ChatAttachmentCache();
        const messageCache = new OneObjectCache<ChatMessage>(['ChatMessage']);
        const ownerId = await this.getTopicRoomOwner(topicId, options.ownerId);
        const rawChannelEntriesCache = new RawChannelEntriesCache(
            this.models.getChannelManager(),
            topicId,
            ownerId ?? undefined,
            options.batchSize ?? 25
        );

        shutdownListeners.push(attachmentCache.onError(options.onAsyncError ?? console.error));
        shutdownListeners.push(attachmentCache.onUpdate(onAttachmentUpdate.bind(undefined)));
        shutdownListeners.push(attachmentCache.shutdown.bind(attachmentCache));
        shutdownListeners.push(
            messageCache.onUpdate((_objHash, obj) => {
                if (obj.attachments && !obj.thumbnails) {
                    for (const attachment of obj.attachments) {
                        attachmentCache.monitorAttachment(attachment);
                    }
                } else if (obj.thumbnails) {
                    for (const thumbnail of obj.thumbnails) {
                        attachmentCache.monitorAttachment(thumbnail);
                    }
                }
            })
        );
        shutdownListeners.push(
            rawChannelEntriesCache.onError(options.onAsyncError ?? console.error)
        );
        shutdownListeners.push(
            rawChannelEntriesCache.onUpdate(async (newMessages: boolean) => {
                const leuteModel = this.models.getLeuteModel();
                // #### Build the message cache and load the messages
                messagesCache = [];
                for (const rawLinkedListEntry of rawChannelEntriesCache.cachedEntries()) {
                    // Trigger the async load of the message
                    const chatMessage =
                        await messageCache.queryOrLoadObjectIntoCacheWithRuntimeCheck(
                            rawLinkedListEntry.dataHash
                        );

                    const message: CachedChatMessage = {
                        date: new Date(rawLinkedListEntry.creationTime),
                        isMe: chatMessage.sender === authorId,
                        get author(): string {
                            return leuteModel.getPersonName(this.authorIdHash) || this.authorIdHash;
                        },
                        message: chatMessage.text,
                        get attachments(): ChatAttachmentsInfo[] {
                            if (chatMessage.attachments === undefined) {
                                return [];
                            }

                            if (chatMessage.attachments && chatMessage.thumbnails) {
                                return chatMessage.thumbnails.map((thumbnailIdHash, index) => {
                                    const attachmentHash = chatMessage.attachments
                                        ? chatMessage.attachments[index]
                                        : undefined;
                                    if (!attachmentCache.initialized()) {
                                        return {
                                            cachedOneObject: undefined,
                                            hash: thumbnailIdHash,
                                            isThumbnail: false,
                                            originalHash: undefined
                                        };
                                    }
                                    return {
                                        cachedOneObject:
                                            attachmentCache.queryAttachment(thumbnailIdHash),
                                        hash: thumbnailIdHash,
                                        isThumbnail: true,
                                        originalHash: attachmentHash
                                    };
                                });
                            }

                            return chatMessage.attachments.map(attachmentIdHash => {
                                return {
                                    cachedOneObject:
                                        attachmentCache.queryAttachment(attachmentIdHash),
                                    hash: attachmentIdHash
                                };
                            });
                        },
                        authorIdHash: chatMessage.sender,
                        messageHash: rawLinkedListEntry.dataHash as SHA256Hash<ChatMessage>,
                        channelEntryHash: rawLinkedListEntry.channelEntryHash,
                        creationTimeHash: rawLinkedListEntry.creationTimeHash
                    };

                    messagesCache.push(message);
                }

                await onMessagesUpdate(messagesCache);
                if (newMessages) {
                    await onNewMessages();
                }
            })
        );
        shutdownListeners.push(rawChannelEntriesCache.shutdown.bind(rawChannelEntriesCache));
        shutdownListeners.push(messageCache.shutdown.bind(messageCache));

        // Start loading the first batch
        rawChannelEntriesCache.init();

        return {
            shutdown: () => {
                for (const listener of shutdownListeners) {
                    listener();
                }
            },
            loadNextBatch: () => {
                rawChannelEntriesCache.loadNextBatch();
            }
        };
    }

    /**
     * Get the topic room owner of the channel.
     *
     * @throws {Error} if the channel is not found
     * @param topicId
     * @param ownerId
     * @returns ownerId or null, if no owner is set
     */
    public async getTopicRoomOwner(
        topicId: string,
        ownerId?: SHA256IdHash<Person>
    ): Promise<SHA256IdHash<Person> | null> {
        if (ownerId === null) {
            const topic = await this.getTopic(topicId);
            const channels = await this.models.getChannelManager().channels({channelId: topic.id});
            if (channels.length < 0) {
                throw Error('Channel not found');
            }
            return channels[0].owner ?? null;
        }
        return ownerId ?? null;
    }

    /**
     * Create a new raw iterator for the channel of the selected chat.
     *
     * @private
     */
    private async createNewChannelIterator(
        channelId: string,
        owner: SHA256IdHash<Person> | 'mainId' | null | undefined
    ): Promise<AsyncIterableIterator<RawChannelEntry> | undefined> {
        const infos: ChannelInfo[] = await this.models.getChannelManager().getMatchingChannelInfos({
            channelId: channelId,
            owner: owner
        });
        if (infos.length > 1) {
            throw new Error(
                'Programming Error: Number of returned channels is >1, this should not happen.'
            );
        }
        if (infos.length === 0) {
            return;
        }
        return ChannelManager.singleChannelObjectIterator(
            infos[0],
            undefined,
            undefined,
            undefined,
            true
        );
    }
}
