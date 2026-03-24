import type ConnectionsModel from '../models/ConnectionsModel.js';
import type LeuteModel from '../models/Leute/LeuteModel.js';
import {prettifySomeoneWithKeysAndInstances} from './utils/DebugDataFormatters.js';
import type {EasyDirectoryEntry} from './utils/EasyFileSystem.js';
import EasyFileSystem from './utils/EasyFileSystem.js';
import type {Topic} from '../recipes/ChatRecipes.js';
import type ChannelManager from '../models/ChannelManager.js';
import type TopicModel from '../models/Chat/TopicModel.js';

/**
 * This file systems provides debugging information about connections, channels identities,
 * topics ...
 */
export default class DebugFileSystem extends EasyFileSystem {
    public commitHash: string = 'unavailable';

    private readonly connectionsModel: ConnectionsModel;
    private readonly leuteModel: LeuteModel;
    private readonly topicModel: TopicModel;
    private readonly channelManager: ChannelManager;

    // Internally used list of provided files
    private static readonly files = ['connections.json', 'my_identities.json'];

    /**
     * Constructor
     *
     * @param leuteModel
     * @param topicModel
     * @param connectionsModel
     * @param channelManager
     */
    constructor(
        leuteModel: LeuteModel,
        topicModel: TopicModel,
        connectionsModel: ConnectionsModel,
        channelManager: ChannelManager
    ) {
        super(true);
        this.setRootDirectory(
            new Map<string, EasyDirectoryEntry>([
                ['chats.json', {type: 'regularFile', content: this.dumpTopicsAsJson.bind(this)}],
                [
                    'connections.json',
                    {type: 'regularFile', content: this.dumpConnectionsAsJson.bind(this)}
                ],
                [
                    'my_identities.json',
                    {type: 'regularFile', content: this.dumpMyIdentitiesAsJson.bind(this)}
                ],
                [
                    'channels.json',
                    {type: 'regularFile', content: this.dumpChannelsAsJson.bind(this)}
                ],
                ['commit-hash.txt', {type: 'regularFile', content: this.dumpCommitHash.bind(this)}]
            ])
        );

        this.topicModel = topicModel;
        this.connectionsModel = connectionsModel;
        this.leuteModel = leuteModel;
        this.channelManager = channelManager;
    }

    /**
     * This dumps all information about topics as JSON (for debugging purposes)
     */
    async dumpTopicsAsJson(): Promise<string> {
        const topics: Array<Topic & {messages?: string[]}> = await this.topicModel.topics.all();
        await Promise.all(
            topics.map(async topic => {
                const room = await this.topicModel.enterTopicRoom(topic.id);
                const msgs = await room.retrieveAllMessages();
                topic.messages = await Promise.all(
                    msgs.map(async msg => {
                        try {
                            const author = await this.leuteModel.getDefaultProfileDisplayName(
                                msg.data.sender
                            );
                            return `${author}: ${msg.data.text}`;
                        } catch (e) {
                            return `unknown: ${msg.data.text}`;
                        }
                    })
                );
            })
        );
        return JSON.stringify(topics, null, 4);
    }

    /**
     * This dumps all information about channels as JSON (for debugging purposes)
     */
    async dumpChannelsAsJson(): Promise<string> {
        return JSON.stringify(await this.channelManager.channels(), null, 4);
    }

    /**
     * This dumps all information about connections as JSON (for debugging purposes)
     */
    async dumpConnectionsAsJson(): Promise<string> {
        return JSON.stringify(this.connectionsModel.connectionsInfo(), null, 4);
    }

    /**
     * This dumps all information about connections as JSON (for debugging purposes)
     */
    async dumpMyIdentitiesAsJson(): Promise<string> {
        const me = await this.leuteModel.me();
        return JSON.stringify(await prettifySomeoneWithKeysAndInstances(me), null, 4);
    }

    /**
     * This dumps all information about connections as JSON (for debugging purposes)
     */
    async dumpCommitHash(): Promise<string> {
        return this.commitHash;
    }
}
