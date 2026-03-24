/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */

import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import {OEvent} from '../misc/OEvent.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';

import type {Electrocardiogram, ElectrocardiogramReadings} from '../recipes/ECGRecipes.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import type ChannelManager from './ChannelManager.js';
import {Model} from './Model.js';

export default class ECGModel extends Model {
    private disconnect: (() => void) | undefined;
    private readonly channelManager: ChannelManager;
    public static readonly channelId = 'electrocardiogram';

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

        await this.channelManager.createChannel(ECGModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleChannelUpdate.bind(this));

        this.state.triggerEvent('init');
    }

    /**
     *
     * @param ECGObject
     */
    async postECG(ECGObject: Electrocardiogram): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await this.channelManager.postToChannel(
            ECGModel.channelId,
            ECGObject,
            undefined,
            ECGObject.startTimestamp
        );
    }

    /**
     *
     * @returns
     */
    async retrieveAllWithoutData(): Promise<ObjectData<Electrocardiogram>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('Electrocardiogram', {
            omitData: true,
            channelId: ECGModel.channelId
        });
    }

    async retrieveWithQueryOptions(
        queryOptions: QueryOptions
    ): Promise<ObjectData<Electrocardiogram>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('Electrocardiogram', {
            ...queryOptions,
            channelId: ECGModel.channelId
        });
    }

    /**
     *
     * @param electrocardiogramHash
     * @returns
     */
    async retrieveElectrocardiogramByHash(
        electrocardiogramHash: SHA256Hash<Electrocardiogram>
    ): Promise<Electrocardiogram> {
        this.state.assertCurrentState('Initialised');

        return await getObject(electrocardiogramHash);
    }

    /**
     * returns iterator for ECGs
     * @param queryOptions
     */
    async *electrocardiogramsIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<Electrocardiogram>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIteratorWithType('Electrocardiogram', {
            ...queryOptions,
            channelId: ECGModel.channelId
        });
    }

    /**
     * Retrieve all the readings from an ECG
     * @param electrocardiogramHash
     * @returns
     */
    async retrieveAllECGReadings(
        electrocardiogramHash: SHA256Hash<Electrocardiogram>
    ): Promise<ElectrocardiogramReadings[]> {
        this.state.assertCurrentState('Initialised');

        const {readings} = await getObject(electrocardiogramHash);
        return readings ? readings : [];
    }

    /**
     * Returns the start timestamp of the last ECG available in the channel or 0 otherwise.
     * @private
     */
    async getLastECGTimestamp(): Promise<number> {
        this.state.assertCurrentState('Initialised');

        let lastECGStartimestamp = 0;
        const ecgs = await this.channelManager.getObjectsWithType('Electrocardiogram', {
            count: 1,
            channelId: ECGModel.channelId
        });

        if (ecgs.length > 0 && ecgs[0].data.startTimestamp) {
            lastECGStartimestamp = ecgs[0].data.startTimestamp;
        }

        return lastECGStartimestamp;
    }

    /**
     * Paginated
     * @param electrocardiogramHash
     * @param _pageSize - DEFAULT = 100
     * @param from - (Returned by this function) use only the returned value of nextFrom field for this parameter
     * @returns
     */
    async retrieveECGReadings(
        electrocardiogramHash: SHA256Hash<Electrocardiogram>,
        from = -1,
        _pageSize = 100
    ): Promise<{readings: ElectrocardiogramReadings[]; nextFrom?: number}> {
        this.state.assertCurrentState('Initialised');

        const ecgReadings: ElectrocardiogramReadings[] = await this.retrieveAllECGReadings(
            electrocardiogramHash
        );

        if (from !== -1) {
            const endIndex = ECGModel.findReadingIndex(ecgReadings, from);

            if (endIndex !== undefined) {
                /** if the value it's negative, make it 0 meaning the start of the array **/
                const startIndex = endIndex - 100 < 0 ? 0 : endIndex - 100;
                return {readings: ecgReadings.slice(startIndex, endIndex), nextFrom: startIndex};
            }
            return {readings: []};
        }
        const endIndex = ecgReadings.length - 1;
        /** if the value it's negative, make it 0 meaning the start of the array **/
        const startIndex = endIndex - 100 < 0 ? 0 : endIndex - 100;
        return {readings: ecgReadings.slice(startIndex, endIndex), nextFrom: startIndex};
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
     * Binary Search since elements in the readings are sorted
     * @param readings
     * @param target
     * @returns
     * @private
     */
    private static findReadingIndex(
        readings: ElectrocardiogramReadings[],
        target: number
    ): number | undefined {
        let startIndex = 0;
        let endIndex = readings.length - 1;
        while (startIndex <= endIndex) {
            const middleIndex = Math.floor((startIndex + endIndex) / 2);
            if (target === readings[middleIndex].timeSinceSampleStart) {
                return middleIndex;
            }
            if (target > readings[middleIndex].timeSinceSampleStart) {
                startIndex = middleIndex + 1;
            }
            if (target < readings[middleIndex].timeSinceSampleStart) {
                endIndex = middleIndex - 1;
            }
        }
        return undefined;
    }

    /**
     *  Handler function for the 'updated' event
     * @param channelInfoIdHash
     * @param channelId
     * @param channelOwner
     * @param timeOfEarliestChange
     * @param data
     */
    private async handleChannelUpdate(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === ECGModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
