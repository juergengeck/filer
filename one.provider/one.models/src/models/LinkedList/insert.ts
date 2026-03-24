import {isVersionedObject} from '@refinio/one.core/lib/object-recipes.js';
import type {OneObjectTypes} from '@refinio/one.core/lib/recipes.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeVersionedObjectNoMerge} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {isHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import type {CreationTime} from '../../recipes/MetaRecipes.js';
import {linkedListMergeSingleElement} from './merge.js';
import type {LinkedListNewEntry} from './types.js';

async function storeAnyObjectOrHash(objOrHash: OneObjectTypes | SHA256Hash): Promise<SHA256Hash> {
    if (isHash(objOrHash)) {
        return objOrHash;
    }

    if (isVersionedObject(objOrHash)) {
        return (await storeVersionedObjectNoMerge(objOrHash)).hash;
    } else {
        return (await storeUnversionedObject(objOrHash)).hash;
    }
}

type PromiseOrNot<T> = T | Promise<T>;

/**
 * Insert a new element at the correct position in the linked list.
 *
 * @param linkedList
 * @param dataOrHash
 * @param metaDataOrHashes
 * @param timestamp
 */
export async function linkedListInsert(
    linkedList: SHA256Hash<LinkedListEntry> | undefined,
    dataOrHash: OneObjectTypes | SHA256Hash,
    metaDataOrHashes?:
        | Array<OneObjectTypes | SHA256Hash>
        | ((
              creationTimeResult: UnversionedObjectResult<CreationTime>
          ) => PromiseOrNot<Array<OneObjectTypes | SHA256Hash>>),
    timestamp?: number
): Promise<SHA256Hash<LinkedListEntry>> {
    const dataHash = await storeAnyObjectOrHash(dataOrHash);

    // Write creation time meta information
    const creationTimeResult = await storeUnversionedObject({
        $type$: 'CreationTime',
        timestamp: timestamp ? timestamp : Date.now(),
        data: dataHash
    });

    let metaDataHashes: SHA256Hash[] | undefined = undefined;

    if (metaDataOrHashes) {
        if (!Array.isArray(metaDataOrHashes)) {
            metaDataOrHashes = await metaDataOrHashes(creationTimeResult);
        }

        metaDataHashes = await Promise.all(metaDataOrHashes.map(storeAnyObjectOrHash));
    }

    const newListEntry: LinkedListNewEntry = {
        creationTimeHash: creationTimeResult.hash,
        creationTime: creationTimeResult.obj.timestamp,
        metaDataHashes
    };

    return linkedListMergeSingleElement(linkedList, newListEntry);
}
