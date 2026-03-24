import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {
    OneObjectTypes,
    OneVersionedObjectTypes,
    Person
} from '@refinio/one.core/lib/recipes.js';

import type ChannelManager from '../../models/ChannelManager.js';
import type DocumentModel from '../../models/DocumentModel.js';
import type IoMManager from '../../models/IoM/IoMManager.js';
import type LeuteModel from '../../models/Leute/LeuteModel.js';
import type QuestionnaireModel from '../../models/QuestionnaireModel.js';
import type TopicModel from '../../models/Chat/TopicModel.js';
import type {ChatMessage, Topic} from '../../recipes/ChatRecipes.js';
import type {RawChannelEntry} from '../../models/ChannelManager.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import type {CreationTime} from '../../recipes/MetaRecipes.js';
import type ConnectionsModel from '../../models/ConnectionsModel.js';
import type {ConnectionsModelConfiguration} from '../../models/ConnectionsModel.js';
import type {Invitation} from '../../misc/ConnectionEstablishment/PairingManager.js';
import type {ConnectionInfo} from '../../misc/ConnectionEstablishment/LeuteConnectionsModule.js';
import type GroupModel from '../../models/Leute/GroupModel.js';
import type ProfileModel from '../../models/Leute/ProfileModel.js';
import type SomeoneModel from '../../models/Leute/SomeoneModel.js';
import type {Someone} from '../../recipes/Leute/Someone.js';

export type OneApi = {
    chat: () => ChatApiType;
    data: () => DataApiType;
    internetOfPeople: () => InternetOfPeopleApiType;
    internetOfMe: () => InternetOfMeApiType;
    trust: () => TrustApiType;
    leute: () => LeuteApiType;
};

export type ModelsHelperType = {
    getLeuteModel: () => LeuteModel;
    getChannelManager: () => ChannelManager;
    getQuestionnaireModel: () => QuestionnaireModel;
    getDocumentModel: () => DocumentModel;
    getIoMManager: () => IoMManager;
    getTopicModel: () => TopicModel;
    getConnectionsModel: () => ConnectionsModel;
};

export type ModelsTypes = {
    topicModel?: TopicModel;
    leuteModel?: LeuteModel;
    iomManager?: IoMManager;
    channelManager?: ChannelManager;
    documentModel?: DocumentModel;
    questionnaireModel?: QuestionnaireModel;
    connectionsModel?: ConnectionsModel;
};

export type ChatApiType = {
    getTopic: (topicId: string) => Promise<Topic>;
    getAllTopics: () => Promise<Topic[]>;
    getAllOneToOneTopics: () => Promise<Topic[]>;
    getAllGroupTopics: () => Promise<Topic[]>;
    getAllPossibleOneToOneTopicIds: () => Promise<string[]>;
    getAllPossibleGroupTopicIds: () => Promise<string[]>;
    getAllPossibleTopicIds: () => Promise<string[]>;
    sendMessage: (
        topicId: string,
        message: string,
        options: ChatApiSendMessageOptions
    ) => Promise<void>;
    getMessagesChannelIterator: (
        topicId: string,
        ownerId?: SHA256IdHash<Person>
    ) => Promise<AsyncIterableIterator<RawChannelEntry> | undefined>;
    getAndListenForMessages: (
        topicId: string,
        onMessagesUpdate: (messages: CachedChatMessage[]) => Promise<void>,
        onNewMessages: () => Promise<void>,
        onAttachmentUpdate: () => Promise<void>,
        options: {
            ownerId?: SHA256IdHash<Person>;
            batchSize?: number;
        }
    ) => Promise<{shutdown: () => void; loadNextBatch: () => void}>;
};

export type ChatApiSendMessageOptions = {
    owner?: SHA256IdHash<Person>;
    author?: SHA256IdHash<Person>;
} & ChatAttachments;

type ChatAttachments =
    | {
          attachmentType?: typeof ATTACHMENT_TYPE.FILE;
          files?: File[];
      }
    | {
          attachmentType?: typeof ATTACHMENT_TYPE.HASH;
          hashes?: SHA256Hash[];
      }
    | {
          attachmentType?: typeof ATTACHMENT_TYPE.THUMBNAIL;
          files?: {original: File; thumbnail: File}[];
      };

