import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import {Model} from './Model.js';

import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {HeartEvent} from '../recipes/HeartEventRecipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {OEvent} from '../misc/OEvent.js';

/**
 * This model implements the possibility of adding or retrieving HeartEvents that occurred on the Apple watch.
 * Those Events can be {@link HEART_OCCURRING_EVENTS}
 * For more information, see Chapter Vital Signs in {@link https://developer.apple.com/documentation/healthkit/data_types}
 */
export default class HeartEventModel extends Model {
    private readonly channelManager: ChannelManager;
    public static readonly channelId = 'heartEvent';

    /**
     * Disconnect function to detach the channel manager listener
     * @private
     */
    private disconnect: (() => void) | undefined;

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    /**
     * @param channelManager - The channel manager instance
     */
    constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
    }

    /**
     * Initialize the model
     */
    public async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(HeartEventModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleOnUpdated.bind(this));

        this.state.triggerEvent('init');
    }

    /**
     * Shutdown the model
     */
    public async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    /**
     * Adds a HeartEvent
     * @param heartEvent
     */
    public async addHeartEvent(heartEvent: HeartEvent): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.channelManager.postToChannel(HeartEventModel.channelId, heartEvent);
    }

    /**
     * Get all the heartEvents
     */
    public async heartEvents(): Promise<ObjectData<HeartEvent>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('HeartEvent', {
            channelId: HeartEventModel.channelId
        });
    }

    /**
     * returns iterator for Heart Events
     * @param queryOptions
     */
    public async *heartEventsIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<HeartEvent>> {
        this.state.assertCurrentState('Initialised');

        for await (const entry of this.channelManager.objectIteratorWithType('HeartEvent', {
            ...queryOptions,
            channelId: HeartEventModel.channelId
        })) {
            yield entry;
        }
    }

    /**
     *  Handler function for the 'updated' event
     * @param channelInfoIdHash
     * @param channelId
     * @param channelOwner
     * @param timeOfEarliestChange
     * @param data
     */
    private async handleOnUpdated(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === HeartEventModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
