/* eslint-disable no-console, arrow-parens, no-await-in-loop, @typescript-eslint/no-unsafe-call */

/*
 * If you want to adjust the directory you will have to do it here and in chumSyncTestBob
 * Conf.NAME.initialDataObj.directory
 */

import {createChum} from '../../lib/chum-sync.js';
import {closeInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {createMessageBus} from '../../lib/message-bus.js';
import type {Chum, Instance} from '../../lib/recipes.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '../../lib/util/object.js';
import {wait} from '../../lib/util/promise.js';
import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';
import {CONFIGURATION, SERVICE} from './_chum-sync-common.js';
import {createWsPromiObj} from './_chum-test-create-ws.js';
import {startCommServer, stopCommServer} from './_communication-server.js';
import {init, objWithNumberValuesToReadableStr} from './_helpers.js';
import type {BobChumOptions} from './chum-sync-bob.js';

const MessageBus = createMessageBus('test:chum-sync-alice');

let reportInterval: undefined | NodeJS.Timeout;

// Alice-Bob control connection - the communication server spawns Bob
let bobConnection: WebsocketPromisifierAPI;

async function bobInit(): Promise<Instance> {
    return (await bobConnection.send(SERVICE.init)) as Instance;
}

async function bobDeleteTestDB(): Promise<void> {
    await bobConnection.send(SERVICE.deleteTestDB);
}

async function bobEmptyChum(opts?: BobChumOptions): Promise<VersionedObjectResult<Chum>> {
    return (await bobConnection.send(SERVICE.emptyChum, opts)) as VersionedObjectResult<Chum>;
}

// async function bobOnGoingChum(): Promise<VersionedObjectResult<Chum>> {
//     return (await bobConnection.send(SERVICE.onGoingChum)) as VersionedObjectResult<Chum>;
// }
//
// async function bobGrantAccess(
//     accessRequests: SetAccessParam[]
// ): Promise<Array<VersionedObjectResult<Access | IdAccess>>> {
//     return (await bobConnection.send(SERVICE.grantAccess, accessRequests)) as Array<
//         VersionedObjectResult<Access | IdAccess>
//     >;
// }
//
// async function bobCheckExistence(hash: SHA256Hash<HashTypes> | SHA256IdHash): Promise<boolean> {
//     return (await bobConnection.send(SERVICE.checkExistence, hash)) as boolean;
// }
//
// async function bobCreateObj<T extends OneObjectTypes>(obj: T): Promise<AnyObjectCreation<T>> {
//     return (await bobConnection.send(SERVICE.createObj, obj)) as AnyObjectCreation<T>;
// }

async function bobReportMemoryUsage(): Promise<NodeJS.MemoryUsageFn> {
    return (await bobConnection.send(SERVICE.reportMemoryUsage)) as NodeJS.MemoryUsageFn;
}

async function startCommServerAndBob(): Promise<void> {
    MessageBus.send('log', 'TEST SETUP "BEFORE" (start comm-server and Bob)');

    stopCommServer();
    startCommServer({silent: true});

    await wait(100);

    bobConnection = await createWsPromiObj('AliceControl', 'BobControl', 'Bob');

    bobConnection.addService(SERVICE.log, console.log);
}

async function chumTest(name: string): Promise<void> {
    await Promise.all([
        bobInit(),
        init({
            email: CONFIGURATION.alice.initialDataObj.email,
            name: CONFIGURATION.alice.initialDataObj.instanceName + name,
            deleteDb: false,
            initiallyEnabledReverseMapTypes: [],
            initiallyEnabledReverseMapTypesForIdObjects: []
        })
    ]);

    const chumStart = Date.now();

    const bobPromise: Promise<VersionedObjectResult<Chum>> = bobEmptyChum();

    bobPromise.catch(e => console.log('BOB ERROR:', e));

    console.log('\n\nALICE [START]: ', objWithNumberValuesToReadableStr(process.memoryUsage()));

    // const alice = await createChum(chumConf);
    const alicePromise = createChum({
        connection: await createWsPromiObj(),
        localPersonId: await calculateIdHashOfObj(CONFIGURATION.alice.person),
        remotePersonId: await calculateIdHashOfObj(CONFIGURATION.bob.person),
        chumName: 'MochaTest',
        localInstanceName: CONFIGURATION.alice.instance.name,
        remoteInstanceName: CONFIGURATION.bob.instance.name,
        keepRunning: false,
        pollInterval: 200
    }).promise;

    reportInterval = setInterval(() => {
        console.log('ALICE: ', objWithNumberValuesToReadableStr(process.memoryUsage()));
        bobReportMemoryUsage()
            .then(data => console.log('BOB: ', objWithNumberValuesToReadableStr(data)))
            .catch(err => console.error('BOB: ', err));
    }, 1000);

    const alice = await alicePromise;

    clearInterval(reportInterval);

    console.log(`CHUM - DONE ${Math.round((Date.now() - chumStart) / 1000)} s`);

    // await Promise.all(
    //     // TODO The roots
    //     [].map(async root => {
    //         const result = await sendToBob(SERVICE.checkExistence, root.hash);
    //         // expect(result).to.equal(true);
    //     })
    // );

    const bob = await bobPromise;

    // Chum object
    // console.log(JSON.stringify(alice, null, 4));
    console.log('\nALICE Chum object');
    console.log('Errors', alice.obj.errors);
    console.log('AtoBObjects (nr)', alice.obj.AtoBObjects.length);
    console.log('AtoBIdObjects (nr)', alice.obj.AtoBIdObjects.length);
    console.log('AtoBBlob (nr)', alice.obj.AtoBBlob.length);
    console.log('AtoBClob (nr)', alice.obj.AtoBClob.length);
    console.log('BtoAObjects (nr)', alice.obj.BtoAObjects.length);
    console.log('BtoAIdObjects (nr)', alice.obj.BtoAObjects.length);
    console.log('BtoABlob (nr)', alice.obj.BtoABlob.length);
    console.log('BtoAClob (nr)', alice.obj.BtoAClob.length);
    console.log('Statistics', alice.obj.statistics);
    console.log('Alice errors: ', alice.obj.errors);

    console.log('\nBOB Chum object');
    console.log('Errors', bob.obj.errors);
    console.log('AtoBObjects (nr)', bob.obj.AtoBObjects.length);
    console.log('AtoBIdObjects (nr)', bob.obj.AtoBIdObjects.length);
    console.log('AtoBBlob (nr)', bob.obj.AtoBBlob.length);
    console.log('AtoBClob (nr)', bob.obj.AtoBClob.length);
    console.log('BtoAObjects (nr)', bob.obj.BtoAObjects.length);
    console.log('BtoAIdObjects (nr)', bob.obj.BtoAIdObjects.length);
    console.log('BtoABlob (nr)', bob.obj.BtoABlob.length);
    console.log('BtoAClob (nr)', bob.obj.BtoAClob.length);
    console.log('Statistics', bob.obj.statistics);
    console.log('Bob errors: ', bob.obj.errors);

    // console.log('BOB', JSON.stringify(bob, errObjConverter, 4));
    // console.log('ALICE', JSON.stringify(alice, errObjConverter, 4));

    await bobDeleteTestDB();

    closeInstance();

    stopCommServer();
}

async function run(): Promise<void> {
    await startCommServerAndBob();

    // await chumTest('-large-deep');
    await chumTest('-large-shallow');

    stopCommServer();

    bobConnection.clearServices();
    bobConnection.close();
}

// startLogger({includeInstanceName: true, types: ['log', 'alert', 'error']});
startLogger({includeInstanceName: true, types: ['alert', 'error']});

run()
    .then(console.log)
    .catch(err => {
        if (reportInterval !== undefined) {
            clearInterval(reportInterval);
        }

        console.error(err);
    })
    .finally(() => {
        stopLogger();
    });
