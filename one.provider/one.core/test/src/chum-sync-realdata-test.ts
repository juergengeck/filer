/* eslint-disable no-await-in-loop, no-console, arrow-parens, arrow-parens, @typescript-eslint/no-unsafe-call */

/*
 * If you want to adjust the directory you will have to do it here and in chumSyncTestBob
 * Conf.NAME.initialDataObj.directory
 */

import {expect} from 'chai';

import type {ChumSyncOptions} from '../../lib/chum-sync.js';
import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {createMessageBus} from '../../lib/message-bus.js';
import type {Chum, Instance, Person} from '../../lib/recipes.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '../../lib/util/object.js';
import {wait} from '../../lib/util/promise.js';
import type {SHA256IdHash} from '../../lib/util/type-checks.js';
import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';
import {CONFIGURATION, SERVICE, startTestChum} from './_chum-sync-common.js';
import {createWsPromiObj} from './_chum-test-create-ws.js';
import {startCommServer, stopCommServer} from './_communication-server.js';
import {init} from './_helpers.js';
import type {BobChumOptions} from './chum-sync-bob.js';

const MessageBus = createMessageBus('test:chum-sync-alice');

describe.skip('ChumSync Real-Data tests', () => {
    const defaultInitialChumObj: ChumSyncOptions = {
        connection: undefined as any, // TO BE FILLED AT POINT OF USE
        localPersonId: '' as any, // PLACEHOLDER filled in before() function
        remotePersonId: '' as any, // PLACEHOLDER filled in before() function
        chumName: 'MochaTest',
        localInstanceName: CONFIGURATION.alice.instance.name,
        remoteInstanceName: CONFIGURATION.bob.instance.name,
        keepRunning: false,
        pollInterval: 200
    };

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

    // async function bobReportMemoryUsage(): Promise<NodeJS.MemoryUsageFn> {
    //     return (await bobConnection.send(SERVICE.reportMemoryUsage)) as NodeJS.MemoryUsageFn;
    // }

    let bobIdRef: SHA256IdHash<Person>;
    let aliceIdRef: SHA256IdHash<Person>;

    // let instance;

    before(async () => {
        // startLogger({includeInstanceName: true, types: ['log', 'alert', 'error']});
        // startLogger({includeInstanceName: true, types: ['log', 'alert', 'error', 'debug']});
        startLogger({includeInstanceName: true, types: ['error']});

        MessageBus.send(
            'log',
            'TEST SETUP "BEFORE" (start and conect to comm-server, and tell it to spawn Bob)'
        );

        stopCommServer();
        startCommServer({silent: true});

        await wait(100);

        bobConnection = await createWsPromiObj('AliceControl', 'BobControl', 'Bob');

        bobConnection.addService(SERVICE.log, console.log);
    });

    beforeEach(async () => {
        MessageBus.send('log', 'TEST SETUP "BEFORE EACH"');

        try {
            await Promise.all([
                bobInit(),
                init({
                    email: CONFIGURATION.alice.initialDataObj.email,
                    name: CONFIGURATION.alice.initialDataObj.instanceName
                })
            ]);
        } catch (err) {
            return MessageBus.send('error', err);
        }

        const [alice, bob] = await Promise.all([
            storeVersionedObject(CONFIGURATION.alice.person),
            storeVersionedObject(CONFIGURATION.bob.person)
        ]);

        defaultInitialChumObj.localPersonId = await calculateIdHashOfObj(
            CONFIGURATION.alice.person
        );
        defaultInitialChumObj.remotePersonId = await calculateIdHashOfObj(CONFIGURATION.bob.person);

        bobIdRef = bob.idHash;
        aliceIdRef = alice.idHash;
    });

    it('should run a full sync using the existing data', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const bobPromise: Promise<VersionedObjectResult<Chum>> = bobEmptyChum({
            bobPersonId: bobIdRef,
            alicePersonId: aliceIdRef,
            bobInstanceName: '',
            aliceInstanceName: '',
            keepRunning: false
        });

        bobPromise
            .then(_chumObj => MessageBus.send('log', 'BOB FINISHED'))
            .catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alicePromise = startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj()
            })
        ).promise;

        alicePromise
            .then(() => MessageBus.send('log', 'ALICE FINISHED'))
            .catch(e => MessageBus.send('error', 'ALICE ERROR:', e));

        const alice = await alicePromise;

        const bob = await bobPromise;

        expect(alice.obj.errors.length).to.equal(0);
        expect(bob.obj.errors.length).to.equal(0);

        // console.log('BOB', JSON.stringify(bob, errObjConverter, 4));
        // console.log('ALICE', JSON.stringify(alice, ChumSyncCommon.errObjConverter, 4));
    });

    afterEach(async () => {
        MessageBus.send('log', 'TEST SETUP "AFTER EACH"');
        await bobDeleteTestDB();
        await closeAndDeleteCurrentInstance();
    });

    after(async () => {
        MessageBus.send('log', 'END OF CHUM TESTS - Cleaning up');
        stopCommServer();
        bobConnection.clearServices();
        bobConnection.close();
        stopLogger();
    });
});
