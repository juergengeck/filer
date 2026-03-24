/**
 * This class caches iterator values until the cache is marked out of date.
 *
 * This is very useful if the iteration is expensive and you know when new values have arrived.
 */
export class IteratorValueCache<T> {
    private readonly createIterator: () => AsyncIterableIterator<T>;
    private readonly cache: Set<T>;
    private readonly incrementalUpdates: boolean;
    private isOutOfDate: boolean;

    /**
     * Construct a new cache.
     *
     * @param createIterator - This callback creates a new iterator that is used to fill the cache.
     * @param incrementalUpdates - This is an optimization that will update the cache by
     * appending new values at the end of the cache. The prerequisites for activating this feature
     * are:
     * - In a complete iteration of a new iterator all values need to be unique. The iterator is
     * not allowed to return the same element twice.
     * - New elements must appear at the beginning of the iteration and the previous elements
     * need to stay the same.
     * This way the iteration can stop as soon as an element, that is already in the cache, is
     * encountered.
     */
    constructor(createIterator: () => AsyncIterableIterator<T>, incrementalUpdates = false) {
        this.createIterator = createIterator;
        this.cache = new Set();
        this.incrementalUpdates = incrementalUpdates;
        this.isOutOfDate = true;
    }

    /**
     * Marks the cache out of date, so that the next getValues call will update it.
     */
    public markAsOutOfDate() {
        this.isOutOfDate = true;
    }

    /**
     * Get the cached values.
     *
     * Updates the cache if the cache values are out of date.
     *
     * @returns
     */
    async getValues(): Promise<T[]> {
        if (!this.isOutOfDate) {
            return [...this.cache];
        }
        this.isOutOfDate = false;

        if (this.incrementalUpdates) {
            for await (const data of this.createIterator()) {
                if (this.incrementalUpdates && this.cache.has(data)) {
                    break;
                }
                this.cache.add(data);
            }
        } else {
            this.cache.clear();
            for await (const data of this.createIterator()) {
                this.cache.add(data);
            }
        }

        return [...this.cache];
    }
}
