/**
 * @author Sebastian Șandru <sebastian@refinio.net>
 */

import type {ObjectData, QueryOptions} from './ChannelManager.js';
import {OEvent} from '../misc/OEvent.js';
import {Model} from './Model.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';

export type JournalEntry = {
    type: string;
    data: ObjectData<unknown>;
};

type JournalInput = {
    event: OEvent<(timeOfEarliestChange: Date) => void>;
    retrieveFn: (
        queryOptions?: QueryOptions
    ) => AsyncIterableIterator<ObjectData<unknown> | Promise<ObjectData<unknown>>>;
    eventType: string;
    isInitialized: () => boolean;
    createChannel?: (channelId: string, owner?: SHA256IdHash<Person> | null) => Promise<void>;
    channelId?: string;
};

type JournalData = {
    [event: string]: {
        values: ObjectData<unknown>[];
        index: number;
    };
};

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export default class JournalModel extends Model {
    private readonly modelsDictionary: JournalInput[];
    private static readonly JOURNAL_LOCK = 'JournalModel_lock';

    private oEventListeners: Map<
        string,
        {
            disconnect: (() => void) | undefined;
            listener: (timeOfEarliestChange: Date) => void;
        }
    > = new Map();

    // @Override base class event
    public onUpdated: OEvent<(timeOfEarliestChange: Date) => void> = new OEvent<
        (timeOfEarliestChange: Date) => void
    >();

    constructor(modelsInput: JournalInput[]) {
        super();
        this.modelsDictionary = modelsInput;
    }

    /**
     * Initialize the journal model by waiting for all input models to be initialized
     * and setting up event handlers.
     */
    async init() {
        this.state.assertCurrentState('Uninitialised');

        // Wait for all input models to be initialized using their state events
        await Promise.all(
            this.modelsDictionary.map(async (journalInput: JournalInput) => {
                if (journalInput.isInitialized()) {
                    return;
                }

                // Create a promise that resolves when the model is initialized
                await new Promise<void>((resolve, reject) => {
                    // Get the model's state machine from the input
                    const model = journalInput as unknown as Model;
                    if (!model.state) {
                        reject(new Error(`Model ${journalInput.eventType} does not have a state machine`));
                        return;
                    }

                    let cleanupFn: (() => void) | undefined;
                    
                    // Listen for the 'init' event that transitions to 'Initialised' state
                    cleanupFn = model.state.onEnterState((state) => {
                        if (state === 'Initialised') {
                            if (cleanupFn) cleanupFn(); // Remove the listener
                            resolve();
                        }
                    });
                });
            })
        );

        // Create channels for models that need them
        await Promise.all(
            this.modelsDictionary.map(async (journalInput: JournalInput) => {
                if (journalInput.createChannel && journalInput.channelId) {
                    await journalInput.createChannel(journalInput.channelId);
                }
            })
        );

        // Set up event handlers for each model
        this.modelsDictionary.forEach((journalInput: JournalInput) => {
            const event = journalInput.eventType;
            const oEventHandler = (timeOfEarliestChange: Date) => {
                this.onUpdated.emit(timeOfEarliestChange);
            };

            const disconnectFn = journalInput.event(oEventHandler.bind(this));
            this.oEventListeners.set(event, {listener: oEventHandler, disconnect: disconnectFn});
        });

        this.state.triggerEvent('init');
    }

    /**
     * removes the handler for every provided model
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');

        this.modelsDictionary.forEach((journalInput: JournalInput) => {
            const oEventHandler = this.oEventListeners.get(journalInput.eventType);

            if (oEventHandler && oEventHandler.disconnect) {
                oEventHandler.disconnect();
            }
        });
        this.state.triggerEvent('shutdown');
    }

    /**
     * Get the latest day stored events sorted by date. In Ascending order
     */
    async retrieveLatestDayEvents(): Promise<JournalEntry[]> {
        this.state.assertCurrentState('Initialised');

        // If there are no provided models, return empty list
        if (this.modelsDictionary.length === 0) {
            return [];
        }

        return await serializeWithType(JournalModel.JOURNAL_LOCK, async () => {
            // Data structure as a dictionary
            const dataDictionary: JournalData = {};

            const latestTo = new Date(await this.findLatestTimeFrame());
            const latestFrom = new Date(latestTo.valueOf() === 0 ? 0 : latestTo.valueOf() - ONE_DAY_MS);

            await Promise.all(
                this.modelsDictionary.map(async (journalInput: JournalInput) => {
                    // Skip if model is not initialized
                    if (!journalInput.isInitialized()) {
                        return;
                    }

                    const event = journalInput.eventType;
                    const data: ObjectData<unknown>[] = [];

                    try {
                        for await (const retrievedData of journalInput.retrieveFn({
                            to: latestTo,
                            from: latestFrom
                        })) {
                            data.push(retrievedData);
                        }

                        dataDictionary[event] = {
                            values: data,
                            index: 0
                        };
                    } catch (error) {
                        console.warn(`Error retrieving data for ${event}:`, error);
                    }
                })
            );

            return this.createEventList(dataDictionary);
        });
    }

    async *objectDataIterator(
        queryOptions?: QueryOptions
    ): AsyncIterableIterator<ObjectData<unknown>> {
        this.state.assertCurrentState('Initialised');
        const iterators = this.modelsDictionary.map(md => md.retrieveFn(queryOptions));

        for await (const data of mergeIteratorsMostCurrent<unknown>(iterators)) {
            yield data.objectData;
        }
    }

    /**
     * Generator function that gets the next day stored events sorted by date. In Ascending order
     */
    async *retrieveEventsByDayIterator(
        pageSize: number = 25
    ): AsyncIterableIterator<JournalEntry[]> {
        this.state.assertCurrentState('Initialised');

        // Find the highest timestamp and set the currentTimeFrame to it.
        // The "from" field will be one day behind the "to" field.
        const to = new Date(await this.findLatestTimeFrame());
        const from = new Date(to.valueOf() === 0 ? 0 : to.valueOf() - ONE_DAY_MS);
        const currentTimeFrame = {from, to};

        // if there are no provided models
        if (this.modelsDictionary.length === 0) {
            return;
        }

        let counter = 0;
        let dataDictionary: JournalData = {};

        for (;;) {
            // If the current time frame reached time '0'
            if (currentTimeFrame.from.getTime() === 0 && currentTimeFrame.to.getTime() === 0) {
                // Yield the remaining values from the dictionary if it got to the end and the
                // dictionary still have values inside
                if (Array.from(Object.keys(dataDictionary)).length !== 0) {
                    yield this.createEventList(dataDictionary);
                }
                break;
            }

            for (const model of this.modelsDictionary) {
                const event = model.eventType;
                for await (const retrievedData of model.retrieveFn({
                    to: currentTimeFrame.to,
                    from: currentTimeFrame.from
                })) {
                    // If the pageSize condition is met
                    if (pageSize === counter) {
                        const eventListEntries = this.createEventList(dataDictionary);
                        yield eventListEntries;
                        dataDictionary = {};
                        counter = 0;
                    }

                    // If the event exists in the dictionary and if the array exists, create a
                    // new array with the new value and the rest of the array
                    if (dataDictionary[event] && dataDictionary[event].values.length) {
                        dataDictionary[event] = {
                            values: [...dataDictionary[event].values, retrievedData],
                            index: 0
                        };
                    } else {
                        dataDictionary[event] = {
                            values: [retrievedData],
                            index: 0
                        };
                    }

                    counter++;
                }
            }

            // Move the TimeFrame to find the next latestTo Date. Start "from" 0 to the previous
            // "from" and update the currentTimeFrame with the found Values.
            const nextTo = new Date(
                await this.findLatestTimeFrame(new Date(0), currentTimeFrame.from)
            );

            currentTimeFrame.from = new Date(
                nextTo.valueOf() === 0 ? 0 : nextTo.valueOf() - ONE_DAY_MS
            );
            currentTimeFrame.to = nextTo;
        }
    }

    /**
     * Get the stored events sorted by date. In Ascending order
     * @returns
     */
    async retrieveAllEvents(queryOptions?: QueryOptions | undefined): Promise<JournalEntry[]> {
        this.state.assertCurrentState('Initialised');

        // If there are no provided models, return empty list
        if (this.modelsDictionary.length === 0) {
            return [];
        }

        // Data structure as a dictionary
        const dataDictionary: JournalData = {};

        // Map every provided model to the data dictionary and get their values
        await Promise.all(
            this.modelsDictionary.map(async (journalInput: JournalInput) => {
                const event = journalInput.eventType;
                const data: ObjectData<unknown>[] = [];
                for await (const retrievedData of journalInput.retrieveFn(queryOptions)) {
                    data.push(retrievedData);
                }
                dataDictionary[event] = {
                    values: data,
                    index: 0
                };
            })
        );

        return this.createEventList(dataDictionary);
    }

    /**
     * This function will create & sort in descending order regarding timestamps for the event list.
     * @param dataDictionary
     * @private
     */
    private createEventList(dataDictionary: JournalData): JournalEntry[] {
        // Get the total length of data values
        const totalLen = Object.keys(dataDictionary)
            .map((event: string) => dataDictionary[event].values.length)
            .reduce((acc: number, cur: number) => acc + cur);

        const eventList = [];

        for (let i = 0; i < totalLen; ++i) {
            const compareElements = [];

            for (const event of Object.keys(dataDictionary)) {
                // Get the actual object
                const eventData = dataDictionary[event];

                // Check the index if it has values left
                if (eventData.index < eventData.values.length) {
                    compareElements.push({
                        /** put the data key as the event type, also = model class name **/
                        type: event,
                        data: eventData.values[eventData.index]
                    });
                }
            }

            // This checks if the number of loop iterations are all right. It should always be
            // ok unless there is a programming error in this algorithm.
            // This should never happen!
            if (compareElements.length === 0) {
                throw new Error('Not enough compare elements in input lists');
            }

            // Let's find the element with the newest date
            let newestElement = compareElements[0];
            for (const compareElement of compareElements) {
                if (compareElement.data.creationTime > newestElement.data.creationTime) {
                    newestElement = compareElement;
                }
            }

            // Increment the added item. newestElement.type is the actual key of the object
            dataDictionary[newestElement.type].index++;

            eventList.push(newestElement);
        }

        // Now all elements should be sorted in the list => return it
        return eventList;
    }

    /**
     * This function queries the channels and finds the newest creation time
     * @param from
     * @param to
     * @private
     */
    private async findLatestTimeFrame(from?: Date, to?: Date): Promise<number> {
        const timestamps = await Promise.all(
            this.modelsDictionary.map(async (journalInput: JournalInput) => {
                let data: ObjectData<unknown> | null = null;

                for await (const retrievedData of journalInput.retrieveFn({
                    count: 1,
                    to: to,
                    from: from
                })) {
                    data = retrievedData;
                }

                if (data !== null) {
                    return data.creationTime.getTime();
                }

                return 0;
            })
        );

        return Math.max(...timestamps);
    }
}

