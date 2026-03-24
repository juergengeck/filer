import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../../recipes/ChannelRecipes.js';
import type {ChatMessage as OneChatMessage, Topic} from '../../recipes/ChatRecipes.js';
import type ChannelManager from '../ChannelManager.js';
import type {ObjectData, RawChannelEntry} from '../ChannelManager.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {OEvent} from '../../misc/OEvent.js';
import {storeFileWithBlobDescriptor} from '../../misc/storeFileWithBlobDescriptor.js';
import BlobCollectionModel from '../BlobCollectionModel.js';
import type {BlobDescriptor} from '../BlobCollectionModel.js';
import {BlobDescriptorRecipe} from '../../recipes/BlobRecipes.js';
import type {BlobDescriptor as OneBlobDescriptor} from '../../recipes/BlobRecipes.js';
import type LeuteModel from '../Leute/LeuteModel.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';

export interface ChatMessage extends Omit<OneChatMessage, 'attachments' | 'thumbnails'> {
    attachments: (BlobDescriptor | SHA256Hash)[];
    thumbnails?: (BlobDescriptor | SHA256Hash)[];
}

export default class TopicRoom {
    /**
     * Notify the user whenever a new chat message is received.
     */
    public onNewMessageReceived: OEvent<() => void> = new OEvent<() => void>();

    public topic: Topic;

    /** cache the last timestamp for queried messages **/
    private dateOfLastQueriedMessage: Date | undefined = undefined;

    private channelDisconnect: (() => void) | undefined;

    private channelManager: ChannelManager;
    private leuteModel: LeuteModel;

    constructor(topic: Topic, channelManager: ChannelManager, leuteModel: LeuteModel) {
        this.topic = topic;
        this.channelManager = channelManager;
        this.leuteModel = leuteModel;

        this.onNewMessageReceived.onListen(() => {
            if (this.onNewMessageReceived.listenerCount() === 0) {
                this.channelDisconnect = this.channelManager.onUpdated(
                    this.emitNewMessageEvent.bind(this)
                );
            }
        });
        this.onNewMessageReceived.onStopListen(() => {
            if (
                this.onNewMessageReceived.listenerCount() === 0 &&
                this.channelDisconnect !== undefined
            ) {
                this.channelDisconnect();
            }
        });
    }

    /**
     * Iterator to retrieved page-sized messages.
     * @param count
     */
    async *retrieveMessagesIterator(
        count: number = 25
    ): AsyncGenerator<ObjectData<OneChatMessage>[]> {
        let collectedItems = [];

        for await (const entry of this.channelManager.objectIteratorWithType('ChatMessage', {
            channelId: this.topic.id
        })) {
            collectedItems.push(entry);
            if (collectedItems.length === count) {
                yield collectedItems;
                collectedItems = [];
            }
        }

        if (collectedItems.length > 0) {
            yield collectedItems;
        }
    }

    /**
     * Retrieve all the messages in the chat.
     */
    async retrieveAllMessages(): Promise<ObjectData<OneChatMessage>[]> {
        return await this.channelManager.getObjectsWithType('ChatMessage', {
            channelId: this.topic.id
        });
    }

    /**
     * Retrieves all chat messages and resolves the blobs, if any, so the binary data can be used.
     */
    async retrieveAllMessagesWithAttachments(): Promise<ObjectData<ChatMessage>[]> {
        const messages = await this.channelManager.getObjectsWithType('ChatMessage', {
            channelId: this.topic.id
        });
        const resolvedMessages = [];
        for (const message of messages) {
            if (message.data.attachments) {
                const resolvedAttachments = await Promise.all(
                    message.data.attachments.map(async attachmentHash => {
                        const attachmentObj = await getObject(attachmentHash);
                        if (attachmentObj.$type$ === BlobDescriptorRecipe.name) {
                            return BlobCollectionModel.resolveBlobDescriptor(
                                attachmentObj as OneBlobDescriptor
                            );
                        } else {
                            return attachmentHash;
                        }
                    })
                );
                resolvedMessages.push({
                    ...message,
                    data: {...message.data, attachments: resolvedAttachments}
                });
            } else {
                resolvedMessages.push({...message, data: {...message.data, attachments: []}});
            }
        }
        return resolvedMessages;
    }

