import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel';
import BlobCollectionModel from '@refinio/one.models/lib/models/BlobCollectionModel';
import type Notifications from '@refinio/one.models/lib/models/Notifications';
import type {EasyDirectoryContent, EasyDirectoryEntry} from '@refinio/one.models/lib/fileSystems/utils/EasyFileSystem';
import EasyFileSystem from '@refinio/one.models/lib/fileSystems/utils/EasyFileSystem';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks';
import type {OneObjectTypes} from '@refinio/one.core/lib/recipes';
import type {ChatMessage} from '@refinio/one.models/lib/recipes/ChatRecipes';
import {readUTF8TextFile} from '@refinio/one.core/lib/system/storage-base';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects';

import type {ChatTrieManagerLike} from './createChatTrieManager';

const emojiNumberMap = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '*'];

type TrieBackedChatMessage = {
    attachmentCount: number;
    authorName: string;
    creationTime: Date;
    data: ChatMessage;
    dataHash: SHA256Hash<ChatMessage>;
    messageHash: SHA256Hash<ChatMessage>;
    text: string;
};

/**
 * Chat filesystem backed by the trie-based chat manager instead of TopicRoom /
 * channel traversal.
 */
export class TrieChatFileSystem extends EasyFileSystem {
    private readonly chatTrieManager: ChatTrieManagerLike;
    private readonly leuteModel: LeuteModel;
    private readonly notifications: Notifications;
    private readonly topicModel: TopicModel;

    constructor(
        leuteModel: LeuteModel,
        topicModel: TopicModel,
        chatTrieManager: ChatTrieManagerLike,
        notifications: Notifications,
        _objectFileSystemPath: string
    ) {
        super(true);
        this.setRootDirectory(
            new Map<string, EasyDirectoryEntry>([
                [
                    '1to1_chats',
                    {type: 'directory', content: this.createOneToOneChatsFolder.bind(this)}
                ],
                ['all_topics', {type: 'directory', content: this.createAllTopicsFolder.bind(this)}]
            ])
        );
        this.chatTrieManager = chatTrieManager;
        this.topicModel = topicModel;
        this.leuteModel = leuteModel;
        this.notifications = notifications;
    }

    private async createOneToOneChatsFolder(): Promise<EasyDirectoryContent> {
        const dir = new Map<string, EasyDirectoryEntry>();
        const topics = await this.topicModel.topics.all();

        for (const topic of topics) {
            if (!this.topicModel.isOneToOneChat(topic.id)) {
                continue;
            }

            const [meHash, otherHash] = await this.topicModel.getOneToOneChatParticipantsMeFirst(
                topic.id
            );
            const myName = await this.leuteModel.getDefaultProfileDisplayName(meHash);
            const otherName = await this.leuteModel.getDefaultProfileDisplayName(otherHash);
            const notificationCount = this.notifications.getNotificationCountForTopic(topic.id);
            const notificationCountEmoji = TrieChatFileSystem.countToEmoji(notificationCount);
            const chatString = `${myName}<->${otherName}`;
            const chatStringWithNotification = `${notificationCountEmoji} ${myName}<->${otherName}`;

            if (dir.has(chatString)) {
                continue;
            }

            dir.set(chatString, {
                type: 'directory',
                content: this.createTopicRoomFolder.bind(this, topic.id)
            });

            if (notificationCount > 0) {
                dir.set(chatStringWithNotification, {
                    type: 'regularFile',
                    content: ''
                });
            }
        }

        return dir;
    }

    private async createAllTopicsFolder(): Promise<EasyDirectoryContent> {
        const dir = new Map<string, EasyDirectoryEntry>();
        const topics = await this.topicModel.topics.all();

        for (const topic of topics) {
            dir.set(topic.id, {
                type: 'directory',
                content: this.createTopicRoomFolder.bind(this, topic.id)
            });

            const notificationCount = this.notifications.getNotificationCountForTopic(topic.id);
            if (notificationCount > 0) {
                const notificationCountEmoji = TrieChatFileSystem.countToEmoji(notificationCount);
                dir.set(`${notificationCountEmoji} ${topic.id}`, {
                    type: 'regularFile',
                    content: ''
                });
            }
        }

        return dir;
    }

    private async createTopicRoomFolder(topicId: string): Promise<EasyDirectoryContent> {
        const rootDir = new Map<string, EasyDirectoryEntry>();
        rootDir.set('_attachments', {
            type: 'directory',
            content: this.createAttachmentsFolder.bind(this, topicId, false)
        });
        rootDir.set('_images', {
            type: 'directory',
            content: this.createAttachmentsFolder.bind(this, topicId, true)
        });

        const messages = await this.loadTopicMessages(topicId);

        for (const message of messages) {
            const attachmentCount = TrieChatFileSystem.countToEmoji(message.attachmentCount);
            const messageDirName = `${this.dateToString(message.creationTime)} ${attachmentCount} ${
                message.authorName
            }${message.text === '' ? '' : ': ' + message.text}`;
            rootDir.set(messageDirName, await this.createChatMessageFolder(message));
        }

        return rootDir;
    }

