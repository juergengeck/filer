/**
 * @author Sebastian Ganea <sebastian.ganea@refinio.net>
 */

import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import {Model} from './Model.js';

import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BloodGlucose} from '../recipes/BloodGlucoseRecipes.js';
import {OEvent} from '../misc/OEvent.js';

export default class BloodGlucoseModel extends Model {
    private disconnect: (() => void) | undefined;
    private readonly channelManager: ChannelManager;
    public static readonly channelId = 'bloodGlucose';

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    /**
     * Construct a new instance
     *
     * @param channelManager - The channel manager instance
     */
    constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
    }

    /**
     * Initialize this instance
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(BloodGlucoseModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleChannelUpdate.bind(this));
        this.state.triggerEvent('init');
    }

    /**
     *
     * @param BGSampleObject
     */
    async postBloodGlucose(BGSampleObject: BloodGlucose): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.channelManager.postToChannel(
            BloodGlucoseModel.channelId,
            BGSampleObject,
            undefined,
            BGSampleObject.startTimestamp
        );
    }

    /**
     *
     * @returns
     */
    async retrieveAllWithoutData(): Promise<ObjectData<BloodGlucose>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('BloodGlucose', {
            omitData: true,
            channelId: BloodGlucoseModel.channelId
        });
    }

    async retrieveWithQueryOptions(
        queryOptions: QueryOptions
    ): Promise<ObjectData<BloodGlucose>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('BloodGlucose', {
            ...queryOptions,
            channelId: BloodGlucoseModel.channelId
        });
    }

    /**
     *
     * @param bloodGlucoseHash
     * @returns
     */
    async retrieveBloodGlucoseByHash(
        bloodGlucoseHash: SHA256Hash<BloodGlucose>
    ): Promise<BloodGlucose> {
        this.state.assertCurrentState('Initialised');

        return await getObject(bloodGlucoseHash);
    }

    /**
     * returns iterator for BloodGlucose
     * @param queryOptions
     */
    async *bloodGlucoseIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<BloodGlucose>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIteratorWithType('BloodGlucose', {
            ...queryOptions,
            channelId: BloodGlucoseModel.channelId
        });
    }

    /**
     * Returns the start timestamp of the last Blood Glucose available in the channel or 0 otherwise.
     * @private
     */
    async getLastBloodGlucoseTimestamp(): Promise<number> {
        this.state.assertCurrentState('Initialised');

        let lastBloodGlucoseStartimestamp = 0;
        const bloodGlucose = await this.channelManager.getObjectsWithType('BloodGlucose', {
            count: 1,
            channelId: BloodGlucoseModel.channelId
        });

        if (bloodGlucose.length > 0 && bloodGlucose[0].data.startTimestamp) {
            lastBloodGlucoseStartimestamp = bloodGlucose[0].data.startTimestamp;
        }

        return lastBloodGlucoseStartimestamp;
    }

    /**
     * Shutdown module
     */
    public async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        if (this.disconnect) {
            this.disconnect();
        }
        this.state.triggerEvent('shutdown');
    }

    /**
     * Handler function for the 'updated' event
     * @param _channelInfoIdHash
     * @param channelId
     * @param _channelOwner
     * @param timeOfEarliestChange
     * @param _data
     */
    private async handleChannelUpdate(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === BloodGlucoseModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
