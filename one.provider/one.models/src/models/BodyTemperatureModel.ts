import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import type {BodyTemperature as OneBodyTemperature} from '../recipes/BodyTemperatureRecipe.js';
import {Model} from './Model.js';

import type {Person} from '@refinio/one.core/lib/recipes.js';
import {OEvent} from '../misc/OEvent.js';

/**
 * This represents the model of a body temperature measurement
 */
// @TODO the Omit thingy doesn't work as expected... the $type$ property it's still accessible from the outside
export type BodyTemperature = Omit<OneBodyTemperature, '$type$'>;

/**
 * This model implements the possibility of adding a body temperature measurement into a journal and
 * keeping track of the list of the body temperature measurements
 */
export default class BodyTemperatureModel extends Model {
    /**
     * Event is emitted when body temperature data is updated.
     */

    public static readonly channelId = 'bodyTemperature';

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
     * Initialize this instance
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(BodyTemperatureModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleChannelUpdate.bind(this));

        this.state.triggerEvent('init');
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
     * Used to store a body temperature in one instance.
     * @param bodyTemperature - the body temperature measurement provided by the user.
     * @param creationTimestamp - the time in milliseconds when the body temperature was measured.
     * @param owner
     */
    async addBodyTemperature(
        bodyTemperature: number,
        creationTimestamp?: number,
        owner?: SHA256IdHash<Person>
    ): Promise<void> {
        this.state.assertCurrentState('Initialised');

        /** make sure that the supplied body temperature fit the allowed range **/
        if (bodyTemperature < 35 || bodyTemperature > 45) {
            throw Error('Body temperature is out of sensible range (35..45)');
        }

        /** store the body temperature in one **/
        await this.channelManager.postToChannel(
            BodyTemperatureModel.channelId,
            {$type$: 'BodyTemperature', temperature: bodyTemperature},
            owner,
            creationTimestamp
        );
    }

    /**
     * Used to retrieve the body temperatures.
     * Depending on the provided params all the body temperatures are retrieved
     * or just the body temperatures that fit the query parameters.
     * @returns the body temperatures.
     * @param queryParams - used to filter the returned data.
     */
    async getBodyTemperatures(queryParams?: QueryOptions): Promise<ObjectData<BodyTemperature>[]> {
        this.state.assertCurrentState('Initialised');

        /** if the channel id is not specified override it **/
        if (queryParams) {
            if (!queryParams.channelId) {
                queryParams.channelId = BodyTemperatureModel.channelId;
            }
        } else {
            queryParams = {channelId: BodyTemperatureModel.channelId};
        }

        /** get all the body temperatures from one that fit the query parameters **/
        return await this.channelManager.getObjectsWithType('BodyTemperature', queryParams);
    }

    /**
     * returns iterator for BodyTemperature
     * @param queryOptions
     */
    async *bodyTemperaturesIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<OneBodyTemperature>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIteratorWithType('BodyTemperature', {
            ...queryOptions,
            channelId: BodyTemperatureModel.channelId
        });
    }

    /**
     * returns the BodyTemperature with that specific id provided by the ObjectData type
     */
    async bodyTemperatureById(id: string): Promise<ObjectData<OneBodyTemperature>> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectWithTypeById(id, 'BodyTemperature');
    }

    /**
     *  Handler function for the 'updated' event
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
        if (channelId === BodyTemperatureModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