    private async createAttachmentsFolder(
        topicId: string,
        imagesOnly: boolean
    ): Promise<EasyDirectoryContent> {
        const attachmentsDir = new Map<string, EasyDirectoryEntry>();
        const messages = await this.loadTopicMessages(topicId);

        for (const message of messages) {
            const attachments = await this.loadAttachments(message.data.attachments, imagesOnly);

            for (const attachment of attachments) {
                attachmentsDir.set(
                    `${this.dateToString(message.creationTime)} ${attachment.name}`,
                    attachment.dirent
                );
            }
        }

        return attachmentsDir;
    }

    private async createChatMessageFolder(
        message: TrieBackedChatMessage
    ): Promise<EasyDirectoryEntry> {
        const content = new Map<string, EasyDirectoryEntry>();
        const chatMessageMicrodata = await readUTF8TextFile(message.messageHash);

        content.set('message.microdata.txt', {
            type: 'regularFile',
            content: new TextEncoder().encode(chatMessageMicrodata)
        });
        content.set('message.json', {
            type: 'regularFile',
            content: new TextEncoder().encode(JSON.stringify(message.data, null, 4))
        });
        content.set('signatures', {
            type: 'directory',
            content: this.loadSignatures.bind(this, [message.messageHash])
        });

        const attachments = await this.loadAttachments(message.data.attachments, false);
        attachments.forEach(function eachAttachment(attachment) {
            content.set(attachment.name, attachment.dirent);
        });

        return {
            type: 'directory',
            content
        };
    }

    private async loadTopicMessages(topicId: string): Promise<TrieBackedChatMessage[]> {
        const result = await this.chatTrieManager.getMessageEntries(topicId);
        const messages: TrieBackedChatMessage[] = [];

        for (const entry of result.entries) {
            const obj = await getObject(entry.messageHash as SHA256Hash<ChatMessage>);

            if (obj.$type$ !== 'ChatMessage') {
                throw new Error(
                    `TrieChatFileSystem: expected ChatMessage for ${entry.messageHash}, got ${obj.$type$}`
                );
            }

            let authorName = 'unknown';

            try {
                authorName = await this.leuteModel.getDefaultProfileDisplayName(entry.authorId as any);
            } catch (_error) {}

            messages.push({
                attachmentCount: obj.attachments?.length || 0,
                authorName,
                creationTime: new Date(entry.timestamp),
                data: obj as ChatMessage,
                dataHash: entry.messageHash as SHA256Hash<ChatMessage>,
                messageHash: entry.messageHash as SHA256Hash<ChatMessage>,
                text: obj.text || ''
            });
        }

        return messages;
    }

    private async loadAttachments(
        attachments: SHA256Hash[] | undefined,
        _imagesOnly: boolean
    ): Promise<
        Array<{
            name: string;
            dirent: EasyDirectoryEntry;
            object: OneObjectTypes;
            hash: SHA256Hash;
        }>
    > {
        if (attachments === undefined) {
            return [];
        }

        return await Promise.all(
            attachments.map(this.loadAttachment.bind(this))
        );
    }

    private async loadAttachment(
        attachment: SHA256Hash
    ): Promise<{
        name: string;
        dirent: EasyDirectoryEntry;
        object: OneObjectTypes;
        hash: SHA256Hash;
    }> {
        const data = await getObject(attachment);

        if (data.$type$ === 'BlobDescriptor') {
            return {
                name: data.name,
                dirent: {
                    type: 'regularFile',
                    content: async function loadBlob(): Promise<Uint8Array> {
                        const resolved = await BlobCollectionModel.resolveBlobDescriptor(data);
                        return new Uint8Array(resolved.data);
                    }
                },
                object: data,
                hash: attachment
            };
        }

        return {
            name: data.$type$ + '.json',
            dirent: {
                type: 'regularFile',
                content: JSON.stringify(data, null, 4)
            },
            object: data,
            hash: attachment
        };
    }

    private async loadSignatures(objects: SHA256Hash[]): Promise<EasyDirectoryContent> {
        const dir = new Map<string, EasyDirectoryEntry>();

        for (const object of objects) {
            const certificateHashes = await getAllEntries(object, 'AffirmationCertificate');

            for (const certificateHash of certificateHashes) {
                const cert = await getObject(certificateHash);
                const signatureObjectHashes = await getAllEntries(certificateHash, 'Signature');
                const signatures = await Promise.all(
                    signatureObjectHashes.map(async (signatureObjectHash) => {
                        const signature = await getObject(signatureObjectHash);
                        const issuer = await this.leuteModel.getDefaultProfileDisplayName(
                            signature.issuer
                        );
                        return {
                            cert,
                            issuer,
                            signature
                        };
                    })
                );

                for (const signature of signatures) {
                    dir.set(`${signature.issuer}.json`, {
                        type: 'regularFile',
                        content: JSON.stringify(signature, null, 4)
                    });
                }
            }
        }

        return dir;
    }

    private static countToEmoji(count: number | undefined = 0): string {
        return emojiNumberMap[count <= 10 ? count : 11];
    }

    private dateToString(date: Date): string {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const unmodifiedHour = date.getHours();
        const hour = String(unmodifiedHour >= 12 ? unmodifiedHour - 12 : unmodifiedHour).padStart(
            2,
            '0'
        );
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        const hourFormat = unmodifiedHour >= 12 ? 'PM' : 'AM';

        return `${year}/${month}/${day} ${hour}:${minute}:${second} ${hourFormat}`;
    }
}
