import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {Demand, Supply} from '../../recipes/MatchingRecipes.js';
import type ChannelManager from '../ChannelManager.js';
import ClientMatchingModel from './ClientMatchingModel.js';
import MatchingModel from './MatchingModel.js';

export default class ServerUserModel extends ClientMatchingModel {
    constructor(channelManager: ChannelManager) {
        super(channelManager);
    }

    /**
     * Returns all existing tags, saved, but with all
     * information about them (match value, active status, and many more)
     * in case this information is required.
     *
     * @returns
     */
    getAllAvailableTagsObjects(): Array<Supply | Demand> {
        this.state.assertCurrentState('Initialised');

        const allobjects: (Supply | Demand)[] = [];

        this.demandsMap.forEach(allDemands => {
            allDemands.forEach(demand => {
                allobjects.push(demand);
            });
        });

        this.suppliesMap.forEach(allSupplies => {
            allSupplies.forEach(supply => {
                allobjects.push(supply);
            });
        });

        return [...new Set(allobjects)];
    }

    /**
     * This function is changing the status of a category,
     * more exactly, if this function is called for a tag, that tag will be
     * active or inactive for all user who ever sent this tag
     *
     * @param supplyMatch
     */
    async changeSupplyCategoryStatus(supplyMatch: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        // get all supplies
        const supplyArray = this.suppliesMap.get(supplyMatch);

        // check if there is a Supply object with the given match
        if (!supplyArray) {
            return;
        }

        await serializeWithType('Supply', async () => {
            // change the status for all existing supplies
            for (const supply of supplyArray) {
                // save new supply, but with 'isActive' status up to date
                const newSupply = (await storeUnversionedObject({
                    $type$: 'Supply',
                    identity: supply.identity,
                    match: supplyMatch,
                    isActive: !supply.isActive,
                    timestamp: supply.timestamp
                })) as UnversionedObjectResult<Supply>;

                // delete the old version of the Supply object
                this.suppliesMap.delete(supply.match);

                // remember the new version of the Supply object
                this.addNewValueToSupplyMap(newSupply.obj);
                await this.memoriseLatestVersionOfSupplyMap();

                await this.channelManager.postToChannel(MatchingModel.channelId, newSupply.obj);
            }
        });
    }

    /**
     * This function is changing the status of a category,
     * more exactly, if this function is called for a tag, that tag will be
     * active or inactive for all user who ever sent this tag
     *
     * @param demandMatch - demand value
     */
    async changeDemandCategoryStatus(demandMatch: string): Promise<void> {
        this.state.assertCurrentState('Initialised');

        // get all supplies
        const demandArray = this.demandsMap.get(demandMatch);

        // check if there is a Supply object with the given match
        if (!demandArray) {
            return;
        }

        await serializeWithType('Supply', async () => {
            // change the status for all existing supplies
            for (const demand of demandArray) {
                // save new supply, but with 'isActive' status up to date
                const newDemand = (await storeUnversionedObject({
                    $type$: 'Demand',
                    identity: demand.identity,
                    match: demandMatch,
                    isActive: !demand.isActive,
                    timestamp: demand.timestamp
                })) as UnversionedObjectResult<Demand>;

                // delete the old version of the Supply object
                this.demandsMap.delete(demand.match);

                // remember the new version of the Supply object
                this.addNewValueToDemandMap(newDemand.obj);
                await this.memoriseLatestVersionOfSupplyMap();

                await this.channelManager.postToChannel(MatchingModel.channelId, newDemand.obj);
            }
        });
    }
}
