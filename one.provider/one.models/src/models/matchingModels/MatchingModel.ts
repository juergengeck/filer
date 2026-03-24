import {createAccess} from '@refinio/one.core/lib/access.js';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {
    getObjectByIdHash,
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {OEvent} from '../../misc/OEvent.js';
import type {ChannelInfo} from '../../recipes/ChannelRecipes.js';

import type {Demand, Supply} from '../../recipes/MatchingRecipes.js';
import type {RawChannelEntry} from '../ChannelManager.js';
import type ChannelManager from '../ChannelManager.js';
import {Model} from '../Model.js';

/**
 * This class contains the common behaviour used both by clients and
 * by matching server for communicating using the communication server.
 *
 * @description Matching Model class
 * @augments EventEmitter
 */
export default abstract class MatchingModel extends Model {
    /**
     * Event emitted when matching data is updated.
     */

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    protected channelManager: ChannelManager;
    protected me: SHA256IdHash<Person>;
    public static readonly channelId = 'matching';

    protected suppliesMap = new Map<string, Supply[]>();
    protected demandsMap = new Map<string, Demand[]>();

    protected supplyMapName = 'SupplyMap';
    protected demandMapName = 'DemandMap';

    private disconnect: (() => void) | undefined;

    protected constructor(channelManager: ChannelManager) {
        super();

        this.channelManager = channelManager;
        const me = getInstanceOwnerIdHash();
        if (me === undefined) {
            throw new Error('There is no instance owner.');
        }
        this.me = me;
    }

    /**
     * Will be implemented in each child class.
     */
    abstract init(): Promise<void>;

    protected async startMatchingChannel(): Promise<void> {
        await this.channelManager.createChannel(MatchingModel.channelId);
        this.disconnect = this.channelManager.onUpdated(this.handleUpdate.bind(this));
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
     * For the channels the current instance information had to be known.
     * Only the anonymous information is important, because the channels
     * will be shared between clients and servers and the main identity
     * should never be leaked.
     *
     * @protected
     */
    protected async updateMe(): Promise<void> {
        this.state.assertCurrentState('Initialised');
    }

    /**
     * The channel which holds the corresponding matching objects should be
     * shared between clients and server.
     *
     * @param person
     * @protected
     */
    protected async giveAccessToMatchingChannel(person: SHA256IdHash<Person>[]): Promise<void> {
        this.state.assertCurrentState('Initialised');

        try {
            const setAccessParam = {
                id: await calculateIdHashOfObj({
                    $type$: 'ChannelInfo',
                    id: MatchingModel.channelId,
                    owner: this.me
                }),
                person,
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            };
            // check whether a channel with this id exists
            await getObjectByIdHash(setAccessParam.id);
            // if it exists, set the access rights
            await createAccess([setAccessParam]);

            // TODO: should we give access to matching server to the contacts channel?
            setAccessParam.id = await calculateIdHashOfObj({
                $type$: 'ChannelInfo',
                id: 'contacts',
                owner: this.me
            });
            // check whether a channel with this id exists
            await getObjectByIdHash(setAccessParam.id);
            // if it exists, set the access rights
            await createAccess([setAccessParam]);
        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (error.name !== 'FileNotFoundError') {
                throw error;
            }
        }
    }

    /**
     * Initialise supplies and demands maps.
     *
     * @protected
     */
    protected async initialiseMaps(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        try {
            const supplyMapObj = await getObjectByIdObj({
                $type$: 'SupplyMap',
                name: this.supplyMapName
            });

            if (supplyMapObj.obj.map) {
                this.suppliesMap = supplyMapObj.obj.map;
            }

            const demandMapObj = await getObjectByIdObj({
                $type$: 'DemandMap',
                name: this.demandMapName
            });

            if (demandMapObj.obj.map) {
                this.demandsMap = demandMapObj.obj.map;
            }
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (err.name !== 'FileNotFoundError') {
                throw err;
            }
        }
    }

    /**
     * Memorise the corresponding Supply object if it does not
     * exist in the supplies map.
     *
     * @param supply
     * @protected
     */
    protected addNewValueToSupplyMap(supply: Supply): void {
        this.state.assertCurrentState('Initialised');

        let availableSupplies = this.suppliesMap.get(supply.match);

        if (!availableSupplies) {
            availableSupplies = [];
        }

        if (!MatchingModel.arrayIncludesObject(availableSupplies, supply)) {
            availableSupplies.push(supply);
        }

        this.suppliesMap.set(supply.match, availableSupplies);
    }

    /**
     * Memorise the corresponding Demand object if it does not
     * exist in the supplies map.
     *
     * @param demand
     * @protected
     */
    protected addNewValueToDemandMap(demand: Demand): void {
        this.state.assertCurrentState('Initialised');

        let availableDemands = this.demandsMap.get(demand.match);

        if (!availableDemands) {
            availableDemands = [];
        }

        if (!MatchingModel.arrayIncludesObject(availableDemands, demand)) {
            availableDemands.push(demand);
        }

        this.demandsMap.set(demand.match, availableDemands);
    }

    /**
     * This function gets a supply and search for last version of it
     * in the supply map and replace it with the new version
     *
     * @param newSupply
     */
    protected updateSupplyInSupplyMap(newSupply: Supply) {
        this.state.assertCurrentState('Initialised');

        const availableSupplies = this.suppliesMap.get(newSupply.match);

        if (availableSupplies) {
            const supplyIndex = availableSupplies.findIndex(
                supplyElement => supplyElement.identity === newSupply.identity
            );

            availableSupplies.splice(supplyIndex, 1);
            availableSupplies.push(newSupply);
        }
    }

    /**
     * This function gets a demand and search for last version of it
     * in the demand map and replace it with the new version
     *
     * @param newDemand
     */
    protected updateDemandInDemandMap(newDemand: Demand) {
        this.state.assertCurrentState('Initialised');

        const availableDemands = this.demandsMap.get(newDemand.match);

        if (availableDemands) {
            const demandIndex = availableDemands.findIndex(
                demandElement => demandElement.identity === newDemand.identity
            );

            availableDemands.splice(demandIndex, 1);
            availableDemands.push(newDemand);
        }
    }

    /**
     * This functions memorise the latest version of the SupplyMap.
     *
     * @private
     */
    protected async memoriseLatestVersionOfSupplyMap(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await serializeWithType('SupplyMap', async () => {
            await storeVersionedObject({
                $type$: 'SupplyMap',
                name: this.supplyMapName,
                map: this.suppliesMap
            });
        });
    }

    /**
     * This functions memorise the latest version of the DemandMap.
     * @private
     */
    protected async memoriseLatestVersionOfDemandMap(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        await serializeWithType('DemandMap', async () => {
            await storeVersionedObject({
                $type$: 'DemandMap',
                name: this.demandMapName,
                map: this.demandsMap
            });
        });
    }

    /**
     * This function checks if the received object is here
     * as an update of active status for one of existing objects
     *
     * The logic is next: when a new object is received with same
     * values, but with a different active status, this means this new object
     * was sent to replace the old one, because the 'isActive' attribute was changed
     *
     * @param objectsMap
     * @param tagObject
     * @returns
     */
    protected static checkIfItIsAnUpdate(
        objectsMap: Map<string, (Demand | Supply)[]>,
        tagObject: Supply | Demand
    ): boolean {
        const objectsArray = objectsMap.get(tagObject.match);

        if (objectsArray !== undefined) {
            for (const obj of objectsArray) {
                if (
                    obj.$type$ === tagObject.$type$ &&
                    obj.identity === tagObject.identity &&
                    obj.match === tagObject.match &&
                    obj.isActive !== tagObject.isActive &&
                    obj.timestamp === tagObject.timestamp
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Verify if the Supply or Demand object received as parameter
     * does not exist in the objects array.
     *
     * This function is the corespondent of Array.includes but
     * adapted specially for Supply and Demand objects.
     *
     * @param objectsArray
     * @param object
     * @returns
     * @private
     */
    private static arrayIncludesObject(
        objectsArray: Supply[] | Demand[],
        object: Supply | Demand
    ): boolean {
        for (const obj of objectsArray) {
            if (
                obj.$type$ === object.$type$ &&
                obj.identity === object.identity &&
                obj.match === object.match &&
                obj.isActive === object.isActive &&
                obj.timestamp === object.timestamp
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     *  Handler function for the 'updated' event
     * @param channelInfoIdHash
     * @param channelId
     * @param channelOwner
     * @param timeOfEarliestChange
     * @param data
     */
    private async handleUpdate(
        _channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelId: string,
        _channelOwner: SHA256IdHash<Person> | null,
        timeOfEarliestChange: Date,
        _data: RawChannelEntry[]
    ): Promise<void> {
        if (channelId === MatchingModel.channelId) {
            this.onUpdated.emit(timeOfEarliestChange);
        }
    }
}