/**
 * get iterators based on ObjectData.creationTime most recent
 * @param iterators
 */
async function* mergeIteratorsMostCurrent<T>(
    iterators: AsyncIterableIterator<ObjectData<T> | Promise<ObjectData<T>>>[]
): AsyncIterableIterator<{objectData: ObjectData<T>; iteratorIndex: number}> {
    // This array holds the topmost value of each iterator
    // The position of the element in this array matches the position in the iterators array.
    // Those values are then compared and the one with the highest
    // timestamp is returned and then replaced by the next one on each iteration
    const currentValues: (ObjectData<T> | undefined)[] = [];

    // Initial fill of the currentValues iterator with the most current elements of each iterator
    for (const iterator of iterators) {
        currentValues.push((await iterator.next()).value);
    }

    // Iterate over all (output) items
    // The number of the iterations will be the sum of all items returned by all iterators.
    // For the above example it would be 9 iterations.
    while (true) {
        // determine the largest element in currentValues
        let mostCurrentItem: ObjectData<T> | undefined = undefined;
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

        // Advance the iterator that yielded the highest creationTime
        currentValues[mostCurrentIndex] = (await iterators[mostCurrentIndex].next()).value;

        // Yield the value that has the highest creationTime
        yield {objectData: mostCurrentItem, iteratorIndex: mostCurrentIndex};
    }
}
