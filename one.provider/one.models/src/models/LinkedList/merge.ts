import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import {linkedListIterator, linkedListMergeIterator} from './iterators.js';
import {isLinkedListRawEntry} from './types.js';
import type {LinkedListNewEntry, LinkedListRawEntry} from './types.js';

const MessageBus = createMessageBus('LinkedListMerge');

/**
 * Merge two linked list elements into a common one.
 *
 * @param currentList
 * @param newList
 */
export async function linkedListMerge(
    currentList: SHA256Hash<LinkedListEntry>,
    newList: SHA256Hash<LinkedListEntry>
): Promise<SHA256Hash<LinkedListEntry>> {
    MessageBus.send('debug', `linkedListMerge: merge ${newList} into ${currentList}`);

    return linkedListMergeIteration(linkedListIterator(currentList), linkedListIterator(newList));
}

/**
 * Merge two linked list elements into a common one.
 *
 * @param currentList
 * @param newListEntry
 */
export async function linkedListMergeSingleElement(
    currentList: SHA256Hash<LinkedListEntry> | undefined,
    newListEntry: LinkedListNewEntry
): Promise<SHA256Hash<LinkedListEntry>> {
    MessageBus.send(
        'debug',
        `linkedListMergeSingleElement: merge ${JSON.stringify(newListEntry)} into ${currentList}`
    );

    async function* makeAsyncIterator<T>(iter: Iterable<T>): AsyncIterator<T> {
        yield* iter;
    }

    return linkedListMergeIteration(
        currentList ? linkedListIterator(currentList) : makeAsyncIterator([]),
        makeAsyncIterator([newListEntry])
    );
}

/**
 * Merge two linked list elements into a common one.
 *
 * @param currentList
 * @param toMergeList
 */
export async function linkedListMergeIteration(
    currentList: AsyncIterator<LinkedListRawEntry>,
    toMergeList: AsyncIterator<LinkedListNewEntry>
): Promise<SHA256Hash<LinkedListEntry>> {
    // Put the iterators in a list.
    // Note: If you want to merge more than two lists in one got, the list can be longer
    // than two elements
    const iterators = [currentList, toMergeList];

    // Iterate over all channel versions simultaneously until
    // 1) there is only a common history left
    // 2) there is only one channel left with elements

    // This will be the remaining history that doesn't need to be merged
    let commonHistoryHead: LinkedListNewEntry | null = null;

    // These are the CreationTime hashes that need to be part of the new history
    const unmergedElements: Array<LinkedListNewEntry & {isNew: boolean}> = [];

    for await (const elem of linkedListMergeIterator<LinkedListRawEntry | LinkedListNewEntry>(
        iterators,
        true
    )) {
        commonHistoryHead = elem;
        unmergedElements.push({...elem, isNew: elem.iterIndex !== 0});
    }
    unmergedElements.pop(); // The last element is the creationTimeHash of the common history head => remove it

    if (!commonHistoryHead) {
        throw new Error('No elements found, not able to merge anything');
    }

    MessageBus.send(
        'debug',
        `mergeEntries: rebuild ${unmergedElements.length} entries on top of ${
            isLinkedListRawEntry(commonHistoryHead)
                ? commonHistoryHead.linkedListEntryHash
                : 'new element'
        }`
    );

    // #### rebuild the history ####

    // If the common history is a new list element, then we also need to rebuild the history
    // item (it was not written, yet => no hash). This only happens if the new element has the
    // lowest timestamp off all iterated elements.
    if (!isLinkedListRawEntry(commonHistoryHead)) {
        // This only happens if the commonHistory head is the last of all elements in both iterators
        const result = await rebuildLinkedList(undefined, [commonHistoryHead, ...unmergedElements]);
        return result.hash;
    }

    // If the common history is a raw element, then we need to put the iterated eleements on top
    if (unmergedElements.length > 0) {
        const result = await rebuildLinkedList(
            commonHistoryHead.linkedListEntryHash,
            unmergedElements
        );
        return result.hash;
    }

    // If no elements need to be rebuilt, then we already have the desired list
    return commonHistoryHead.linkedListEntryHash;
}

/**
 * This places the new elements on top of the old head thus extending the linked list.
 *
 * @param oldHead
 * @param newElementsReversed
 */
async function rebuildLinkedList(
    oldHead: SHA256Hash<LinkedListEntry> | undefined,
    newElementsReversed: LinkedListNewEntry[]
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