    /**
     * Sends the message with hash data in the chat room.
     *
     * @param message
     * @param attachments array of attached hashes
     * @param author
     * @param channelOwner
     */
    async sendMessageWithAttachmentAsHash(
        message: string,
        attachments: SHA256Hash[],
        author?: SHA256IdHash<Person>,
        channelOwner?: SHA256IdHash<Person> | null
    ): Promise<void> {
        if (author === undefined) {
            author = await this.leuteModel.myMainIdentity();
        }

        await this.channelManager.postToChannel(
            this.topic.id,
            {
                $type$: 'ChatMessage',
                text: message,
                sender: author,
                attachments: attachments
            },
            channelOwner,
            undefined,
            author
        );
    }

    /**
     * Sends the message with attachments in the chat room.
     * @param message
     * @param attachments array of attached files
     * @param author
     */
    async sendMessageWithAttachmentAsFile(
        message: string,
        attachments: File[],
        author?: SHA256IdHash<Person>,
        channelOwner?: SHA256IdHash<Person> | null
    ): Promise<void> {
        if (author === undefined) {
            author = await this.leuteModel.myMainIdentity();
        }

        const blobDescriptors = await Promise.all(
            attachments.map(file => storeFileWithBlobDescriptor(file))
        );
        const writtenAttachments = blobDescriptors.map(blobDescriptor => blobDescriptor.hash);

        await this.channelManager.postToChannel(
            this.topic.id,
            {
                $type$: 'ChatMessage',
                text: message,
                sender: author,
                attachments: writtenAttachments
            },
            channelOwner,
            undefined,
            author
        );
    }

    /**
     * Sends the message with attachments in the chat room.
     * @param message
     * @param attachments array of attached files
     * @param author
     */
    async sendMessageWithThumbnailImageAttachmentAsFile(
        message: string,
        attachments: {original: File; thumbnail: File}[],
        author?: SHA256IdHash<Person>,
        channelOwner?: SHA256IdHash<Person> | null
    ): Promise<void> {
        if (author === undefined) {
            author = await this.leuteModel.myMainIdentity();
        }

        const blobDescriptors = await Promise.all(
            attachments.map(async data => ({
                original: await storeFileWithBlobDescriptor(data.original),
                thumbnail: await storeFileWithBlobDescriptor(data.thumbnail)
            }))
        );
        const writtenOriginalAttachments = blobDescriptors.map(
            blobDescriptor => blobDescriptor.original.hash
        );
        const writtenThumbnailAttachments = blobDescriptors.map(
            blobDescriptor => blobDescriptor.thumbnail.hash
        );

        await this.channelManager.postToChannel(
            this.topic.id,
            {
                $type$: 'ChatMessage',
                text: message,
                sender: author,
                attachments: writtenOriginalAttachments,
                thumbnails: writtenThumbnailAttachments
            },
            channelOwner,
            undefined,
            author
        );
    }

    /**
     * Sends the message in the chat room.
     * @param message
     * @param author
     */
    async sendMessage(
        message: string,
        author?: SHA256IdHash<Person>,
        channelOwner?: SHA256IdHash<Person> | null
    ): Promise<void> {
        if (author === undefined) {
            author = await this.leuteModel.myMainIdentity();
        }

        await this.channelManager.postToChannel(
            this.topic.id,
            {
                $type$: 'ChatMessage',
                text: message,
                sender: author
            },
            channelOwner,
            undefined,
            author
        );
    }

    // --------------------------------- private ---------------------------------

    /**
     * Notify the client to update the conversation list (there might be a new last message for
     * a conversation).
     * @param _channelInfoIdHash
     * @param channelId
     * @param _channelOwner
     * @param timeOfEarliestChange
     * @param _data
     * @private
     */
    private async emitNewMessageEvent(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ) {
        if (channelId === this.topic.id) {
            this.onNewMessageReceived.emit();
        }
    }
}
