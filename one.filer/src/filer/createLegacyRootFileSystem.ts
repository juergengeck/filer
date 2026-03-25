import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem';
import type {ConnectionsModel} from '@refinio/one.models/lib/models';
import type {ChannelManager, LeuteModel, TopicModel} from '@refinio/one.models/lib/models';
import type IoMManager from '@refinio/one.models/lib/models/IoM/IoMManager';
import type Notifications from '@refinio/one.models/lib/models/Notifications';

import TemporaryFileSystem from '@refinio/one.models/lib/fileSystems/TemporaryFileSystem';
import ObjectsFileSystem from '@refinio/one.models/lib/fileSystems/ObjectsFileSystem';
import DebugFileSystem from '@refinio/one.models/lib/fileSystems/DebugFileSystem';
import TypesFileSystem from '@refinio/one.models/lib/fileSystems/TypesFileSystem';
import PairingFileSystem from '@refinio/one.models/lib/fileSystems/PairingFileSystem';
import ChatFileSystem from '@refinio/one.models/lib/fileSystems/ChatFileSystem';

import type {ChatTrieManagerLike} from './createChatTrieManager';
import type {FilerConfig} from './FilerConfig';
import {TrieChatFileSystem} from './TrieChatFileSystem';

type MountedFileSystem = {
    mountPoint: string;
    fileSystem: IFileSystem;
};

export type LegacyFilerModels = {
    chatTrieManager?: ChatTrieManagerLike;
    channelManager: ChannelManager;
    connections: ConnectionsModel;
    leuteModel: LeuteModel;
    notifications: Notifications;
    topicModel: TopicModel;
    iomManager: IoMManager;
};

export type LegacyRootFileSystemOptions = Pick<FilerConfig, 'iomMode' | 'pairingUrl'> & {
    commitHash: string;
};

async function mountFileSystems(
    rootFileSystem: TemporaryFileSystem,
    mountedFileSystems: MountedFileSystem[]
): Promise<void> {
    for (const mountedFileSystem of mountedFileSystems) {
        await rootFileSystem.mountFileSystem(mountedFileSystem.mountPoint, mountedFileSystem.fileSystem);
    }
}

export async function createLegacyRootFileSystem(
    models: LegacyFilerModels,
    options: LegacyRootFileSystemOptions
): Promise<IFileSystem> {
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
        models.connections,
        models.channelManager
    );
    const pairingFileSystem = new PairingFileSystem(
        models.connections,
        models.iomManager,
        options.pairingUrl,
        options.iomMode
    );
    const objectsFileSystem = new ObjectsFileSystem();
    const typesFileSystem = new TypesFileSystem();

    debugFileSystem.commitHash = options.commitHash;

    const rootFileSystem = new TemporaryFileSystem();
    await mountFileSystems(rootFileSystem, [
        {mountPoint: '/chats', fileSystem: chatFileSystem},
        {mountPoint: '/debug', fileSystem: debugFileSystem},
        {mountPoint: '/invites', fileSystem: pairingFileSystem},
        {mountPoint: '/objects', fileSystem: objectsFileSystem},
        {mountPoint: '/types', fileSystem: typesFileSystem}
    ]);

    return rootFileSystem;
}
