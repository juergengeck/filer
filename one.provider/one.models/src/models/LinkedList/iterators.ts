import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import {isLinkedListRawEntry} from './types.js';
import type {LinkedListNewEntry, LinkedListRawEntry} from './types.js';

const MessageBus = createMessageBus('LinkedListIterators');

/**
 * Iterate multiple iterators at the same time returning the elements in sorted order,
 *
 * @param iterators - Iterators that return linked list entries. Each iterator must return the
 *                    elements sorted by creation time (highest creation time first)
 * @param terminateOnSingleIterator - Terminate if only one iterator has elements left
 * @param yieldCommonHistoryElement - If terminated, include the common history element
 * @param onlyDifferentElements - Only return elements that differ (have different CreationTime
 *                                hashes
 */
export async function* linkedListMergeIterator<
    EntryT extends LinkedListRawEntry | LinkedListNewEntry = LinkedListRawEntry
>(
    iterators: AsyncIterator<EntryT>[],
    terminateOnSingleIterator: boolean = false,
    yieldCommonHistoryElement: boolean = true,
    onlyDifferentElements: boolean = false
): AsyncIterableIterator<EntryT & {iterIndex: number; activeIteratorCount: number}> {
    MessageBus.send('debug', `mergeIteratorMostCurrent - ENTER: ${iterators.length} iterators`);

    // This array holds the topmost value of each iterator
    // The position of the element in this array matches the position in the iterators array.
    // Those values are then compared and the one with the highest
    // timestamp is returned and then replaced by the next one on each iteration
    const currentValues: (EntryT | undefined)[] = [];
    let previousItem: EntryT | undefined = undefined;

    // Initial fill of the currentValues iterator with the most current elements of each iterator
    for (const iterator of iterators) {
        currentValues.push((await iterator.next()).value);
    }

    // Iterate over all (output) items
    // The number of the iterations will be the sum of all items returned by all iterators.
    // For the above example it would be 9 iterations.
    while (true) {
        // determine the largest element in currentValues
        let mostCurrentItem: EntryT | undefined = undefined;
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
                    isLinkedListRawEntry(currentValue) &&
                    isLinkedListRawEntry(mostCurrentItem) &&
                    currentValue.creationTime === mostCurrentItem.creationTime &&
                    currentValue.linkedListEntryHash === mostCurrentItem.linkedListEntryHash
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

                if (currentValue.creationTimeHash === mostCurrentItem.creationTimeHash) {
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
        if (terminateOnSingleIterator && !yieldCommonHistoryElement && activeIteratorCount === 1) {
            break;
        }

        // Filter for duplicates
        if (
            previousItem &&
            previousItem.creationTime === mostCurrentItem.creationTime &&
            previousItem.creationTimeHash === mostCurrentItem.creationTimeHash
        ) {
            MessageBus.send(
                'debug',
                `mergeIteratorMostCurrent: skipped value from iterator ${mostCurrentIndex}: duplicate with previous`
            );
        } else {
            MessageBus.send(
                'debug',
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

    MessageBus.send('debug', 'mergeIteratorMostCurrent - LEAVE');
}

/**
 * Iterate the linked list by loading element for element.
 *
 * @param entryHash - Hash of first element
 */
export async function* linkedListIterator(
    entryHash: SHA256Hash<LinkedListEntry> | undefined
): AsyncIterableIterator<LinkedListRawEntry> {
    // Iterate over all elements and yield each element
    let currentEntryHash = entryHash;

    while (currentEntryHash) {
        const entry: LinkedListEntry = await getObject(currentEntryHash);

        if (entry.$type$ !== 'LinkedListEntry') {
            throw new Error('Object must be of type LinkedListEntry');
        }

        const creationTimeHash = entry.data;
        const creationTime = await getObject(creationTimeHash);

        yield {
            linkedListEntryHash: currentEntryHash,
            creationTimeHash: creationTimeHash,
            creationTime: creationTime.timestamp,
            dataHash: creationTime.data,
            metaDataHashes: entry.metadata
        };

        currentEntryHash = entry.previous;
    }
}
