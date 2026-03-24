import {expect} from 'chai';

import {closeAndDeleteCurrentInstance} from '@refinio/one.core/lib/instance.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {getVersionsNodes} from '@refinio/one.core/lib/storage-versioned-objects.js';

import ChannelManager from '../lib/models/ChannelManager.js';
import type {ObjectData, RawChannelEntry} from '../lib/models/ChannelManager.js';
import {Order} from '../lib/models/ChannelManager.js';
import type {BodyTemperature} from '../lib/recipes/BodyTemperatureRecipe.js';
import * as StorageTestInit from './_helpers.js';
import TestModel from './utils/TestModel.js';
import {wait} from '@refinio/one.core/lib/util/promise.js';

let channelManager: ChannelManager;
let testModel: TestModel;

// ######## SPECIALLY FORMATTED LOGGING ########
const enableLogging = false;

const indentationMap = new Map<string, number>(); // Map that stores indention levels based on channels

/**
 * Formats the log message in a special way:
 * splits the message at # and
 * - colors the channel id (first value) yellow (log) or green(debug)
 * - colors the channel owner (second value) blue
 * - indents the third value based on START / END string
 *
 * @param message
 * @param color
 * @returns
 */
function format(message: string, color: number): string[] {
    const m = message;
    const mArr = m.split('#');
    if (m.length >= 3) {
        const mid = mArr[0];
        if (!indentationMap.has(mid)) {
            indentationMap.set(mid, 0);
        }
        if (mArr[2].includes('END')) {
            indentationMap.set(mid, (indentationMap.get(mid) || 0) - 1);
        }
        mArr[0] = mArr[0].padEnd(10, ' ');
        mArr[0] = `\x1b[${color}m${mArr[0]}\x1b[0m`;
        mArr[1] = mArr[1].padEnd((indentationMap.get(mid) || 0) + 70, ' ');
        mArr[1] = `\x1b[34m${mArr[1]}\x1b[0m`;
        mArr[2] = mArr[2].replace('START', '\x1b[32mSTART\x1b[0m');
        mArr[2] = mArr[2].replace('ENTER', '\x1b[32mENTER\x1b[0m');
        mArr[2] = mArr[2].replace('END', '\x1b[31mEND\x1b[0m');
        mArr[2] = mArr[2].replace('LEAVE', '\x1b[31mLEAVE\x1b[0m');
        if (mArr[2].includes('START')) {
            indentationMap.set(mid, (indentationMap.get(mid) || 0) + 1);
        }
    }
    return mArr;
}

const MessageBus = createMessageBus('dummy');
if (enableLogging) {
    MessageBus.on('ChannelManager:log', (_src: string, message: unknown) => {
        const m = format(message as string, 33);
        console.log(...m);
    });
    MessageBus.on('ChannelManager:debug', (_src: string, message: unknown) => {
        const m = format(message as string, 32);
        console.log(...m);
    });
}

// async function buildChannelInfo(dataHashes: SHA256Hash<CreationTime>[]): Promise<ChannelInfo> {
//     let previous: SHA256Hash<ChannelEntry> | undefined = undefined;
//     for (const dataHash of dataHashes) {
//         previous = (
//             await storeUnversionedObject({
//                 $type$: 'ChannelEntry',
//                 data: dataHash,
//                 previous
//             })
//         ).hash;
//     }
//     return {
//         $type$: 'ChannelInfo',
//         owner: getInstanceOwnerIdHash()!,
//         id: 'mergetest',
//         head: previous
//     };
// }

// ######## SPECIALLY FORMATTED LOGGING - END ########

