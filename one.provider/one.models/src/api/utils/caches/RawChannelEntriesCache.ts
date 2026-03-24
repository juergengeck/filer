import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import {OEvent} from '../../../misc/OEvent.js';
import ChannelManager from '../../../models/ChannelManager.js';
import type {RawChannelEntry} from '../../../models/ChannelManager.js';
import type {ChannelInfo} from '../../../recipes/ChannelRecipes.js';

/**
 * This is a cache for aching raw channel elements
 *
 * When calling init() only number of 'batchSize' elements are loaded. Loading further elements is done when calling
 * loadNextBatch.
 *
 * Updating the cache happens for two reasons:
 * 1) we want to grab more elements (loadNextBatch) -> load next batchSize elements.
 * - use the previously stored iterator
 * 2) the history changed and we want to update oly messages before the last loaded element -> time parameter
 * - iterate the new iterator up to a point where the history matches with the cache
 * - iterate the remaining elements from the cache (faster - because the same)
 */
export default class RawChannelEntriesCache {
    public onUpdate = new OEvent<(newMessages: boolean) => void>();
    public onError = new OEvent<(error: any) => void>();

    private isInitialized = false;
    private readonly channelManager: ChannelManager;
    private readonly channelId: string;
    private readonly owner: SHA256IdHash<Person> | undefined;
    private readonly batchSize: number;
    private cache: RawChannelEntry[] = [];
    private lastIterator: AsyncIterableIterator<RawChannelEntry> | null = null;
    private disconnectListener: () => void = () => {};

    /**
     * Constructor
     *
     * @param channelManager - The channelmanager used to access the channel.
     * @param channelId - The channelId of the channel to iterate.
     * @param owner - The owner of the channel to iterate.
     * @param batchSize - The number of messages to load as one batch. Load the next batch with loadNextBatch().
     */
    constructor(
        channelManager: ChannelManager,
        channelId: string,
        owner: SHA256IdHash<Person> | undefined,
        batchSize: number
    ) {
        this.channelManager = channelManager;
        this.channelId = channelId;
        this.owner = owner;
        this.batchSize = batchSize;
    }

    /**
     * Initialize the instance.
     */
    public init() {
        this.isInitialized = true;
        this.disconnectListener = this.channelManager.onUpdated(
            (_channelInfoIdHash: SHA256IdHash<ChannelInfo>, channelId: string) => {
                console.log('channelId', channelId);
                if (channelId !== this.channelId) {
                    return;
                }

                console.log('updateCache');
                this.updateCache();
            }
        );

        this.updateCache();
    }

    /**
     * Cleanup the instance.
     */
    public shutdown() {
        this.isInitialized = false;
        this.disconnectListener();
        this.disconnectListener = () => {};
        this.lastIterator = null;
        this.cache = [];
    }

    /**
     * Loads the next batch of messages.
     */
    public loadNextBatch(): void {
        this.assertInitialized();
        console.log('loadNextBatch');

        serializeWithType('RawChannelEntriesCache', async () => {
            // Initialize iterator if not yet done
            let iter;
            let firstLoad = false;
            if (this.lastIterator === null) {
                const newIter = await this.createNewChannelIterator();
                if (newIter === undefined) {
                    return;
                }
                iter = newIter;
                this.lastIterator = iter;
                firstLoad = true;
            } else {
                iter = this.lastIterator;
            }

            // Iterate for batch size more elements
            let messageCount = 0;
            let elem = await iter.next();

            // If the iterator had no elements, we need to set it to null, so that a new iterator is grabbed on the
            // next attempt. Otherwise this empty iterator would be reused that would yield nothing.
            if (elem.done === true && firstLoad) {
                this.lastIterator = null;
            }

            // Iterate and put the elements at the end of the cache.
            // We stop iterating when batchSize elements have been loaded.
            // Note that we cannot use for ... of loop, because then we could not reuse the iterator for the next batch.
            while (elem.done !== true) {
                console.log('loadNextBatch - push');
                this.cache.push(elem.value);
                ++messageCount;
                if (messageCount >= this.batchSize) {
                    break;
                }
                elem = await iter.next();
            }

            if (messageCount > 0) {
                this.onUpdate.emit(firstLoad);
            }

            console.log('loadNextBatch - done');
        }).catch(e => this.onError.emit(e));
    }

