import {VersionTree} from '@refinio/one.core/lib/crdts/VersionTree.js';
import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getCurrentVersion,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';

import {
    closeAndDeleteCurrentInstance,
    getInstanceOwnerIdHash
} from '@refinio/one.core/lib/instance.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {registerCrdtAlgorithm} from '@refinio/one.core/lib/crdts/CrdtAlgorithmRegistry.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

import type {ChannelInfo} from '../lib/recipes/ChannelRecipes.js';
import {linkedListIterator} from '../lib/models/LinkedList/iterators.js';
import {LinkedListCrdtAlgorithm} from '../lib/models/LinkedList/LinkedListCrdtAlgorithm.js';
import * as StorageTestInit from './_helpers.js';

// ######## SPECIALLY FORMATTED LOGGING ########
//startLogger({types: ['log', 'debug']});

async function postMessage(
    channelId: string,
    text: string,
    versionHash?: SHA256Hash<VersionNode>
): Promise<VersionedObjectResult<ChannelInfo>> {
    const me = getInstanceOwnerIdHash();

    if (me === undefined) {
        throw new Error('Failed to get instance owner');
    }

    const message = await storeUnversionedObject({
        $type$: 'ChatMessage',
        text,
        sender: me
    });

    const creationTime = await storeUnversionedObject({
        $type$: 'CreationTime',
        timestamp: Date.now(),
        data: message.hash
    });

    const entry = await storeUnversionedObject({
        $type$: 'LinkedListEntry',
        data: creationTime.hash
    });

    return storeVersionedObject({
        $type$: 'ChannelInfo',
        $versionHash$: versionHash,
        id: channelId,
        head: entry.hash
    });
}

describe('Linked List Test', () => {
    before(async () => {
        await StorageTestInit.init();
        registerCrdtAlgorithm(new LinkedListCrdtAlgorithm());
    });

    after(async () => {
        await closeAndDeleteCurrentInstance();
    });

    it.skip('should create channels and init channelManager', async () => {
        const msg1 = await postMessage('test', 'aaa');
        const msg2 = await postMessage('test', 'bbb', msg1.obj.$versionHash$);
        const msg3 = await postMessage('test', 'ccc', msg2.obj.$versionHash$);

        console.log('MSG1', msg1);
        console.log('MSG2', msg2);
        console.log('MSG3', msg3);

        console.log(await VersionTree.getCurrentVersionTreeAsString(msg1.idHash));

        const channelResult = await getCurrentVersion(msg1.idHash);
        console.log('Result', channelResult);

        if (channelResult.head === undefined) {
            throw new Error('Head is undefined');
        }

        for await (const entry of linkedListIterator(channelResult.head)) {
            const data = await getObject(entry.dataHash);
            console.log('Message', data);
        }
    });
});