export const ATTACHMENT_TYPE = {
    FILE: 'file',
    HASH: 'hash',
    THUMBNAIL: 'thumbnail'
} as const;

export type ChatAttachmentsInfo = {
    cachedOneObject: OneObjectTypes | undefined; // undefined when ChatAttachmentCache is still loading the object
    hash: SHA256Hash;
    originalHash?: SHA256Hash;
};

export type CachedChatMessage = {
    date: Date;
    isMe: boolean;
    author: string;
    message: string;
    attachments: ChatAttachmentsInfo[];
    authorIdHash: SHA256IdHash<Person>;
    messageHash: SHA256Hash<ChatMessage>;
    channelEntryHash: SHA256Hash<LinkedListEntry>;
    creationTimeHash: SHA256Hash<CreationTime>;
};

export type LeuteApiType = {
    init: (config: LeuteApiInitConfig) => void;
    shutdown: () => void;
    getPersonName: (personId: SHA256IdHash<Person>) => string;
    createIdentity: (someoneId: SHA256IdHash<Someone>, email?: string) => Promise<ProfileModel>;
    createProfile: (personId: SHA256IdHash<Person>) => Promise<ProfileModel>;
    createSomeone: () => Promise<SomeoneModel>;
    addGroup: (name: string) => Promise<GroupModel>;
    getGroup: (groupName: string) => Promise<GroupModel>;
    getGroups: () => Promise<GroupModel[]>;
    getGroupMembers: (
        groupName: string
    ) => Promise<{personId: SHA256IdHash<Person>; name: string}[]>;
    getMyMainProfile: () => Promise<ProfileModel>;
    getMainProfile: (personId: SHA256IdHash<Person>) => Promise<ProfileModel>;
    getMyMainIdentity: () => Promise<SHA256IdHash<Person>>;
    getInitialPeers: () => Promise<SomeoneModel[]>;
    getEveryoneElseExceptInitialPeers: () => Promise<SomeoneModel[]>;
    getEveryoneElseExcept: (personId: SHA256IdHash<Person>) => Promise<SomeoneModel[]>;
    getEveryoneElse: () => Promise<SomeoneModel[]>;
    getEveryone: () => Promise<SomeoneModel[]>;
    getProfiles: (personId: SHA256IdHash<Person>, all: boolean) => Promise<ProfileModel[]>;
    getSomeoneIdentities: (personId: SHA256IdHash<Person>) => Promise<SHA256IdHash<Person>[]>;
    removeSomeone: (someoneId: SHA256IdHash<Someone>) => Promise<void>;
};

export type OneApiCreateConfig = {
    commServerUrl: string;
    externalModels?: boolean | Partial<Record<keyof ModelsTypes, boolean>>;
    connectionsModelConfig?: Partial<ConnectionsModelConfiguration>;
};

export type OneApiInitConfig = ModelsInitConfig & LeuteApiInitConfig;
export type ModelsInitConfig = {
    initedModels?: (() => Promise<ModelsTypes>) | ModelsTypes;
};
export type LeuteApiInitConfig = {
    initialPeers?: SHA256IdHash<Person>[];
};

export type DataApiType = {
    getAllVersions: <T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>
    ) => Promise<T[]>;
    useLiveAllVersions: <T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>,
        onUpdate: (data: T[]) => void | Promise<void>
    ) => Promise<() => void>;
};

export type InternetOfPeopleApiType = {
    tryPairing: (
        invitationToken: string,
        maxTries: number,
        setError: (error: Error) => void
    ) => Promise<boolean>;
    getPairingInformation: (invitationLink: string) => Invitation | undefined;
    getConnections: () => Promise<ConnectionInfo[]>;
    createInvitationToken: () => Promise<string>;
};

export type InternetOfMeApiType = {
    tryPairing: (
        invitationToken: string,
        maxTries: number,
        setError: (error: Error) => void
    ) => Promise<() => void>;
    getPairingInformation: (invitationLink: string) => Invitation | undefined;
    getConnections: () => Promise<ConnectionInfo[]>;
    createInvitationToken: () => Promise<string>;
};

export type TrustApiType = {
    giveAffirmationCertificate: (data: SHA256Hash) => Promise<void>;
};
