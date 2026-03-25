import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';

import type {ChatTrieManagerLike} from './createChatTrieManager.js';
import {TrieChatFileSystem} from './TrieChatFileSystem.js';

type MountedFileSystem = {
    mountPoint: string;
    fileSystem: IFileSystem;
};

type RootFileSystemWithMounts = {
    mountFileSystem(path: string, fileSystem: IFileSystem): Promise<void>;
};

export type LegacyNodeRuntimeModels = {
    chatTrieManager?: ChatTrieManagerLike;
    channelManager: any;
    connectionsModel: any;
    iomManager: any;
    leuteModel: any;
    notifications: any;
    questionnaireModel?: any;
    topicModel: any;
};

export type LegacyNodeRuntimeRootFileSystem = {
    mountPoints: string[];
    rootFileSystem: IFileSystem;
};

async function mountFileSystems(
    rootFileSystem: RootFileSystemWithMounts,
    mountedFileSystems: MountedFileSystem[]
): Promise<void> {
    for (const mountedFileSystem of mountedFileSystems) {
        await rootFileSystem.mountFileSystem(mountedFileSystem.mountPoint, mountedFileSystem.fileSystem);
    }
}

export async function createLegacyRootFileSystem(
    models: LegacyNodeRuntimeModels,
    inviteUrlPrefix: string
): Promise<LegacyNodeRuntimeRootFileSystem> {
    const {default: TemporaryFileSystem} = await import('@refinio/one.models/lib/fileSystems/TemporaryFileSystem.js');
    const {default: ChatFileSystem} = await import('@refinio/one.models/lib/fileSystems/ChatFileSystem.js');
    const {default: DebugFileSystem} = await import('@refinio/one.models/lib/fileSystems/DebugFileSystem.js');
    const {default: PairingFileSystem} = await import('@refinio/one.models/lib/fileSystems/PairingFileSystem.js');
    const {default: ObjectsFileSystem} = await import('@refinio/one.models/lib/fileSystems/ObjectsFileSystem.js');
    const {default: TypesFileSystem} = await import('@refinio/one.models/lib/fileSystems/TypesFileSystem.js');
    const {default: ProfilesFileSystem} = await import('@refinio/one.models/lib/fileSystems/ProfilesFileSystem.js');
    const {default: QuestionnairesFileSystem} = await import('@refinio/one.models/lib/fileSystems/QuestionnairesFileSystem.js');

    const chatFileSystem = models.chatTrieManager
        ? new TrieChatFileSystem(
            models.leuteModel,
            models.topicModel,
            models.chatTrieManager,
            models.notifications,
            '/objects'
        )
        : new ChatFileSystem(
            models.leuteModel,
            models.topicModel,
            models.channelManager,
            models.notifications,
            '/objects'
        );
    const debugFileSystem = new DebugFileSystem(
        models.leuteModel,
        models.topicModel,
        models.connectionsModel,
        models.channelManager
    );
    const pairingFileSystem = new PairingFileSystem(
        models.connectionsModel,
        models.iomManager,
        inviteUrlPrefix,
        'full'
    );
    const objectsFileSystem = new ObjectsFileSystem();
    const typesFileSystem = new TypesFileSystem();
    const profilesFileSystem = new ProfilesFileSystem(models.leuteModel);
    const questionnairesFileSystem = models.questionnaireModel
        ? new QuestionnairesFileSystem(models.questionnaireModel)
        : new TemporaryFileSystem();

    const mountedFileSystems: MountedFileSystem[] = [
        {mountPoint: '/chats', fileSystem: chatFileSystem},
        {mountPoint: '/debug', fileSystem: debugFileSystem},
        {mountPoint: '/invites', fileSystem: pairingFileSystem},
        {mountPoint: '/objects', fileSystem: objectsFileSystem},
        {mountPoint: '/types', fileSystem: typesFileSystem},
        {mountPoint: '/profiles', fileSystem: profilesFileSystem},
        {mountPoint: '/questionnaires', fileSystem: questionnairesFileSystem}
    ];

    const rootFileSystem = new TemporaryFileSystem();
    await mountFileSystems(rootFileSystem, mountedFileSystems);

    return {
        mountPoints: mountedFileSystems.map(mountedFileSystem => mountedFileSystem.mountPoint),
        rootFileSystem
    };
}
