import BlockingQueue from './BlockingQueue.js';

/**
 * A queue implementation where the reader promises block until new data is available.
 */
export default class BlockingPriorityQueue<T> {
    private dataQueue: BlockingQueue<[number, T]>;

    /**
     * Constructs a new priority queue.
     *
     * @param maxDataQueueLength
     * @param maxPendingPromiseCount
     * @param defaultTimeout - Default timeout used for remove() call when no timeout was specified.
     *                         Defaults to Number.POSITIVE_INFINITY.
     */
    constructor(
        maxDataQueueLength = Number.POSITIVE_INFINITY,
        maxPendingPromiseCount = Number.POSITIVE_INFINITY,
        defaultTimeout = Number.POSITIVE_INFINITY
    ) {
        this.dataQueue = new BlockingQueue<[number, T]>(
            maxDataQueueLength,
            maxPendingPromiseCount,
            defaultTimeout
        );
    }

    /**
     * Add data to the queue.
     *
     * This will throw if the queue is full.
     *
     * @param data
     * @param priority - lower values will have higher priority
     */
    public add(data: T, priority: number = 0): void {
        this.dataQueue.insertSorted([priority, data], BlockingPriorityQueue.compareFn);
    }

    /**
     * Get element from queue.
     *
     * If no element is in the queue, then the promise will not resolve, until there is.
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     */
    public async remove(timeout?: number): Promise<T> {
        return (await this.dataQueue.remove(timeout))[1];
    }

    /**
     * Cancels all pending remove promises.
     *
     * @param _err
     */
    public cancelPendingPromises(_err?: Error): void {
        this.dataQueue.cancelPendingPromises();
    }

    /**
     * Clears the queue and returns the internal array.
     */
    public clear(): T[] {
        return this.dataQueue.clear().map(v => v[1]);
    }

    /**
     * Get the number of elements in the queue.
     */
    get length(): number {
        return this.dataQueue.length;
    }

    /**
     * Get the number of pending promises if no elements are in the queue.
     */
    get pendingPromiseCount(): number {
        return this.dataQueue.pendingPromiseCount;
    }

    /**
     * Get a copy of the internal data buffer.
     *
     * Note that the elements themselves are not copied, so if the contents are not native types,
     * do not modify them.
     */
    get data(): T[] {
        return this.dataQueue.data.map(v => v[1]);
    }

    /**
     * Compare function for sorting priorities.
     *
     * @param a
     * @param b
     */
    static compareFn(a: [number, unknown], b: [number, unknown]): number {
        return a[0] - b[0];
    }
}
