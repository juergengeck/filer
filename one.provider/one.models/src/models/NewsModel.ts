import type ChannelManager from './ChannelManager.js';
import type {ObjectData, RawChannelEntry} from './ChannelManager.js';
import type {News as OneNews} from '../recipes/NewsRecipes.js';
import {Model} from './Model.js';
import {OEvent} from '../misc/OEvent.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';

/**
 * This represents the model of a news for now
 *
 */
export type News = {
    content: string;
};

/**
 * Convert from model representation to one representation.
 * @param modelObject - the model object
 * @returns The corresponding one object
 *
 */

function convertToOne(modelObject: News): OneNews {
    return {
        $type$: 'News',
        content: modelObject.content
    };
}

function convertFromOne(oneObject: OneNews): News {
    return {content: oneObject.content};
}

/**
 * This model implements a broadcast channel.
 */
export default class NewsModel extends Model {
    /**
     * Event emitted when news or feedback data is updated.
     */

    channelManager: ChannelManager;

    private disconnect: (() => void) | undefined;

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
    }

    /**
     * Initialize this instance of the feedback and news channel
     * This must be done after the one instance was initialized.
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel('feedbackChannel');
        await this.channelManager.createChannel('newsChannel');
        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));

        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    async addNews(content: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.postContent('newsChannel', content);
    }

    async addFeedback(content: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.postContent('feedbackChannel', content);
    }

    /**
     *
     * retrieve the news or feedback depending on the channel id provided
     */
    async entries(channelId: string): Promise<ObjectData<News>[]> {
        this.state.assertCurrentState('Initialised');

        const objects: ObjectData<News>[] = [];

        const oneObjects = await this.channelManager.getObjectsWithType('News', {
            channelId: channelId
        });

        for (const oneObject of oneObjects) {
            const {data, ...restObjectData} = oneObject;
            objects.push({...restObjectData, data: convertFromOne(data)});
        }

        return objects;
    }

    private async postContent(channelId: string, content: string): Promise<void> {
        await this.channelManager.postToChannel(channelId, convertToOne({content: content}));
        this.onUpdated.emit(new Date());
    }

    /**
     *  Handler function for the 'updated' event
     * @param _channelInfoIdHash
     * @param channelId
     * @param _channelOwner
     * @param timeOfEarliestChange
     * @param _data
     */
    private async handleOnUpdated(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === 'feedbackChannel' || channelId === 'newsChannel') {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
