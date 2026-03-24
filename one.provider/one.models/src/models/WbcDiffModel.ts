import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from '../recipes/ChannelRecipes.js';
import type ChannelManager from './ChannelManager.js';
import type {ObjectData, QueryOptions, RawChannelEntry} from './ChannelManager.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {Model} from './Model.js';

import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {WbcObservation} from '../recipes/WbcDiffRecipes.js';
import {OEvent} from '../misc/OEvent.js';

const MessageBus = createMessageBus('WbcDiffModel');

/**
 * This model implements methods related to differential blood counts of white blood cells.
 */
export default class WbcDiffModel extends Model {
    channelManager: ChannelManager;
    public static readonly channelId = 'wbc';

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
     *
     * This must be done after the one instance was initialized.
     */
    async init(): Promise<void> {
        this.state.assertCurrentState('Uninitialised');

        await this.channelManager.createChannel(WbcDiffModel.channelId);
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

    /**
     * Create a new response for a questionnaire.
     *
     * @param wbcObservation - The answers for the questionnaire
     * @param owner
     */
    async postObservation(
        wbcObservation: WbcObservation,
        owner?: SHA256IdHash<Person>
    ): Promise<void> {
        this.state.assertCurrentState('Initialised');

        MessageBus.send('log', 'postMeasurement()');

        // Verify number format of *Count fields
        const numberRegex = /^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$/;

        let property: keyof WbcObservation;
        for (property in wbcObservation) {
            if (property !== 'acquisitionTime' && property !== '$type$') {
                const wbcMeasurement = wbcObservation[property];
                if (wbcMeasurement !== undefined) {
                    const stringNumber = wbcMeasurement.value;
                    if (!numberRegex.test(stringNumber)) {
                        throw new Error(
                            `${stringNumber} of ${property} is not a valid Number format`
                        );
                    }
                }
            }
        }

        // post wbc measurement to channel
        await this.channelManager.postToChannel(WbcDiffModel.channelId, wbcObservation, owner);
    }

    /**
     * returns all WbcObservations from the channel
     */
    async observations(): Promise<ObjectData<WbcObservation>[]> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectsWithType('WbcObservation', {
            channelId: WbcDiffModel.channelId
        });
    }

    /**
     * returns iterator for observations
     * @param queryOptions
     */
    async *observationsIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<WbcObservation>> {
        this.state.assertCurrentState('Initialised');

        yield* this.channelManager.objectIteratorWithType('WbcObservation', {
            ...queryOptions,
            channelId: WbcDiffModel.channelId
        });
    }

    /**
     * returns the WbcObservation with that specific id provided by the ObjectData type
     */
    async observationById(id: string): Promise<ObjectData<WbcObservation>> {
        this.state.assertCurrentState('Initialised');

        return await this.channelManager.getObjectWithTypeById(id, 'WbcObservation');
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
        if (channelId === WbcDiffModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