    /**
     * Get the cached entries synchronously.
     */
    public cachedEntries(): RawChannelEntry[] {
        this.assertInitialized();
        return [...this.cache].reverse();
    }

    /**
     * Create a new raw iterator for the channel of the selected chat.
     *
     * @private
     */
    private async createNewChannelIterator(): Promise<
        AsyncIterableIterator<RawChannelEntry> | undefined
    > {
        const infos: ChannelInfo[] = await this.channelManager.getMatchingChannelInfos({
            channelId: this.channelId,
            owner: this.owner
        });
        if (infos.length > 1) {
            this.onError.emit(
                new Error(
                    'Programming Error: Number of returned channels is >1, this should not happen.'
                )
            );
            return;
        }
        if (infos.length === 0) {
            return;
        }
        return ChannelManager.singleChannelObjectIterator(infos[0]);
    }

    /**
     * Updates the cache.
     *
     * There are several things that can happen that makes an update necessary:
     * - A new message was received at the end
     * - A message was inserted (old message received)
     *
     * The goal of this update function is to load as little objects as possible. So how does it do it? It iterates the
     * new elements and the old elements at the same time in the order of the time stamps. The new version always
     * contains all the old elements, so at as long as both versions have a different history only the elements from the
     * new iterator is picked. When the common history element is found the old list is iterated (which is in memory).
     */
    private updateCache() {
        // If cache length is 0, then we need a complete reload
        if (this.cache.length === 0) {
            this.loadNextBatch();
            return;
        }

        serializeWithType('RawChannelEntriesCache', async () => {
            // We need a new iterator for the changed history
            const newIterator = await this.createNewChannelIterator();
            if (newIterator === undefined) {
                return;
            }

            // This is a iterator of the current cache
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const self = this;
            // eslint-disable-next-line @typescript-eslint/require-await
            const oldIterator: AsyncIterableIterator<RawChannelEntry> = (async function* () {
                yield* self.cache.values();
            })();

            // #### Build the raw channel entries cache ####

            // This iteration has thwo phases:
            // 1) iterate the new iterator up to a point where the history matches with the cache
            // 2) iterate the remaining elements from the cache (faster - because the same)

            const newCache: RawChannelEntry[] = [];
            let newLatestMessage: boolean | null = null;
            for await (const elem of ChannelManager.mergeIteratorMostCurrent([
                oldIterator,
                newIterator
            ])) {
                // If the first message is from the second iterator, then we know that we received a new messages at the
                // end of the chat.
                if (newLatestMessage === null) {
                    newLatestMessage = elem.iterIndex === 1;
                }

                // For the case that the history has changed so far back that all currently loaded elements have
                // changed, we need to assure that we do not load elements older that the oldest element of the previous
                // version. If we do not check, the iterator would continue iterating all elements of the new version,
                // because the single iterator left would be the new one, not the old one.
                if (elem.creationTime < this.cache[this.cache.length - 1].creationTime) {
                    break;
                }

                if (elem.activeIteratorCount === 2) {
                    // Phase 1: as long as both iterators are active we pick all elements from the new iteratot (it also
                    //          contains all the old elements, but with a different entryHash.
                    if (elem.iterIndex === 1) {
                        newCache.push(elem);
                    }
                } else {
                    // When only one iterator is left, then we just pick all elements from that iterator.
                    newCache.push(elem);
                }
            }

            this.cache = newCache;
            this.onUpdate.emit(newLatestMessage === null ? false : newLatestMessage);
        }).catch(e => this.onError.emit(e));
    }

    private assertInitialized() {
        if (!this.isInitialized) {
            throw new Error(
                'RawChannelEntriesCache: You cannot use any method of this class, because it is already shut down.'
            );
        }
    }
}