describe('Channel Manager test', () => {
    before(async () => {
        await StorageTestInit.init();
        const model = new TestModel('ws://localhost:8000');
        await model.init(undefined);
        testModel = model;
        channelManager = model.channelManager;
    });

    after(async () => {
        // Wait for the hooks to run to completion
        await testModel.shutdown();
        await closeAndDeleteCurrentInstance();
    });

    it('should create channels and init channelManager', async () => {
        await channelManager.createChannel('first');
        await channelManager.createChannel('second');
        await channelManager.createChannel('third');
        await channelManager.createChannel('fourth');
    });

    it('should get zero objects by iterator', async () => {
        expect((await channelManager.objectIterator().next()).done).to.be.true;
    });

    it('should get zero objects by getObjects', async () => {
        expect((await channelManager.getObjects()).length).to.be.equal(0);
    }).timeout(5000);

    it('should add data to created channels', async () => {
        await channelManager.postToChannel('first', {$type$: 'BodyTemperature', temperature: 1});
        await channelManager.postToChannel('second', {$type$: 'BodyTemperature', temperature: 2});
        await channelManager.postToChannel('third', {$type$: 'BodyTemperature', temperature: 3});
        await channelManager.postToChannel('third', {$type$: 'BodyTemperature', temperature: 4});
        await channelManager.postToChannel('second', {$type$: 'BodyTemperature', temperature: 5});
        await channelManager.postToChannel('first', {$type$: 'BodyTemperature', temperature: 6});
        await wait(1000);
    });

    // This test tries to replicate this setup, because it doesn't work right.
    // W: A -> B -> C -> D -> E -> ...
    // X: C
    // Y: A
    // Z: A -> B -> C
    it('MergeBugTestIter', async () => {
        async function* valueGenerator(
            arr: RawChannelEntry[]
        ): AsyncIterableIterator<RawChannelEntry> {
            yield* arr;
        }

        const W = [
            {
                channelEntryHash:
                    '5688af95b1f68d1a9118d7e17be9e219a91168e694ab407b2bad3ed915087d04',
                creationTimeHash:
                    '1547e5350908a3de7f655d255cd93af0e7623ad0330bbfbd3aefab7bc98630db',
                creationTime: 1614773672411
            },
            {
                channelEntryHash:
                    'f3f4aa9aaa21794b826951a4ee12e49400f23ac13fe71449f158bf779ec89573',
                creationTimeHash:
                    'bea92e05d611a3f27c354fc23db0f3e921d7b5d0d4936d2ecc45f3c3f0751cec',
                creationTime: 1614773575275
            },
            {
                channelEntryHash:
                    'fc64bb17a9fa12425e439beee9909a8a2edafc143c9e0b39257982414a9cbe56',
                creationTimeHash:
                    'b5d0d2ccc210930438d8109466d7816566307b94aa302927c2645a8027abab87',
                creationTime: 1614174911147
            },
            {
                channelEntryHash:
                    '1870c02045ab1a985550a88a2454e16cda952edeabdedb4b616f97959472ce15',
                creationTimeHash:
                    '523a2bf86fbc8755a0b6a48bd698178b996f2832a063ea8216cd476a64e0bfef',
                creationTime: 1614170581769
            }
        ];
        // const X = [
        //     {
        //         channelEntryHash:
        //             '646f91d9a141227488e5249b09ca23bfb159e9d5b4e5977781581b966b03b363',
        //         creationTimeHash:
        //             'b5d0d2ccc210930438d8109466d7816566307b94aa302927c2645a8027abab87',
        //         creationTime: 1614174911147
        //     }
        // ];
        // const Y = [
        //     {
        //         channelEntryHash:
        //             '38cb1f4e0059a6f4112ea68f007a1403e75e77129c6575ba735722e25bda07b3',
        //         creationTimeHash:
        //             '1547e5350908a3de7f655d255cd93af0e7623ad0330bbfbd3aefab7bc98630db',
        //         creationTime: 1614773672411
        //     }
        // ];
        const Z = [
            {
                channelEntryHash:
                    '5b4cce50265587493b3eedc8b07ec4ad2ba26c1a17c7c817b04c8ef6914e6c86',
                creationTimeHash:
                    '1547e5350908a3de7f655d255cd93af0e7623ad0330bbfbd3aefab7bc98630db',
                creationTime: 1614773672411
            },
            {
                channelEntryHash:
                    'd5f0d34790e7d14129fdfdee60285c6f073cd860740506c87c4d773c651c96ca',
                creationTimeHash:
                    'bea92e05d611a3f27c354fc23db0f3e921d7b5d0d4936d2ecc45f3c3f0751cec',
                creationTime: 1614773575275
            },
            {
                channelEntryHash:
                    '646f91d9a141227488e5249b09ca23bfb159e9d5b4e5977781581b966b03b363',
                creationTimeHash:
                    'b5d0d2ccc210930438d8109466d7816566307b94aa302927c2645a8027abab87',
                creationTime: 1614174911147
            }
        ];

        const iter = ChannelManager.mergeIteratorMostCurrent(
            [
                valueGenerator(W as RawChannelEntry[]),
                //valueGenerator(X as RawChannelEntry[]),
                //valueGenerator(Y as RawChannelEntry[]),
                valueGenerator(Z as RawChannelEntry[])
            ],
            true
        );

        let i = 0;
        for await (const _item of iter) {
            ++i;
        }
        expect(i).to.be.equal(4);
    });

    // This test tries to replicate this setup, because it doesn't work right.
    // W: A -> B -> C -> D -> E -> ...
    // X: C
    // Y: A
    // Z: A -> B -> C
    /*    it('MergeBugTest', async () => {
        await wait(1000);

        const owner = getInstanceOwnerIdHash();
        console.log('owner', owner);

        const channelInfo = await getObjectByIdObj({
            $type$: 'ChannelInfo',
            owner,
            id: 'mergetest'
        });
        console.log('channelInfo', channelInfo);

        const WRawEntries: ObjectData<BodyTemperature>[] = [];
        for await (const entry of channelManager.entryIterator(channelInfo)) {
            WRawEntries.push(entry);
        }

        const XChannelInfo = buildChannelInfo(
            [WRawEntries[2].creationTimeHash]
        )
        const YChannelInfo = buildChannelInfo(
            [WRawEntries[0].creationTimeHash]
        )
        const ZChannelInfo = buildChannelInfo(
            [WRawEntries[0].creationTimeHash, WRawEntries[1].creationTimeHash, WRawEntries[2].creationTimeHash]
        )


        await createSingleObjectThroughPurePlan(
            {
                module: '@one/identity',
                versionMapPolicy: {'*': VERSION_UPDATES.NONE_IF_LATEST}
            },
            XChannelInfo, YChannelInfo, ZChannelInfo
        )

        await wait(1000);

        console.log([await channelManager.getObjects({ channelId: 'mergetest' })]);
    });
    */

    it('should get objects with iterator', async () => {
        async function arrayFromAsync(
            iter: AsyncIterable<ObjectData<BodyTemperature>>
        ): Promise<ObjectData<BodyTemperature>[]> {
            const arr = [];
            for await (const elem of iter) {
                arr.push(elem);
            }
            return arr;
        }

        // Check all values
        const allValues = await arrayFromAsync(
            channelManager.objectIteratorWithType('BodyTemperature')
        );
        expect(allValues.map(e => e.data.temperature)).to.be.eql([6, 5, 4, 3, 2, 1]);

        // Check first channel
        const firstValues = await arrayFromAsync(
            channelManager.objectIteratorWithType('BodyTemperature', {
                channelId: 'first'
            })
        );
        expect(firstValues.map(e => e.data.temperature)).to.be.eql([6, 1]);

        // Check second channel
        const secondValues = await arrayFromAsync(
            channelManager.objectIteratorWithType('BodyTemperature', {
                channelId: 'second'
            })
        );
        expect(secondValues.map(e => e.data.temperature)).to.be.eql([5, 2]);

        // Check third channel
        const thirdValues = await arrayFromAsync(
            channelManager.objectIteratorWithType('BodyTemperature', {
                channelId: 'third'
            })
        );
        expect(thirdValues.map(e => e.data.temperature)).to.be.eql([4, 3]);

        // Check fourth channel
        const fourthValues = await arrayFromAsync(
            channelManager.objectIteratorWithType('BodyTemperature', {
                channelId: 'fourth'
            })
        );
        expect(fourthValues.map(e => e.data.temperature)).to.be.eql([]);
    });

    it('should get objects', async () => {
        // Check all values
        const allValuesAsc = await channelManager.getObjectsWithType('BodyTemperature');
        const allValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            orderBy: Order.Descending
        });
        expect(allValuesAsc.map(e => e.data.temperature)).to.be.eql([1, 2, 3, 4, 5, 6]);
        expect(allValuesDes.map(e => e.data.temperature)).to.be.eql([6, 5, 4, 3, 2, 1]);

        // Check first channel
        const firstValuesAsc = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'first'
        });
        const firstValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'first',
            orderBy: Order.Descending
        });
        expect(firstValuesAsc.map(e => e.data.temperature)).to.be.eql([1, 6]);
        expect(firstValuesDes.map(e => e.data.temperature)).to.be.eql([6, 1]);

        // Check second channel
        const secondValuesAsc = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'second'
        });
        const secondValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'second',
            orderBy: Order.Descending
        });
        expect(secondValuesAsc.map(e => e.data.temperature)).to.be.eql([2, 5]);
        expect(secondValuesDes.map(e => e.data.temperature)).to.be.eql([5, 2]);

        // Check third channel
        const thirdValuesAsc = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'third'
        });
        const thirdValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'third',
            orderBy: Order.Descending
        });
        expect(thirdValuesAsc.map(e => e.data.temperature)).to.be.eql([3, 4]);
        expect(thirdValuesDes.map(e => e.data.temperature)).to.be.eql([4, 3]);

        // Check fourth channel
        const fourthValuesAsc = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'fourth'
        });
        const fourthValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'fourth',
            orderBy: Order.Descending
        });
        expect(fourthValuesAsc.map(e => e.data.temperature)).to.be.eql([]);
        expect(fourthValuesDes.map(e => e.data.temperature)).to.be.eql([]);
    });

    it('should get objects by id', async () => {
        // Check all values
        const allValuesAsc = await channelManager.getObjectsWithType('BodyTemperature');
        const allValuesDes = await channelManager.getObjectsWithType('BodyTemperature', {
            orderBy: Order.Descending
        });

        // Get all values by id
        const allValuesAscById = await Promise.all(
            allValuesAsc.map(item => channelManager.getObjectById(item.id))
        );
        const allValuesDesById = await Promise.all(
            allValuesDes.map(item => channelManager.getObjectById(item.id))
        );

        // Check the results
        expect(allValuesAscById.map(e => (e.data as BodyTemperature).temperature)).to.be.eql([
            1, 2, 3, 4, 5, 6
        ]);
        expect(allValuesDesById.map(e => (e.data as BodyTemperature).temperature)).to.be.eql([
            6, 5, 4, 3, 2, 1
        ]);
    });

    it('should iterate differences in versions', async () => {
        const channels = await channelManager.channels();
        const hash = await calculateIdHashOfObj({
            $type$: 'ChannelInfo',
            owner: channels[0].owner,
            id: 'first'
        });
        const firstValuesAsc = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'first'
        });
        //console.log(firstValuesAsc);

        // Post other elements
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        await channelManager.internalChannelPost(
            'first',
            channels[0].owner,
            {$type$: 'BodyTemperature', temperature: 9},
            undefined,
            firstValuesAsc[1].creationTime.getTime() - 1
        );

        /*const firstValuesAsc2 = await channelManager.getObjectsWithType('BodyTemperature', {
            channelId: 'first'
        });
        console.log(firstValuesAsc2);*/

        const versionMap = await getVersionsNodes(hash);
        /*for (const versionMapEntry of versionMap) {
            const objects = await channelManager.getObjects({
                channelInfoHash: versionMapEntry.hash
            });
            const filtered = objects.map(obj => obj.data.temperature);
            console.log('Channel Content', filtered);
        }*/

        const elements1 = [];
        for await (const entry of ChannelManager.differencesIteratorMostCurrent(
            versionMap[1].data,
            versionMap[versionMap.length - 1].data
        )) {
            elements1.push(((await getObject(entry.dataHash)) as BodyTemperature).temperature);
        }

        const elements2 = [];
        for await (const entry of ChannelManager.differencesIteratorMostCurrent(
            versionMap[2].data,
            versionMap[versionMap.length - 1].data
        )) {
            elements2.push(((await getObject(entry.dataHash)) as BodyTemperature).temperature);
        }

        expect(elements1).to.be.eql([6, 9]);
        expect(elements2).to.be.eql([9]);
    });
});
