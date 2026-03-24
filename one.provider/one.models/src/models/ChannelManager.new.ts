import {registerCrdtAlgorithm} from '@refinio/one.core/lib/crdts/CrdtAlgorithmRegistry.js';
import {calculateHashOfObj, calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {ensureHash, ensureIdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {objectEvents} from '../misc/ObjectEventDispatcher.js';
import {OEvent} from '../misc/OEvent.js';
import type {
    IdAccess,
    OneObjectTypes,
    OneObjectTypeNames,
    Person,
    VersionNode
} from '@refinio/one.core/lib/recipes.js';
import type {LinkedListEntry, ChannelInfo, ChannelRegistry} from '../recipes/ChannelRecipes.js';
import type {Profile} from '../recipes/Leute/Profile.js';
import type {CreationTime} from '../recipes/MetaRecipes.js';
import type {
    OneUnversionedObjectInterfaces,
    OneVersionedObjectInterfaces
} from '@OneObjectInterfaces';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getCurrentVersion,
    getIdObject,
    getObjectByIdHash,
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type LeuteModel from './Leute/LeuteModel.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObject,
    getObjectWithType,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {linkedListInsert} from './LinkedList/insert.js';
import {linkedListIterator} from './LinkedList/iterators.js';
import {LinkedListCrdtAlgorithm} from './LinkedList/LinkedListCrdtAlgorithm.js';

const MessageBus = createMessageBus('ChannelManager');

type OneObjectInterfaces = OneUnversionedObjectInterfaces & OneVersionedObjectInterfaces;

/**
 * Logs a channel manager message.
 *
 * @param channelId
 * @param owner
 * @param message
 */
function logWithId(
    channelId: string | null,
    owner: SHA256IdHash<Person> | undefined | null,
    message: string
) {
    MessageBus.send('log', `${String(channelId)} # ${String(owner)} # ${message}`);
}

/**
 * Logs a channel manager message.
 *
 * @param channelId
 * @param owner
 * @param message
 */
function logWithId_Debug(
    channelId: string | null,
    owner: SHA256IdHash<Person> | undefined | null,
    message: string
) {
    MessageBus.send('debug', `${String(channelId)} # ${String(owner)} # ${message}`);
}

/**
 * This represents a document but not the content,
 */
export type Channel = {
    id: string;
    owner?: SHA256IdHash<Person>;
};

/**
 *  This represents the possible orders of sorting the returned data from the channel.
 */
export enum Order {
    Ascending = 1,
    Descending = 2
}

/**
 * Options used for selecting a specific channel
 *
 * Owners and channelIds must match in order to be returned. So if you specify one owner and one
 * channelId you will get one channel. If you specify two owners and two channelIds you get up
 * to four channels (all combinations of owner / channelId - if a corresponding channel exists)
 *
 * The other stuff is additive, so if you specify one 'channel' and one 'channelInfoHash' you
 * will get two entries.
 *
 * If an element is missing, this means that all of them should be queried.
 */
export type ChannelSelectionOptions = {
    channelId?: string; // Query channels that have this id
    channelIds?: string[]; // Query channels that have one of these ids.
    owner?: SHA256IdHash<Person> | null | 'mainId'; // Query channels that have this owner.
    owners?: (SHA256IdHash<Person> | null | 'mainId')[]; // Query channels that have one of these
    // owners.
    channel?: Channel; // Query this channel
    channels?: Channel[]; // Query these channels

    // Usually you don't need these. Only certain debug features use these or it is used internally
    id?: string; // Exact id of the object to get (you can get it from ObjectData.id)
    ids?: string[]; // Exact ids of the objects to get (you can get it from ObjectData.id)
    channelInfoHash?: SHA256Hash<ChannelInfo>; // Query exactly this channel version
    channelInfoHashes?: SHA256Hash<ChannelInfo>[]; // Query exactly these channel versions
    channelInfoIdHash?: SHA256IdHash<ChannelInfo>; // Query this channel
    channelInfoIdHashes?: SHA256IdHash<ChannelInfo>[]; // Query these channels
};

/**
 * Options used for selecting specific data from channels.
 *
 * All elements are ANDed together.
 */
export type DataSelectionOptions = {
    orderBy?: Order; // Order of the data. Descending is default and is more memory efficient.
    from?: Date; // Query items that happen after this date
    to?: Date; // Query items that happen before this date
    count?: number; // Query this number of items
    id?: string; // Exact id of the object to get (you can get it from ObjectData.id)
    ids?: string[]; // Exact ids of the objects to get (you can get it from ObjectData.id)
    type?: OneObjectTypeNames; // The type of objects you want to receive.
    types?: OneObjectTypeNames[]; // The types of objects you want to receive.
    omitData?: boolean; // omit the data field if set to true
    omitSharedWith?: boolean; // Skip computation of sharedWith entries
};

/**
 * Type defines the query options that can be specified while retrieving data from the channel.
 */
export type QueryOptions = ChannelSelectionOptions & DataSelectionOptions;

/**
 * Type stores the metadata and the data for a query result.
 */
// TODO This is supposed to be "T extends OneObjectTypes = OneObjectTypes",
//  but this needs a few code fixes down the line, since this type is used with all kinds of stuff
export type ObjectData<T = unknown> = {
    channelId: string; // The channel id
    channelOwner?: SHA256IdHash<Person>; // The owner of the channel
    channelEntryHash: SHA256Hash<LinkedListEntry>; // The reference to the channel entry object

    // This id identifies the data point. It can be used to reference this data point in other
    // methods of this class.
    id: string;
    creationTime: Date; // Time when this data point was created
    creationTimeHash: SHA256Hash<CreationTime>;
    author?: SHA256IdHash<Person>; // Author of this data point (currently, this is always the
    // owner)
    sharedWith: SHA256IdHash<Person>[]; // Who has access to this data

    data: T;
    dataHash: SHA256Hash<T extends OneObjectTypes ? T : OneObjectTypes>;
};

/**
 * This type is returned by the raw channel iterator
 */
export type RawChannelEntry = {
    channelInfo: ChannelInfo;
    channelInfoIdHash: SHA256IdHash<ChannelInfo>;
    channelEntryHash: SHA256Hash<LinkedListEntry>;
    creationTimeHash: SHA256Hash<CreationTime>;
    creationTime: number;
    dataHash: SHA256Hash;
    metaDataHashes?: Array<SHA256Hash>;
    author?: SHA256IdHash<Person>;
};

/**
 * This model manages distributed lists of data in so called 'channels'.
 *
 * A channel is a list of objects stored as merkle-tree indexed by time.
 * The list is sorted by creation time so that it can be distributed and merged.
 *
 * Each channel is identified by a channelId (just a string) and the owner.
 * In a distributed network only the owner can create channels.
 * TODO: explain more about access rights and distribution and everything!
 *
 * The structure is as follows:
 * TODO: add PlantUml graph here
 *
 * NOTE: This class manages one global one object called ChannelRegistry
 *       It therefore does not make sense to have multiple ChannelManager objects.
 *       We don't use a singleton, because it makes it harder to track where
 *       channels are used.
 */
export default class ChannelManager {
    // Serialize locks
    private static readonly postLockName = 'ChannelManager_postLock';
    private static readonly postNELockName = 'ChannelManager_postNELock';
    private static readonly cacheLockName = 'ChannelManager_cacheLock_';
    private static readonly registryLockName = 'ChannelManager_registryLock';

    public onUpdated = new OEvent<
        (
            channelInfoIdHash: SHA256IdHash<ChannelInfo>,
            channelId: string,
            channelOwner: SHA256IdHash<Person> | null,
            timeOfEarliestChange: Date,
            data: Array<RawChannelEntry & {isNew: boolean}>
        ) => void
    >();

    private loadedRegistryVersion: SHA256Hash<VersionNode> | undefined = undefined;

    private channelInfoCache: Map<SHA256IdHash<ChannelInfo>, ChannelInfo>;
    private disconnectOnVersionedObjListener: () => void = () => {
        // Empty by design
    };
    private leuteModel: LeuteModel;
    private channelSettings = new Map<
        SHA256IdHash<ChannelInfo>,
        {
            maxSize?: number;
            appendSenderProfile?: boolean;
            registerSenderProfileAtLeute?: boolean;
        }
    >();

    /**
     * The default owner when creating ot posting to a channel.
     *
     * This also changes the default author of posted data.
     *
     * If undefined, your main identity will be used.
     */
    public defaultOwner: SHA256IdHash<Person> | undefined;

    /**
     * Create the channel manager instance.
     */
    constructor(leuteModel: LeuteModel) {
        this.leuteModel = leuteModel;
        this.channelInfoCache = new Map();
    }

    /**
     * Init this instance.
     *
     * This will iterate over all channels and check whether all versions have been merged.
     * If not it will merge the unmerged versions.
     *
     * Note: This has to be called after the one instance is initialized.
     */
    public async init(): Promise<void> {
        registerCrdtAlgorithm(new LinkedListCrdtAlgorithm());

        // Load the cache from the registry
        await this.loadRegistryCacheFromOne();

        // Register event handlers
        this.disconnectOnVersionedObjListener = objectEvents.onNewVersion(
            this.processNewVersion.bind(this),
            'ChannelManager: processNewVersion',
            'ChannelInfo'
        );
    }

    /**
     * Shutdown module
     */
    public async shutdown(): Promise<void> {
        this.disconnectOnVersionedObjListener();
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        this.disconnectOnVersionedObjListener = () => {};
        this.channelInfoCache = new Map();
    }

    // ######## Channel management ########

    /**
     * Create a new channel.
     *
     * If the channel already exists, this call is a noop.
     *
     * @param channelId - The id of the channel. See class description for more details
     * on how ids and channels are handled.
     * @param owner - If the owner is not passed, then your own main identity is used. If the
     * owner is NULL, then no owner is set. If a value is given, then the value will be used as
     * an owner.
     */
    public async createChannel(
        channelId: string,
        owner?: SHA256IdHash<Person> | null
    ): Promise<SHA256IdHash<ChannelInfo>> {
        if (owner === undefined) {
            owner = await this.calculateDefaultOwner();
        }

        if (owner === null) {
            owner = undefined;
        }

        const channelInfoIdHash = await calculateIdHashOfObj({
            $type$: 'ChannelInfo',
            id: channelId,
            owner: owner
        });

        logWithId(channelId, owner, 'createChannel - START');

        try {
            await getObjectByIdHash<ChannelInfo>(channelInfoIdHash);
            logWithId(channelId, owner, 'createChannel - END: Existed');
        } catch (ignore) {
            await storeVersionedObject({
                $type$: 'ChannelInfo',
                id: channelId,
                owner
            });

            // Create the cache entry.
            // We cannot wait for the hook to make the entry, because following posts
            // might be faster than the hook, so let's add the channel explicitly to
            // the registry
            await this.addChannelIfNotExist(channelInfoIdHash);

            logWithId(channelId, owner, 'createChannel - END: Created');
        }

        return channelInfoIdHash;
    }

    /**
     * Retrieve all channels registered at the channel registry
     *
     * @param options
     * @returns
     */
    public async channels(options?: ChannelSelectionOptions): Promise<Channel[]> {
        const channelInfos = await this.getMatchingChannelInfos(options);
        return channelInfos.map(info => {
            return {id: info.id, owner: info.owner};
        });
    }

    /**
     * Check if passed channel exists.
     *
     * @param channelId
     * @param owner
     */
    public async hasChannel(channelId: string, owner: SHA256IdHash<Person>): Promise<boolean> {
        return (await this.channels({channelId, owner})).length > 0;
    }

    /**
     * Enable appending the default profile of the sender to each channel entry.
     *
     * Default is disabled
     *
     * @param channel
     * @param enable
     */
    public setChannelSettingsAppendSenderProfile(
        channel: SHA256IdHash<ChannelInfo>,
        enable?: boolean
    ): void {
        const currentSettings = this.channelSettings.get(channel);
        if (currentSettings) {
            if (enable === undefined) {
                delete currentSettings.appendSenderProfile;
            } else {
                currentSettings.appendSenderProfile = enable;
            }
        } else if (enable !== undefined) {
            this.channelSettings.set(channel, {
                appendSenderProfile: enable
            });
        }
    }

    /**
     * Get the "AppendSenderProfile" setting for the specified channel.
     *
     * @param channel
     */
    public getChannelSettingsAppendSenderProfile(channel: SHA256IdHash<ChannelInfo>): boolean {
        const currentSettings = this.channelSettings.get(channel);
        if (currentSettings === undefined || currentSettings.appendSenderProfile === undefined) {
            return false;
        }

        return currentSettings.appendSenderProfile;
    }

    /**
     * Enable registering as metadata attached profiles with leute.
     *
     * Default is disabled
     *
     * @param channel
     * @param enable
     */
    public setChannelSettingsRegisterSenderProfileAtLeute(
        channel: SHA256IdHash<ChannelInfo>,
        enable?: boolean
    ): void {
        const currentSettings = this.channelSettings.get(channel);
        if (currentSettings) {
            if (enable === undefined) {
                delete currentSettings.registerSenderProfileAtLeute;
            } else {
                currentSettings.registerSenderProfileAtLeute = enable;
            }
        } else if (enable !== undefined) {
            this.channelSettings.set(channel, {
                registerSenderProfileAtLeute: enable
            });
        }
    }

    /**
     * Get the "RegisterSenderProfileAtLeute" setting for the specified channel.
     *
     * @param channel
     */
    public getChannelSettingsRegisterSenderProfileAtLeute(
        channel: SHA256IdHash<ChannelInfo>
    ): boolean {
        const currentSettings = this.channelSettings.get(channel);
        if (
            currentSettings === undefined ||
            currentSettings.registerSenderProfileAtLeute === undefined
        ) {
            return false;
        }

        return currentSettings.registerSenderProfileAtLeute;
    }

    /**
     * If size is specified, then restrict the size of a channel to this amount.
     *
     * Excess data is deleted by the merge algorithms.
     *
     * @param channel
     * @param maxSize
     */
    public setChannelSettingsMaxSize(channel: SHA256IdHash<ChannelInfo>, maxSize?: number): void {
        if (maxSize !== undefined && maxSize < 0) {
            throw new Error('Max size must not be negative');
        }

        const currentSettings = this.channelSettings.get(channel);
        if (currentSettings) {
            if (maxSize === undefined) {
                delete currentSettings.maxSize;
            } else {
                currentSettings.maxSize = maxSize;
            }
        } else if (maxSize !== undefined) {
            this.channelSettings.set(channel, {
                maxSize
            });
        }
    }

    /**
     * Get the "maxSize" setting for the specified channel.
     *
     * @param channel
     */
    public getChannelSettingsMaxSize(channel: SHA256IdHash<ChannelInfo>): number | undefined {
        const currentSettings = this.channelSettings.get(channel);
        if (currentSettings === undefined || currentSettings.maxSize === undefined) {
            return undefined;
        }

        return currentSettings.maxSize;
    }

    // ######## Put data into the channel ########

    /**
     * Post a new object to a channel.
     *
     * @param channelId - The id of the channel to post to
     * @param data - The object to post to the channel
     * @param channelOwner - If the owner is not passed, then your own main identity is used.
     * If the
     * owner is NULL, then no owner is set. If a value is given, then the value will be used as
     * an owner.
     * @param timestamp
     * @param author
     */
    public async postToChannel<T extends OneObjectTypes>(
        channelId: string,
        data: T,
        channelOwner?: SHA256IdHash<Person> | null,
        timestamp?: number,
        author?: SHA256IdHash<Person>
    ): Promise<void> {
        // Determine the owner to use for posting.
        // The owner can be the passed one, or the default one if none was passed.
        // It is no owner if null is passed.
        let owner: SHA256IdHash<Person> | undefined;
        const myMainId = await this.calculateDefaultOwner();

        if (channelOwner === null) {
            owner = undefined;
        } else {
            owner = channelOwner;
        }

        if (channelOwner === undefined) {
            owner = myMainId;
        }

        if (author === undefined) {
            author = myMainId;
        }

        const channelInfoIdHash = await calculateIdHashOfObj({
            $type$: 'ChannelInfo',
            id: channelId,
            owner: owner
        });

        // Setup the merge handler
        const cacheEntry = this.channelInfoCache.get(channelInfoIdHash);
        if (!cacheEntry) {
            throw new Error('This channel does not exist, you cannot post to it.');
        }

        // Post the data
        try {
            await serializeWithType(ChannelManager.postLockName, async () => {
                logWithId(channelId, owner, 'postToChannel - START');
                await this.internalChannelPost(channelId, owner, data, author, timestamp);
                logWithId(channelId, owner, 'postToChannel - END');
            });
        } catch (e) {
            logWithId(channelId, owner, `postToChannel - FAIL: ${String(e)}`);
            throw e;
        }
    }

    /**
     * Post a new object to a channel but only if it was not already posted to the channel
     *
     * Note: This will iterate over the whole tree if the object does not exist, so it might
     *       be slow.
     *
     * @param channelId - The id of the channel to post to
     * @param data - The object to post to the channel
     * @param channelOwner - If the owner it's not passed, then the {@link this.defaultOwner} is
     * set. If the owner it's NULL, then no owner is set. If a value is given, then the value
     * will be used as an owner.
     */
    public async postToChannelIfNotExist<T extends OneObjectTypes>(
        channelId: string,
        data: T,
        channelOwner?: SHA256IdHash<Person> | null
    ): Promise<void> {
        // Determine the owner to use for posting.
        // The owner can be the passed one, or the default one if none was passed.
        // It is no owner if null is passed.
        let owner: SHA256IdHash<Person> | undefined;

        if (channelOwner === null) {
            owner = undefined;
        } else {
            owner = channelOwner;
        }

        if (channelOwner === undefined) {
            owner = await this.calculateDefaultOwner();
        }

        try {
            // We need to serialize here, because two posts of the same item must be serialized
            // in order for the second one to wait until the first one was inserted.
            await serializeWithType(ChannelManager.postNELockName, async () => {
                logWithId(channelId, owner, 'postToChannelIfNotExist - START');

                // Calculate the hash of the passed object. We will compare it with existing entries
                const dataHash = await calculateHashOfObj(data);

                // Iterate over the channel to see whether the object exists.
                let exists = false;
                for await (const item of this.objectIterator({channelId, owner})) {
                    if (item.dataHash === dataHash) {
                        exists = true;
                    }
                }

                // Post only if it does not exist
                if (exists) {
                    logWithId(channelId, owner, 'postToChannelIfNotExist - END: existed');
                } else {
                    await this.postToChannel(channelId, data, owner);
                    logWithId(channelId, owner, 'postToChannelIfNotExist - END: posted');
                }
            });
        } catch (e) {
            logWithId(channelId, owner, `postToChannelIfNotExist - FAIL: ${String(e)}`);
            throw e;
        }
    }

    // ######## Get data from channels - Array based ########

    /**
     * Get all data from one or multiple channels.
     *
     * Note the behavior when using ascending ordering (default) and count.
     * It will return the 'count' latest elements in ascending order, not the
     * 'count' oldest elements. It is counter intuitive and should either
     * be fixed or the iterator interface should be the mandatory
     *
     * @param queryOptions
     */
    public async getObjects(queryOptions?: QueryOptions): Promise<ObjectData<OneObjectTypes>[]> {
        // Use iterator interface to collect all objects
        const objects: ObjectData<OneObjectTypes>[] = [];
        for await (const obj of this.objectIterator(queryOptions)) {
            objects.push(obj);
        }

        // Decide, whether to return it reversed, or not
        if (queryOptions && queryOptions.orderBy === Order.Descending) {
            return objects;
        } else {
            return objects.reverse();
        }
    }

    /**
     * Get all data from a channel.
     *
     * @param type - Type of objects to retrieve. If type does not match the object is skipped.
     * @param queryOptions
     */
    public async getObjectsWithType<T extends OneObjectTypeNames>(
        type: T,
        queryOptions?: QueryOptions
    ): Promise<ObjectData<OneObjectInterfaces[T]>[]> {
        // Use iterator interface to collect all objects
        const objects: ObjectData<OneObjectInterfaces[T]>[] = [];

        for await (const obj of this.objectIteratorWithType(type, queryOptions)) {
            objects.push(obj);
        }

        // Decide, whether to return it reversed, or not
        if (queryOptions && queryOptions.orderBy === Order.Descending) {
            return objects;
        } else {
            return objects.reverse();
        }
    }

    /**
     * Obtain a specific object from a channel.
     *
     * @param id - id of the object to extract
     */
    public async getObjectById(id: string): Promise<ObjectData<OneObjectTypes>> {
        const obj = (await this.objectIterator({id}).next()).value;
        if (!obj) {
            throw new Error('The referenced object does not exist');
        }
        return obj;
    }

    /**
     * Obtain a specific object from a channel.
     *
     * This is a very inefficient implementation, because it iterates over the chain.
     * In the future it would be better to just pick the object with the passed hash.
     * But this only works when we have working reverse maps for getting the metadata.
     * The other option would be to use the hash of the indexed metadata as id, then
     * we don't have the reverse map problem.
     *
     * @param id - id of the object to extract
     * @param type - Type of objects to retrieve. If type does not match an
     *               error is thrown.
     * @returns
     */
    public async getObjectWithTypeById<T extends OneObjectTypeNames>(
        id: string,
        type: T
    ): Promise<ObjectData<OneObjectInterfaces[T]>> {
        function hasRequestedType(
            obj: ObjectData<OneObjectTypes>
        ): obj is ObjectData<OneObjectInterfaces[T]> {
            return obj.data.$type$ === type;
        }

        const obj = (await this.objectIterator({id}).next()).value;
        if (!obj) {
            throw new Error('The referenced object does not exist');
        }
        if (!hasRequestedType(obj)) {
            throw new Error(`The referenced object does not have the expected type ${type}`);
        }

        return obj;
    }

    // ######## Get data from channels - ITERATORS ########

    /**
     * Iterate over all objects in the channels matching the query options.
     *
     * Note that the sort order is not supported. It is silently ignored.
     * Items are always returned in descending order regarding time.
     * It is a single linked list underneath, so no way of efficiently iterating
     * in the other direction.
     *
     * @param queryOptions
     * @returns
     */
    public async *objectIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<OneObjectTypes>> {
        // The count needs to be dealt with at the top level, because it involves all returned items
        if (queryOptions && queryOptions.count) {
            let elementCounter = 0;

            // Iterate over the merge iterator and filter unwanted elements
            for await (const element of this.multiChannelObjectIterator(queryOptions)) {
                if (queryOptions.count !== undefined && elementCounter >= queryOptions.count) {
                    break;
                }

                ++elementCounter;
                yield element;
            }
        } else {
            yield* this.multiChannelObjectIterator(queryOptions);
        }
    }

    /**
     * Iterate over all objects in the channels matching the query options.
     *
     * This method also returns only the objects of a certain type.
     *
     * @param type - The type of the elements to iterate
     * @param queryOptions
     * @returns
     */
    public async *objectIteratorWithType<T extends OneObjectTypeNames>(
        type: T,
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<OneObjectInterfaces[T]>> {
        if (queryOptions) {
            queryOptions.type = type;
        } else {
            queryOptions = {type};
        }

        // Iterate over all objects filtering out the ones with the wrong type
        yield* this.objectIterator(queryOptions) as AsyncIterableIterator<
            ObjectData<OneObjectInterfaces[T]>
        >;
    }

    /**
     * Find the differences in the chain starting from the common history
     *
     * Note: this only works when both channel infos are from the same channel.
     *
     * @param nextChannel
     * @param currentChannel
     */
    public static async *differencesIteratorMostCurrent(
        nextChannel: SHA256Hash<ChannelInfo>,
        currentChannel: SHA256Hash<ChannelInfo>
    ): AsyncIterableIterator<RawChannelEntry> {
        const channelInfoNext = await getObject(nextChannel);
        const channelInfoCurrent = await getObject(currentChannel);
        const itNext = ChannelManager.singleChannelObjectIterator(channelInfoNext);
        const itCurrent = ChannelManager.singleChannelObjectIterator(channelInfoCurrent);

        if (!channelInfoNext.head) {
            yield* itCurrent;
        } else if (channelInfoCurrent.head === undefined) {
            yield* itNext;
        } else {
            yield* ChannelManager.mergeIteratorMostCurrent([itNext, itCurrent], true, false, true);
        }
    }

    // ######## Get data from channels - ITERATORS PRIVATE ########

    /**
     * Iterate over all objects in the channels selected by the passed ChannelSelectionOptions.
     *
     * @param queryOptions
     * @returns
     */
    private async *multiChannelObjectIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<OneObjectTypes>> {
        const channels = await this.getMatchingChannelInfos(queryOptions);

        // prepare the options for the single channel iterator
        let from: Date | undefined;
        let to: Date | undefined;
        let ids: string[] | undefined;
        let types: string[] | undefined;

        let omitData: boolean = false;
        let omitSharedWith: boolean = true;

        if (queryOptions) {
            from = queryOptions.from;
            to = queryOptions.to;
            if (queryOptions.id) {
                ids = [queryOptions.id];
            }
            if (queryOptions.ids) {
                ids = queryOptions.ids;
            }
            if (queryOptions.type) {
                types = [queryOptions.type];
            }
            if (queryOptions.types) {
                types = queryOptions.types;
            }
            if (queryOptions.omitData) {
                omitData = queryOptions.omitData;
            }
            if (queryOptions.omitSharedWith) {
                omitSharedWith = queryOptions.omitSharedWith;
            }
        }

        // Create a iterator for each selected channel
        const iterators = channels.map(channel =>
            ChannelManager.singleChannelObjectIterator(channel, from, to, ids, true)
        );

        // Determine the access rights of each channel
        const sharedWithPersonsMap = new Map<SHA256IdHash<ChannelInfo>, SHA256IdHash<Person>[]>();
        if (!omitSharedWith) {
            await Promise.all(
                channels.map(async channel => {
                    const channelInfoIdHash = await calculateIdHashOfObj(channel);
                    const sharedWithPersons =
                        await ChannelManager.sharedWithPersonsList(channelInfoIdHash);
                    sharedWithPersonsMap.set(channelInfoIdHash, sharedWithPersons);
                })
            );
        }

        // Iterate over all channels and fetch the data
        for await (const entry of ChannelManager.mergeIteratorMostCurrent(iterators, false)) {
            const result = await this.convertRawChannelEntryToObjectData(
                entry,
                sharedWithPersonsMap,
                omitData
            );

            if (result.data && types && !types.includes(result.data.$type$)) {
                continue;
            }

            yield result;
        }
    }

    /**
     * Converts the raw represantation to ObjectData<T> representation.
     *
     * @param entry
     * @param sharedWithPersonsMap
     * @param omitData
     */
    async convertRawChannelEntryToObjectData(
        entry: RawChannelEntry,
        sharedWithPersonsMap: Map<SHA256IdHash<ChannelInfo>, SHA256IdHash<Person>[]>,
        omitData: boolean
    ): Promise<ObjectData<OneObjectTypes>> {
        // Get the shared with status from the precompiled map
        const sharedWith = sharedWithPersonsMap.get(entry.channelInfoIdHash) || [];

        // Load the object to compare the type
        // AUTHORIZED HACK - casting undefined to any type because
        // making the data field optional would cause problems
        // in other apps.
        const data = omitData ? (undefined as any) : await getObject(entry.dataHash);

        // Build meta data object and return it
        return {
            channelId: entry.channelInfo.id,
            channelOwner: entry.channelInfo.owner,
            channelEntryHash: entry.channelEntryHash,
            id: ChannelManager.encodeEntryId(entry.channelInfoIdHash, entry.channelEntryHash),

            creationTime: new Date(entry.creationTime),
            creationTimeHash: entry.creationTimeHash,
            author: entry.author,
            sharedWith: sharedWith,

            data: data,
            dataHash: entry.dataHash
        };
    }

    /**
     * This iterator just iterates the data elements of the passed channel.
     *
     * Note: If you want to start iterating from a specific point in the chain
     * and not from the start, you can just construct your own ChannelInfo object
     * and set the head to the ChannelEntry where you want to start iterating.
     *
     * @param channelInfo - iterate this channel
     * @param from
     * @param to
     * @param ids
     * @param loadAuthor
     * @returns
     */
    public static async *singleChannelObjectIterator(
        channelInfo: ChannelInfo,
        from?: Date,
        to?: Date,
        ids?: string[],
        loadAuthor?: boolean
    ): AsyncIterableIterator<RawChannelEntry> {
        logWithId(channelInfo.id, channelInfo.owner, 'singleChannelObjectIterator - ENTER');

        // Select the item or entry iterator based on whether ids were passed
        if (ids) {
            yield* this.itemIterator(channelInfo, ids, from, to, loadAuthor);
        } else {
            yield* this.entryIterator(channelInfo, from, to, loadAuthor);
        }

        logWithId(
            channelInfo.id,
            channelInfo.owner,
            'singleChannelObjectIterator - LEAVE: exhausted entries'
        );
    }

    /**
     * This iterator just iterates the data elements of the passed channel.
     *
     * Note: If you want to start iterating from a specific point in the chain
     * and not from the start, you can just construct your own ChannelInfo object
     * and set the head to the ChannelEntry where you want to start iterating.
     *
     * @param channelInfo - iterate this channel
     * @param from
     * @param to
     * @param loadAuthor
     * @returns
     */
    private static async *entryIterator(
        channelInfo: ChannelInfo,
        from?: Date,
        to?: Date,
        loadAuthor?: boolean
    ): AsyncIterableIterator<RawChannelEntry> {
        logWithId(channelInfo.id, channelInfo.owner, 'entryIterator - ENTER');
        if (!channelInfo.head) {
            logWithId(channelInfo.id, channelInfo.owner, 'entryIterator - LEAVE: no entries');
            return;
        }
        const channelInfoIdHash = await calculateIdHashOfObj(channelInfo);

        // Iterate over all elements and yield each element
        for await (const entry of linkedListIterator(channelInfo.head)) {
            const currentEntryHash = entry.linkedListEntryHash;

            logWithId_Debug(
                channelInfo.id,
                channelInfo.owner,
                `entryIterator: iterate ${entry.linkedListEntryHash}`
            );

            // Filter elements based on from / to
            if (from && entry.creationTime < from.getTime()) {
                break;
            }

            if (to && entry.creationTime > to.getTime()) {
                continue;
            }

            let author: SHA256IdHash<Person> | undefined;
            if (loadAuthor && entry.metaDataHashes !== undefined) {
                for (const metaHash of entry.metaDataHashes) {
                    const metaObject = await getObject(metaHash);
                    if (metaObject.$type$ === 'Signature') {
                        const certObject = await getObject(metaObject.data);

                        if (certObject.$type$ === 'AffirmationCertificate') {
                            author = metaObject.issuer;
                            break;
                        }
                    }
                }
            }

            yield {
                channelInfo: channelInfo,
                channelInfoIdHash: channelInfoIdHash,
                channelEntryHash: currentEntryHash,
                creationTimeHash: entry.creationTimeHash,
                creationTime: entry.creationTime,
                dataHash: entry.dataHash,
                metaDataHashes: entry.metaDataHashes,
                author
            };
        }

        logWithId(channelInfo.id, channelInfo.owner, 'entryIterator - LEAVE: exhausted entries');
    }

    /**
     * This iterator just iterates over the elements with the passed ids.
     *
     * @param channelInfo
     * @param ids
     * @param from
     * @param to
     * @param loadAuthor
     * @returns
     */
    private static async *itemIterator(
        channelInfo: ChannelInfo,
        ids: string[],
        from?: Date,
        to?: Date,
        loadAuthor?: boolean
    ): AsyncIterableIterator<RawChannelEntry> {
        logWithId(channelInfo.id, channelInfo.owner, 'itemIterator - ENTER');

        // Calculate the id hash
        const channelInfoIdHash = await calculateIdHashOfObj(channelInfo);

        // Extract the items for which we have the id
        const entries = [];
        for (const id of ids) {
            const entryData = ChannelManager.decodeEntryId(id);
            if (entryData.channelInfoIdHash !== channelInfoIdHash) {
                continue;
            }

            const entry: LinkedListEntry = await getObject(entryData.channelEntryHash);
            const creationTimeHash = entry.data;
            const creationTime = await getObject(creationTimeHash);

            if (to && creationTime.timestamp > to.getTime()) {
                continue;
            }

            if (from && creationTime.timestamp < from.getTime()) {
                continue;
            }

            let author: SHA256IdHash<Person> | undefined;
            if (loadAuthor && entry.metadata !== undefined) {
                for (const metaHash of entry.metadata) {
                    const metaObject = await getObject(metaHash);
                    if (metaObject.$type$ === 'Signature') {
                        const certObject = await getObject(metaObject.data);

                        if (certObject.$type$ === 'AffirmationCertificate') {
                            author = metaObject.issuer;
                            break;
                        }
                    }
                }
            }

            entries.push({
                channelInfo: channelInfo,
                channelInfoIdHash: channelInfoIdHash,
                channelEntryHash: entryData.channelEntryHash,
                creationTimeHash: creationTimeHash,
                creationTime: creationTime.timestamp,
                dataHash: creationTime.data,
                author
            });
        }

        // Sort the items
        entries.sort((a, b) => b.creationTime - a.creationTime);

        // yield the items
        yield* entries;

        logWithId(channelInfo.id, channelInfo.owner, 'itemIterator - LEAVE: exhausted entries');
    }

    /**
     * Iterate multiple iterators by returning always the most current element of all of them.
     *
     * It is assumed, that the iterators will return the elements sorted from highest to
     * lowest value.
     *
     * Example:
     *
     * If you have multiple iterators (iter1, iter2, iter3) that would return these items:
     * - iter1: 9, 5, 3
     * - iter2: 8, 7, 6, 1
     * - iter3: 4, 2
     *
     * Then this iterator implementation would return the items with these creation times:
     * 9, 8, 7, 6, 5, 4, 3, 2, 1
     *
     * When two or more iterators reach the same history, then the first iterator in the iterator
     * list will continue iterating. The other iterators will stop. This is relevant if one
     * iterator is faster than the other (because one iterator iterates over cached values
     * instead of one objects -> e.g. an element cache in ui elements.)
     *
     * @param  iterators
     * @param terminateOnSingleIterator - If true, then stop iteration when all but
     * one iterator reached their end. The first element of the last iterator is still returned,
     * but then iteration stops. This is very useful for merging algorithms, because they can
     * use the last item as common history for merging. Because this iteration also removes
     * redundant iterators (that iterate over the same history) it will stop when multiple
     * iterators iterate the same history.
     * @param yieldCommonHistoryElement - If true (default) the common history element
     * will be yielded as last element
     * @param onlyDifferentElements - If true (default false) only elements that are only in a
     * single channel are yielded.
     * @returns the RawChannelEntry, iterIndex (the index of the iterator in the iterators
     * array that yielded this RawChannelEntry), activeIteratorCount (number of iterators that
     * were active when this element was yielded)
     */
    public static async *mergeIteratorMostCurrent(
        iterators: AsyncIterableIterator<RawChannelEntry>[],
        terminateOnSingleIterator: boolean = false,
        yieldCommonHistoryElement: boolean = true,
        onlyDifferentElements: boolean = false
    ): AsyncIterableIterator<RawChannelEntry & {iterIndex: number; activeIteratorCount: number}> {
        logWithId(null, null, `mergeIteratorMostCurrent - ENTER: ${iterators.length} iterators`);

        // This array holds the topmost value of each iterator
        // The position of the element in this array matches the position in the iterators array.
        // Those values are then compared and the one with the highest
        // timestamp is returned and then replaced by the next one on each iteration
        const currentValues: (RawChannelEntry | undefined)[] = [];
        let previousItem: RawChannelEntry | undefined = undefined;

        // Initial fill of the currentValues iterator with the most current elements of each iterator
        for (const iterator of iterators) {
            currentValues.push((await iterator.next()).value);
        }

        // Iterate over all (output) items
        // The number of the iterations will be the sum of all items returned by all iterators.
        // For the above example it would be 9 iterations.
        while (true) {
            // determine the largest element in currentValues
            let mostCurrentItem: RawChannelEntry | undefined = undefined;
            let mostCurrentIndex: number = 0;
            let activeIteratorCount: number = 0;

            for (let i = 0; i < currentValues.length; i++) {
                const currentValue = currentValues[i];

                // Ignore values from iterators that have reached their end (returned undefined)
                if (currentValue === undefined) {
                    continue;
                } else {
                    ++activeIteratorCount;
                }

                // This checks whether we have an element to compare to (so i is at least 1)
                if (mostCurrentItem) {
                    // Skip elements that are older (less current)
                    if (currentValue.creationTime < mostCurrentItem.creationTime) {
                        continue;
                    }

                    // If the timestamp is equal, then sort by time hash to have a predictable order
                    if (
                        currentValue.creationTime === mostCurrentItem.creationTime &&
                        currentValue.creationTimeHash < mostCurrentItem.creationTimeHash
                    ) {
                        continue;
                    }

                    // Ignore elements with the same history (same channel id and same entry =>
                    // history is the same)
                    // This is mostly required if we mergeIterate multiple versions of the same
                    // channel. The merge algorithm uses this.
                    if (
                        currentValue.creationTime === mostCurrentItem.creationTime &&
                        currentValue.channelEntryHash === mostCurrentItem.channelEntryHash &&
                        currentValue.channelInfoIdHash === mostCurrentItem.channelInfoIdHash
                    ) {
                        // This removes the current element from the currentValues list
                        // Thus the corresponding iterator will never be advanced again, so
                        // we effectively removed the duplicate history from the iteration
                        currentValues[i] = undefined;
                        --activeIteratorCount;
                        continue;
                    }
                }

                // If we made it to here, then we have a larger element - remember it
                mostCurrentItem = currentValues[i];
                mostCurrentIndex = i;
            }

            // If no element was found, this means that all iterators reached their ends =>
            // terminate the loop
            if (mostCurrentItem === undefined) {
                break;
            }

            // For only different elements option we call next for all equal elements and if we
            // have the same elements multiple times we don't yield.
            if (onlyDifferentElements) {
                // Same get the indices of the currentValues that are equal to the most current
                // element
                const sameIndices: number[] = [];
                for (let i = 0; i < currentValues.length; i++) {
                    const currentValue = currentValues[i];

                    // Ignore values from iterators that have reached their end (returned undefined)
                    if (currentValue === undefined) {
                        continue;
                    }

                    if (
                        currentValue.creationTimeHash === mostCurrentItem.creationTimeHash &&
                        currentValue.channelInfoIdHash === mostCurrentItem.channelInfoIdHash
                    ) {
                        sameIndices.push(i);
                    }
                }

                // Advance all equal element iterators
                for (const index of sameIndices) {
                    currentValues[index] = (await iterators[index].next()).value;
                }

                // If we don't advanced all iterators, then it is a difference, because one channel
                // is missing this element.
                if (sameIndices.length === iterators.length) {
                    continue;
                }
            } else {
                // Advance the iterator that yielded the highest creationTime
                currentValues[mostCurrentIndex] = (await iterators[mostCurrentIndex].next()).value;
            }

            // If we have one active iterator remaining and the user requested it, we terminate
            // This is done before the yield, because we want the first element of the remaining
            // iterator not to be returned.
            if (
                terminateOnSingleIterator &&
                !yieldCommonHistoryElement &&
                activeIteratorCount === 1
            ) {
                break;
            }

            // Filter for duplicates
            if (
                previousItem &&
                previousItem.creationTime === mostCurrentItem.creationTime &&
                previousItem.creationTimeHash === mostCurrentItem.creationTimeHash &&
                previousItem.channelInfoIdHash === mostCurrentItem.channelInfoIdHash
            ) {
                logWithId_Debug(
                    null,
                    null,
                    `mergeIteratorMostCurrent: skipped value from iterator ${mostCurrentIndex}: duplicate with previous`
                );
            } else {
                logWithId_Debug(
                    null,
                    null,
                    `mergeIteratorMostCurrent: picked value from iterator ${mostCurrentIndex}`
                );

                // Yield the value that has the highest creationTime
                yield {
                    ...mostCurrentItem,
                    iterIndex: mostCurrentIndex,
                    activeIteratorCount
                };

                // If we have one active iterator remaining and the user requested it, we terminate
                // This is done after the yield, because we want the first element of the remaining
                // iterator to be returned.
                if (
                    terminateOnSingleIterator &&
                    yieldCommonHistoryElement &&
                    activeIteratorCount === 1
                ) {
                    break;
                }
            }

            previousItem = mostCurrentItem;
        }

        logWithId(null, null, 'mergeIteratorMostCurrent - LEAVE');
    }

    // ######## Entry id and channel selection stuff ########

    /**
     * Encodes an entry as string for referencing and loading it later.
     *
     * @param channelInfoIdHash
     * @param channelEntryHash
     * @returns
     */
    private static encodeEntryId(
        channelInfoIdHash: SHA256IdHash<ChannelInfo>,
        channelEntryHash: SHA256Hash<LinkedListEntry>
    ): string {
        return `${channelInfoIdHash}_${channelEntryHash}`;
    }

    /**
     * Decodes the string identifying an entry.
     *
     * @param id
     * @returns
     */
    private static decodeEntryId(id: string): {
        channelInfoIdHash: SHA256IdHash<ChannelInfo>;
        channelEntryHash: SHA256Hash<LinkedListEntry>;
    } {
        const idElements = id.split('_');
        if (idElements.length !== 2) {
            throw new Error('Id of channel entry is not valid.');
        }
        return {
            channelInfoIdHash: ensureIdHash<ChannelInfo>(idElements[0]),
            channelEntryHash: ensureHash<LinkedListEntry>(idElements[1])
        };
    }

    /**
     * This returns the list of matching channel infos based on ChannelSelectionOptions.
     *
     * It usually returns the channel infos of the latest merged versions, not the latest
     * version in the version maps. Only if the ChannelSelectionOptions reference a specific
     * version this version is returned instead of the latest merged one.
     * @param options
     * @returns
     */
    public async getMatchingChannelInfos(
        options?: ChannelSelectionOptions
    ): Promise<ChannelInfo[]> {
        logWithId(null, null, `getMatchingChannelInfos - START: ${JSON.stringify(options)}`);

        // #### Check parameters ####

        if (options && options.channelId && options.channelIds) {
            throw new Error(
                "You cannot specify 'channelId' and 'channelIds' at the same time in query options!"
            );
        }
        if (options && options.owner !== undefined && options.owners) {
            throw new Error(
                "You cannot specify 'owner' and 'owners' at the same time in query options!"
            );
        }
        if (options && options.channel && options.channels) {
            throw new Error(
                "You cannot specify 'channel' and 'channels' at the same time in query options!"
            );
        }
        if (options && options.id && options.ids) {
            throw new Error("You cannot specify 'id' and 'ids' at the same time in query options!");
        }
        if (options && options.channelInfoHash && options.channelInfoHashes) {
            throw new Error(
                "You cannot specify 'channelInfoHash' and 'channelInfoHashes' at the same time in query options!"
            );
        }
        if (options && options.channelInfoIdHash && options.channelInfoIdHashes) {
            throw new Error(
                "You cannot specify 'channelInfoHash' and 'channelInfoHashes' at the same time in query options!"
            );
        }

        // #### Map parameters ####

        // Map options.channelId(s) to a single variable
        let channelIds: string[] | null = null;
        if (options && options.channelId) {
            channelIds = [options.channelId];
        }
        if (options && options.channelIds) {
            channelIds = options.channelIds;
        }

        // Map options.owner(s) to a single variable
        let owners: (SHA256IdHash<Person> | null)[] | null = null;
        if (options && options.owner !== undefined) {
            if (options.owner === 'mainId') {
                owners = [await this.leuteModel.myMainIdentity()];
            } else {
                owners = [options.owner];
            }
        }
        if (options && options.owners) {
            owners = [];
            for (const owner of options.owners) {
                if (owner === 'mainId') {
                    owners.push(await this.leuteModel.myMainIdentity());
                } else {
                    owners.push(owner);
                }
            }
        }

        // Map options.channel(s) to a single variable
        let channels: Channel[] | null = null;
        if (options && options.channel) {
            channels = [options.channel];
        }
        if (options && options.channels) {
            channels = options.channels;
        }

        // Map options.id(s) to a single variable
        let ids: string[] | null = null;
        if (options && options.id) {
            ids = [options.id];
        }
        if (options && options.ids) {
            ids = options.ids;
        }

        // Map options.channelInfoHash(es) to a single variable
        let channelInfoHashes: SHA256Hash<ChannelInfo>[] | null = null;
        if (options && options.channelInfoHash) {
            channelInfoHashes = [options.channelInfoHash];
        }
        if (options && options.channelInfoHashes) {
            channelInfoHashes = options.channelInfoHashes;
        }

        // Map options.channelInfoIdHash(es) to a single variable
        let channelInfoIdHashes: SHA256IdHash<ChannelInfo>[] | null = null;
        if (options && options.channelInfoIdHash) {
            channelInfoIdHashes = [options.channelInfoIdHash];
        }
        if (options && options.channelInfoIdHashes) {
            channelInfoIdHashes = options.channelInfoIdHashes;
        }

        // #### Get channel ids / infos from parameters ####

        // Variables will be filled with all channels that need to be selected
        // At the end the id hashes will also be appended to the ChannelInfos
        const selectedChannelInfos: ChannelInfo[] = [];
        const selectedChannelIdHashes: SHA256IdHash<ChannelInfo>[] = [];

        // Channel selection based on user / channel id
        // It is an AND relation, so both criteria have to match in order for the channel to
        // be selected
        if (owners || channelIds) {
            for (const channelInfo of this.channelInfoCache.values()) {
                if (channelIds && !channelIds.includes(channelInfo.id)) {
                    continue;
                }

                if (
                    owners &&
                    !owners.includes(channelInfo.owner === undefined ? null : channelInfo.owner)
                ) {
                    continue;
                }

                selectedChannelInfos.push(channelInfo);
            }
        }

        // Channel selection by Channel object
        // Calculate the id hashes of the matching channels
        if (channels) {
            const idHashes = await Promise.all(
                channels.map(channel =>
                    calculateIdHashOfObj({
                        $type$: 'ChannelInfo',
                        id: channel.id,
                        owner: channel.owner
                    })
                )
            );
            selectedChannelIdHashes.push(...idHashes);
        }

        // Channel selection by explicit versions
        // Get the ChannelInfo objects from the instance and add them to the list.
        if (channelInfoHashes) {
            selectedChannelInfos.push(
                ...(await Promise.all(
                    channelInfoHashes.map(channelInfoHash => getObject(channelInfoHash))
                ))
            );
        }

        // Channel selection by the id hash
        if (channelInfoIdHashes) {
            selectedChannelIdHashes.push(...channelInfoIdHashes);
        }

        // Channel selection by specific object id
        if (ids) {
            selectedChannelIdHashes.push(
                ...ids.map(id => ChannelManager.decodeEntryId(id).channelInfoIdHash)
            );
        }

        // If no selection was done, then return all of them
        if (
            !channelIds &&
            !owners &&
            !channels &&
            !channelInfoHashes &&
            !channelInfoIdHashes &&
            !ids
        ) {
            for (const channelInfo of this.channelInfoCache.values()) {
                selectedChannelInfos.push(channelInfo);
            }
        }

        // #### Channel Id to latest merged version conversion ####

        // For the selection methods that just returned channel ids we need to get the latest
        // merged versions
        if (selectedChannelIdHashes) {
            for (const channelInfoIdHash of selectedChannelIdHashes) {
                const channelInfo = this.channelInfoCache.get(channelInfoIdHash);

                if (!channelInfo) {
                    throw new Error(`Channel ${channelInfoIdHash} does not exist!`);
                }

                selectedChannelInfos.push(channelInfo);
            }
        }

        // Remove duplicates. Since these are pointers to the objects in the cache
        // the unification works based on the addresses of the ChannelInfo instance in the cache.
        const uniqueSelection = Array.from(new Set(selectedChannelInfos));

        logWithId(
            null,
            null,
            `getMatchingChannelInfos - End: selected ${uniqueSelection.length} channels/versions`
        );

        // loads head if possible
        return Promise.all(
            uniqueSelection.map(async channelInfo => {
                const channelInfoIdHash = await calculateIdHashOfObj(channelInfo);
                
                MessageBus.send(
                    'debug',
                    `[CHANNEL] Verifying channel info for query - id: ${channelInfo.id}, owner: ${channelInfo.owner || 'null'}, hash: ${channelInfoIdHash}`
                );
                
                try {
                    // Always get the latest version from storage to ensure we have the correct head
                    const latestVersion = await getCurrentVersion(channelInfoIdHash);
                    
                    if (channelInfo.head !== latestVersion.head) {
                        MessageBus.send(
                            'debug',
                            `[CHANNEL] Head mismatch detected - id: ${channelInfo.id}, cached head: ${channelInfo.head || 'null'}, stored head: ${latestVersion.head || 'null'}`
                        );
                        
                        // Update cache with correct head
                        this.channelInfoCache.set(channelInfoIdHash, latestVersion);
                        
                        return latestVersion;
                    }
                    
                    return {
                        ...channelInfo,
                        head: channelInfo.head || latestVersion.head
                    };
                } catch (error) {
                    MessageBus.send(
                        'debug',
                        `[CHANNEL] Error refreshing channel info - id: ${channelInfo.id}, error: ${String(error)}`
                    );
                    
                    // Fallback to original info with head check
                    return {
                        ...channelInfo,
                        head: channelInfo.head
                    };
                }
            })
        );
    }

    // ######## Hook implementation for merging and adding channels ########

    /**
     * Handler function for the VersionedObj
     * @param caughtObject
     */
    private async processNewVersion(
        caughtObject: VersionedObjectResult<ChannelInfo>
    ): Promise<void> {
        try {
            MessageBus.send(
                'log',
                `processNewVersion ${caughtObject.idHash} - new version ${caughtObject.hash}`
            );

            await this.addChannelIfNotExist(caughtObject.idHash);

            const emitEvents = await serializeWithType(
                `ChannelManager.processNewVersion ${caughtObject.idHash}`,
                async () => {
                    const newChannelInfo = caughtObject.obj;
                    const oldChannelInfo = this.channelInfoCache.get(caughtObject.idHash);
                    this.channelInfoCache.set(caughtObject.idHash, newChannelInfo);

                    MessageBus.send(
                        'log',
                        `processNewVersion ${caughtObject.idHash} - new head: ${newChannelInfo.head}, old head: ${oldChannelInfo?.head}`
                    );

                    const changedElements: Array<RawChannelEntry & {isNew: boolean}> = [];

                    if (oldChannelInfo === undefined || oldChannelInfo.head === undefined) {
                        for await (const elem of ChannelManager.entryIterator(newChannelInfo)) {
                            changedElements.push({...elem, isNew: true});
                        }
                    } else {
                        for await (const elem of ChannelManager.mergeIteratorMostCurrent(
                            [
                                ChannelManager.entryIterator(oldChannelInfo),
                                ChannelManager.entryIterator(newChannelInfo)
                            ],
                            false,
                            false
                        )) {
                            changedElements.push({...elem, isNew: elem.iterIndex !== 0});
                        }
                    }

                    // Register profile at leute by creating a version history.
                    for (const entry of changedElements) {
                        if (
                            !this.getChannelSettingsRegisterSenderProfileAtLeute(
                                entry.channelInfoIdHash
                            )
                        ) {
                            continue;
                        }

                        if (!entry.isNew) {
                            continue;
                        }

                        const myId = await this.leuteModel.myMainIdentity();

                        if (entry.metaDataHashes) {
                            for (const metaDataHash of entry.metaDataHashes) {
                                const metadataObj = await getObject(metaDataHash);

                                if (metadataObj.$type$ === 'Profile') {
                                    const newProfile: Profile = {
                                        ...metadataObj,
                                        owner: myId,
                                        profileId: `ChannelAttachedProfile ${entry.channelInfoIdHash} ${entry.channelInfo.id}`
                                    };

                                    try {
                                        const current = await getObjectByIdObj(newProfile);
                                        newProfile.$versionHash$ = current.obj.$versionHash$;
                                    } catch (_e) {
                                        // Empty, because this means that no version exists, yet
                                    }

                                    await storeVersionedObject(newProfile);
                                }
                            }
                        }
                    }

                    MessageBus.send(
                        'debug',
                        `processNewVersion ${caughtObject.idHash} - found ${changedElements.length} new elements`
                    );

                    if (changedElements.length > 0) {
                        return () => {
                            this.onUpdated.emit(
                                caughtObject.idHash,
                                newChannelInfo.id,
                                newChannelInfo.owner || null,
                                new Date(changedElements[changedElements.length - 1].creationTime),
                                changedElements
                            );
                        };
                    } else {
                        return () => {
                            // No emits necessary
                        };
                    }
                }
            );

            emitEvents();
        } catch (e) {
            console.error(e); // Introduce an error event later!
        }
    }

    /**
     * Add the passed channel to the cache & registry if it is not there, yet.
     *
     * @param channelInfoIdHash - the channel to add to the registry
     */
    private async addChannelIfNotExist(
        channelInfoIdHash: SHA256IdHash<ChannelInfo>
    ): Promise<void> {
        // Determine the channel id and owner
        let channelId: string;
        let channelOwner: SHA256IdHash<Person> | undefined;
        {
            const channelInfo = await getIdObject(channelInfoIdHash);
            channelId = channelInfo.id;
            channelOwner = channelInfo.owner;
        }

        try {
            await serializeWithType(
                `${ChannelManager.cacheLockName}${channelInfoIdHash}`,
                async () => {
                    logWithId(channelId, channelOwner, 'addChannelIfNotExist - START');
                    if (this.channelInfoCache.has(channelInfoIdHash)) {
                        logWithId(
                            channelId,
                            channelOwner,
                            'addChannelIfNotExist - END: already existed'
                        );
                    } else {
                        this.channelInfoCache.set(
                            channelInfoIdHash,
                            await getCurrentVersion(channelInfoIdHash)
                        );
                        await this.saveRegistryCacheToOne();
                        logWithId(channelId, channelOwner, 'addChannelIfNotExist - END: added');
                    }
                }
            );
        } catch (e) {
            logWithId(channelId, channelOwner, `addChannelIfNotExist - FAIL: ${String(e)}`);
            throw e;
        }
    }

    // ######## One Channel registry read / write methods ########

    /**
     * Save the cache content as new version of registry in one.
     */
    private async saveRegistryCacheToOne(): Promise<void> {
        await serializeWithType(ChannelManager.registryLockName, async () => {
            // Write the registry version
            this.loadedRegistryVersion = (
                await storeVersionedObject({
                    $type$: 'ChannelRegistry',
                    id: 'ChannelRegistry',
                    $versionHash$: this.loadedRegistryVersion,
                    channels: new Set(this.channelInfoCache.keys())
                })
            ).obj.$versionHash$;
        });
    }

    /**
     * Load the latest channel registry version into the the cache.
     */
    private async loadRegistryCacheFromOne(): Promise<void> {
        logWithId(null, null, 'loadRegistryCacheFromOne - START');
        await serializeWithType(ChannelManager.registryLockName, async () => {
            // If the cache is not empty, then something is wrong.
            // The current implementation only needs to populate it once - at init and there it
            // should be empty.
            if (this.channelInfoCache.size > 0) {
                throw new Error('Populating the registry cache is only allowed if it is empty!');
            }

            // Get the registry. If it does not exist, start with an empty cache (so just return)
            let registry: ChannelRegistry;
            try {
                registry = (
                    await getObjectByIdObj({$type$: 'ChannelRegistry', id: 'ChannelRegistry'})
                ).obj;
            } catch (_) {
                return;
            }

            // We load the latest merged version for all channels
            // Warning: this might be very memory hungry, because we load this stuff in parallel,
            // so potentially all version maps of all channels are in memory simultaneously.
            // This issue should be fixed by allowing partial version loads or by changing the
            // way that version maps work - or by not using version maps at all.
            // Short term fix might be by serializing all the loads, but this will significantly
            // increase load time - so let's stick with the parallel version for now.
            await Promise.all(
                [...registry.channels].map(async channelIdHash => {
                    try {
                        const channelInfoResult = await getCurrentVersion(channelIdHash);
                        this.channelInfoCache.set(channelIdHash, channelInfoResult);
                    } catch (_e) {
                        // This means that there is no version - should not happen. The empty
                        // channel is also a version
                    }
                })
            );

            this.loadedRegistryVersion = registry.$versionHash$;
        });
        logWithId(null, null, 'loadRegistryCacheFromOne - END');
    }

    // ######## Access stuff ########

    /**
     * Get the person list with whom this channel is shared.
     *
     * This list also explodes the access groups and adds those persons to the returned list.
     *
     * @param channelInfoIdHash
     * @returns
     */
    private static async sharedWithPersonsList(
        channelInfoIdHash: SHA256IdHash<ChannelInfo>
    ): Promise<SHA256IdHash<Person>[]> {
        /**
         * Get the persons from the groups and persons of the passed access object.
         *
         * @param accessHash
         * @returns
         */
        async function extractPersonsFromIdAccessObject(accessHash: SHA256Hash<IdAccess>) {
            const accessObject = await getObjectWithType(accessHash, 'IdAccess');
            let allSharedPersons: SHA256IdHash<Person>[] = [];
            if (accessObject.group.length > 0) {
                const groupPersons = await Promise.all(
                    accessObject.group.map(async groupId => {
                        const groupObject = await getObjectByIdHash(groupId);
                        return groupObject.obj.person;
                    })
                );
                allSharedPersons = allSharedPersons.concat(
                    groupPersons.reduce((acc, val) => acc.concat(val), [])
                );
            }

            if (accessObject.person.length > 0) {
                allSharedPersons = allSharedPersons.concat(accessObject.person);
            }
            return allSharedPersons;
        }

        // Extract the access objects pointing to the channel info
        const channelAccessObjects = await getAllEntries(channelInfoIdHash, 'IdAccess');
        const personNested = await Promise.all(
            channelAccessObjects.map(async value => extractPersonsFromIdAccessObject(value))
        );
        const personsFlat = personNested.reduce((acc, val) => acc.concat(val), []);

        // Remove duplicate persons and return the result
        return [...new Set(personsFlat)];
    }

    /**
     * This places the new elements on top of the old head thus extending the linked list.
     *
     * @param oldHead
     * @param newElementsReversed
     */
    private static async rebuildEntries(
        oldHead: SHA256Hash<LinkedListEntry>,
        newElementsReversed: RawChannelEntry[]
    ): Promise<UnversionedObjectResult<LinkedListEntry>> {
        // Create the new channel entries linked list from the array elements
        let lastChannelEntry = oldHead;
        let newEntryResult;
        for (let i = newElementsReversed.length - 1; i >= 0; --i) {
            newEntryResult = await storeUnversionedObject({
                $type$: 'LinkedListEntry',
                data: newElementsReversed[i].creationTimeHash,
                metadata: newElementsReversed[i].metaDataHashes,
                previous: lastChannelEntry
            });
            lastChannelEntry = newEntryResult.hash;
        }

        // If newEntryResult is undefined this means, that the newElementsReserved list was empty
        // Usually we could just return the oldHead, but we need an UnversionedObjectResult from
        // a SHA256Hash<ChannelEntry> and I have no clue how to get it, so throw.
        if (!newEntryResult) {
            throw new Error('It does not make sense to rebuild a channel with 0 elements.');
        }

        // Create the new channel version
        return newEntryResult;
    }

    /**
     * Post a new entry in a channel.
     *
     * This creates a new channel entry with the current time as creation time and
     * inserts it to the channel.
     *
     * Attention: This is an impure plan, because it always generates a new element
     *            with a new creation time even if the payload was posted before
     *
     * @param channelId - The channel to post to
     * @param channelOwner - Owner of the channel to post to
     * @param payload - Payload of the post
     * @param author - Author of chat message
     * @param timestamp - Timestamp that is used as creation time
     * @returns
     */
    private async internalChannelPost(
        channelId: string,
        channelOwner: SHA256IdHash<Person> | undefined,
        payload: OneObjectTypes,
        author?: SHA256IdHash<Person>,
        timestamp?: number
    ): Promise<VersionedObjectResult<ChannelInfo>> {
        // Load latest ChannelInfo
        const channelInfoIdHash = await calculateIdHashOfObj({
            $type$: 'ChannelInfo',
            id: channelId,
            owner: channelOwner
        });
        const latestChannelInfo = (await getObjectByIdHash<ChannelInfo>(channelInfoIdHash)).obj;

        // Insert new element into linked list
        const newHeadHash = await linkedListInsert(
            latestChannelInfo.head,
            payload,
            async creationTimeResult => {
                // Collect metadata that shall be included
                const metadata: SHA256Hash[] = [];
                if (author !== undefined) {
                    metadata.push(
                        (await this.leuteModel.trust.affirm(creationTimeResult.hash, author)).hash
                    );

                    if (this.getChannelSettingsAppendSenderProfile(channelInfoIdHash)) {
                        const profiles = await (await this.leuteModel.me()).profiles(author);
                        const defaultProfile = profiles.filter(
                            profile =>
                                profile.profileId === 'default' &&
                                profile.owner === author &&
                                profile.personId === author
                        );
                        if (
                            defaultProfile.length > 0 &&
                            defaultProfile[0].loadedVersion !== undefined
                        ) {
                            metadata.push(defaultProfile[0].loadedVersion);
                        }
                    }
                }
                return metadata;
            },
            timestamp
        );

        // processNewVersion is triggered automatically by the listener for new objects
        // registered in init()

        // Write the channel info with the new channel entry as head
        const newChannelInfo = await storeVersionedObject({
            $type$: 'ChannelInfo',
            $versionHash$: latestChannelInfo.$versionHash$,
            id: channelId,
            owner: channelOwner,
            head: newHeadHash
        });

        // Verify the cache has the correct head pointer
        const cachedInfo = this.channelInfoCache.get(channelInfoIdHash);
        if (!cachedInfo || cachedInfo.head !== newChannelInfo.obj.head) {
            MessageBus.send('debug', `[CHANNEL] Cache verification failed - channel: ${channelId}, expected head: ${newChannelInfo.obj.head}, cached head: ${cachedInfo?.head || 'null'}`);
            // Force update the cache
            this.channelInfoCache.set(channelInfoIdHash, newChannelInfo.obj);
            MessageBus.send('debug', `[CHANNEL] Cache forcibly updated with correct head pointer - channel: ${channelId}`);
        }

        return newChannelInfo;
    }

    /**
     * Returns the default author if set manually or my main identity if unset.
     */
    async calculateDefaultOwner(): Promise<SHA256IdHash<Person>> {
        if (this.defaultOwner !== undefined) {
            return this.defaultOwner;
        }

        return this.leuteModel.myMainIdentity();
    }
}
