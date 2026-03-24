/* eslint-disable no-console, no-await-in-loop, arrow-parens, require-jsdoc, arrow-parens,
   @typescript-eslint/no-unsafe-call */

/**
 * @file The main and active side of an Alice-Bob chum connection. Alice can be run on node.js
 * or in the browser (see index.html).
 */

import {expect} from 'chai';

import type {SetAccessParam} from '../../lib/access.js';
import {createAccess} from '../../lib/access.js';
import type {ChumSyncOptions} from '../../lib/chum-sync.js';
import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {createMessageBus} from '../../lib/message-bus.js';
import type {
    Access,
    BLOB,
    Chum,
    CLOB,
    HashTypes,
    IdAccess,
    Instance,
    OneObjectTypes,
    Person
} from '../../lib/recipes.js';
import type {AnyObjectCreation} from '../../lib/storage-base-common.js';
import {SET_ACCESS_MODE} from '../../lib/storage-base-common.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {isBrowser, SYSTEM} from '../../lib/system/platform.js';
import {exists} from '../../lib/system/storage-base.js';
import {clone} from '../../lib/util/clone-object.js';
import {calculateHashOfObj, calculateIdHashOfObj} from '../../lib/util/object.js';
import {wait} from '../../lib/util/promise.js';
import {type SHA256Hash, type SHA256IdHash} from '../../lib/util/type-checks.js';
import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';
import {getCurrentVersionNode} from '../../lib/storage-versioned-objects.js';

import {
    CONFIGURATION,
    ENABLED_LOG_LVLS,
    SERVICE,
    startTestChum,
    waitForObject
} from './_chum-sync-common.js';
import {createWsPromiObj} from './_chum-test-create-ws.js';
import {createBlobsAndClobs} from './_create_blobs.js';
import {createObj, errObjConverter, init} from './_helpers.js';
import type {
    OneTest$BlobAttachment,
    OneTest$ClobAttachment,
    OneTest$Email,
    OneTest$ReferenceTest,
    OneTest$VersionedReferenceTest
} from './_register-types.js';
import type {BobChumOptions} from './chum-sync-bob.js';
import type * as CommmServer from './_communication-server.js';
import {iterateAnyObjects} from '../../lib/util/iterate-objects.js';

const MessageBus = createMessageBus('test:chum-sync-alice');

// THIS IS WRITTEN IN THIS CONVOLUTED WAY to prevent SystemJS (browser) from trying to load
// those modules when it looks for imported modules with static parsing. The comm.server has to
// be started manually on localhost:8000 when running this test on the browser.
const commServerModule = './_communication-server.js';
const CommunicationServer: typeof CommmServer = isBrowser
    ? undefined
    : await import(commServerModule);

/**
 * INCOMPLETE PICTURE: The actual graph below has several cross-links, it is NOT A TREE.
 *
 *                                    root
 *     o1                   o2                             o3
 *  o11  o12       o21  o22  o23  o24                     o31
 * o111           o211                          o311 (2 versions)         o312
 *                o2111                 o3111  o3112  [o3113-semiOrphan]
 *                o21111
 *
 * PARENT => CHILD
 * ===============
 *
 *   root => o1, o2, o3
 *
 *   o1 => o11, o12
 *   o2 => o21, o22, o23, o24
 *   o3 => o31
 *
 *   o11 => o111, o1 (ID), blob0, blob1
 *   o12 => -
 *   o21 => o211
 *   o22 => -
 *   o23 => o21111 (ID)
 *   o24 => o1, o1 (ID)
 *   o31 => o312, o2111 (ID), o311 (ID)
 *
 *   o111 => -
 *   o211 => o2111
 *   o311[0] => o3113-semiOrphan, o3111, o3112
 *   o311[1] => o3111, o3112
 *   o312 => -
 *
 *   o2111 => o21111, o2111 (ID), blob0, clob0, clob1
 *   o3111 => clob0, clob1
 *   o3112 => -
 *   o3113-semiOrphan => -
 *
 *   o21111 => o1 (ID)
 *
 * @param {string} prefix
 * @returns {Promise<*>}
 */
async function createSubTree(
    prefix: string
): Promise<VersionedObjectResult<OneTest$VersionedReferenceTest>> {
    // TEMPLATE
    const o: OneTest$VersionedReferenceTest = {
        $type$: 'OneTest$VersionedReferenceTest',
        name: '',
        versionedRef: [],
        unversionedRef: [],
        idRef: []
    };

    const {
        blobs: [blobResult1, blobResult2],
        clobs: [clobResult1, clobResult2]
    } = await createBlobsAndClobs();

    // Start with the leaf nodes - we need their hashes to construct the parent

    // o1

    const o111: OneTest$VersionedReferenceTest = clone(o);
    o111.name = prefix + 'o111';

    const o11: OneTest$VersionedReferenceTest = clone(o);
    o11.name = prefix + 'o11';
    o11.versionedRef = [await calculateHashOfObj(o111)];
    o11.idRef = [
        // LOOP
        // o1 is not yet defined, let's do it manually - we just need the ID hash
        await calculateIdHashOfObj({
            $type$: 'OneTest$VersionedReferenceTest',
            name: prefix + 'o1'
        })
    ];
    o11.blob = [blobResult1.hash, blobResult2.hash];

    const o12: OneTest$VersionedReferenceTest = clone(o);
    o12.name = prefix + 'o12';

    const o1: OneTest$VersionedReferenceTest = clone(o);
    o1.name = prefix + 'o1';
    o1.versionedRef = [await calculateHashOfObj(o11), await calculateHashOfObj(o12)];

    // o2

    const o21111: OneTest$VersionedReferenceTest = clone(o);
    o21111.name = prefix + 'o21111';
    o21111.idRef = [await calculateIdHashOfObj(o1)];

    const o2111: OneTest$VersionedReferenceTest = clone(o);
    o2111.name = prefix + 'o2111';
    o2111.versionedRef = [await calculateHashOfObj(o21111)];
    o2111.idRef = [
        // ID hash LOOP (to self)
        await calculateIdHashOfObj(o2111)
    ];
    o2111.blob = [blobResult1.hash];
    o2111.clob = [clobResult1.hash, clobResult2.hash];

    const o211: OneTest$VersionedReferenceTest = clone(o);
    o211.name = prefix + 'o211';
    o211.versionedRef = [await calculateHashOfObj(o2111)];

    const o21: OneTest$VersionedReferenceTest = clone(o);
    o21.name = prefix + 'o21';
    o21.versionedRef = [await calculateHashOfObj(o211)];

    const o22: OneTest$VersionedReferenceTest = clone(o);
    o22.name = prefix + 'o22';

    const o23: OneTest$VersionedReferenceTest = clone(o);
    o23.name = prefix + 'o23';
    o23.idRef = [await calculateIdHashOfObj(o21111)];

    const o24: OneTest$VersionedReferenceTest = clone(o);
    o24.name = prefix + 'o24';
    o24.versionedRef = [await calculateHashOfObj(o1)];
    o24.idRef = [await calculateIdHashOfObj(o1)];

    const o2: OneTest$VersionedReferenceTest = clone(o);
    o2.name = prefix + 'o2';
    o2.versionedRef = [
        await calculateHashOfObj(o21),
        await calculateHashOfObj(o22),
        await calculateHashOfObj(o23),
        await calculateHashOfObj(o24)
    ];

    // o3

    const o3111: OneTest$VersionedReferenceTest = clone(o);
    o3111.name = prefix + 'o3111';
    o3111.clob = [clobResult1.hash, clobResult2.hash];

    const o3112: OneTest$VersionedReferenceTest = clone(o);
    o3112.name = prefix + 'o3112';

    // EXTRA: This will be connected to the graph only by an old version of node o311
    const o3113SemiOrphan: OneTest$VersionedReferenceTest = clone(o);
    o3113SemiOrphan.name = prefix + 'o3113-semiOrphan';

    const o311v1: OneTest$VersionedReferenceTest = clone(o);
    o311v1.name = prefix + 'o311';
    // VERSION #1
    o311v1.versionedRef = [
        await calculateHashOfObj(o3113SemiOrphan),
        await calculateHashOfObj(o3111),
        await calculateHashOfObj(o3112)
    ];

    // VERSION #2
    const o311v2: OneTest$VersionedReferenceTest = clone(o311v1);
    o311v2.versionedRef = [await calculateHashOfObj(o3111), await calculateHashOfObj(o3112)];

    const o312: OneTest$VersionedReferenceTest = clone(o);
    o312.name = prefix + 'o312';

    const o31: OneTest$VersionedReferenceTest = clone(o);
    o31.name = prefix + 'o31';
    o31.versionedRef = [await calculateHashOfObj(o312)];
    o31.idRef = [await calculateIdHashOfObj(o2111), await calculateIdHashOfObj(o311v1)];

    const o3: OneTest$VersionedReferenceTest = clone(o);
    o3.name = prefix + 'o3';
    o3.versionedRef = [await calculateHashOfObj(o31)];

    // ROOT

    const root: OneTest$VersionedReferenceTest = clone(o);
    root.name = prefix + 'root';
    root.versionedRef = [
        await calculateHashOfObj(o1),
        await calculateHashOfObj(o2),
        await calculateHashOfObj(o3)
    ];

    // SERIALIZED TO GUARANTEE FIXED SEQUENCE (for version map entries specifically)
    for (const oo of [
        o3113SemiOrphan,
        o3111,
        o3112,
        o312,
        o22,
        o111,
        o12,
        o311v1,
        o311v2,
        o21111,
        o2111,
        o211,
        o21,
        o23,
        o11,
        o1,
        o24,
        o2,
        o31,
        o3
    ]) {
        await storeVersionedObject(oo);
    }

    return await storeVersionedObject(root);
}

async function createTestRoot(
    name: string,
    iterations: number
): Promise<VersionedObjectResult<OneTest$VersionedReferenceTest>> {
    const o: OneTest$VersionedReferenceTest = {
        $type$: 'OneTest$VersionedReferenceTest',
        name,
        versionedRef: []
    };

    for (let i = 1; i <= iterations; i++) {
        const root = await createSubTree(`t-${i}-`);
        o.versionedRef?.push(root.hash);
    }

    return await storeVersionedObject(o);
}

// const COLOR_CODES = new Map([
//     ['1', 'font-weight: bold;'],
//     ['22', 'font-weight: normal;'],
//     ['30', 'color: black;'],
//     ['31', 'color: red;'],
//     ['32', 'color: green;'],
//     ['33', 'color: gray;'], // yellow, but that is hard to read on white browser background
//     ['34', 'color: blue;'],
//     ['35', 'color: magenta;'],
//     ['36', 'color: cyan;'],
//     ['37', 'color: white;'],
//     ['41', 'background-color: red;'],
//     ['42', 'background-color: green;'],
//     ['43', 'background-color: yellow;'],
//     ['44', 'background-color: blue;'],
//     ['45', 'background-color: magenta;'],
//     ['46', 'background-color: cyan;'],
//     ['47', 'background-color: white;']
// ]);

function translateAsciiColorCodeToCss(message: string): string {
    return message.replace(
        // eslint-disable-next-line no-control-regex
        /\x1B\[([0-9]{1,2})m/g,
        (_match, _p1, _offset, _string, _groups) => {
            // const css = COLOR_CODES.get(p1);

            // if (css === undefined) {
            //     return '';
            // }

            // return '%c';
            return '';
        }
    );
}

// setProtocolVersion(4);

describe('ChumSync Alice tests', () => {
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

    async function bobOnGoingChum(): Promise<VersionedObjectResult<Chum>> {
        return (await bobConnection.send(SERVICE.onGoingChum)) as VersionedObjectResult<Chum>;
    }

    async function bobGrantAccess(
        accessRequests: SetAccessParam[]
    ): Promise<Array<VersionedObjectResult<Access | IdAccess>>> {
        return (await bobConnection.send(SERVICE.grantAccess, accessRequests)) as Array<
            VersionedObjectResult<Access | IdAccess>
        >;
    }

    async function bobCheckExistence(hash: SHA256Hash<HashTypes> | SHA256IdHash): Promise<boolean> {
        return (await bobConnection.send(SERVICE.checkExistence, hash)) as boolean;
    }

    async function bobWaitForObject(
        hash: SHA256Hash<HashTypes> | SHA256IdHash,
        maxWait: number = 5000
    ): Promise<boolean> {
        return (await bobConnection.send(SERVICE.waitForObject, hash, maxWait)) as boolean;
    }

    async function bobCreateObj<T extends OneObjectTypes>(obj: T): Promise<AnyObjectCreation<T>> {
        return (await bobConnection.send(SERVICE.createObj, obj)) as AnyObjectCreation<T>;
    }

    // async function bobReportMemoryUsage(): Promise<NodeJS.MemoryUsageFn> {
    //     return (await bobConnection.send(SERVICE.reportMemoryUsage)) as NodeJS.MemoryUsageFn;
    // }

    let bobIdRef: SHA256IdHash<Person>;
    let aliceIdRef: SHA256IdHash<Person>;

    // let instance;

    before(async () => {
        startLogger({includeInstanceName: true, types: ENABLED_LOG_LVLS});

        await import(`../../lib/system/load-${SYSTEM}.js`);

        if (CommunicationServer !== undefined) {
            CommunicationServer.stopCommServer();
            CommunicationServer.startCommServer({silent: true});
        }

        bobConnection = await createWsPromiObj('AliceControl', 'BobControl', 'Bob');

        bobConnection.addService(SERVICE.log, (messages: string[]) => {
            // The log level of the message is in the 2nd position
            if (!ENABLED_LOG_LVLS.includes(messages[1] as any)) {
                return;
            }

            console.log(...messages.map(m => translateAsciiColorCodeToCss(m)));
        });
        bobConnection.addService(SERVICE.error, (messages: string[]) => {
            console.error(...messages.map(m => translateAsciiColorCodeToCss(m)));
        });
    });

    beforeEach(async () => {
        await Promise.all([
            bobInit(),
            init({
                email: CONFIGURATION.alice.initialDataObj.email,
                name: CONFIGURATION.alice.initialDataObj.instanceName
            })
        ]);

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

    it('should run a full sync of no accessible objects', async function test12() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const bobPromise = bobConnection.send(SERVICE.emptyChum);

        try {
            const chum = startTestChum(
                Object.assign(defaultInitialChumObj, {
                    connection: await createWsPromiObj()
                })
            );
            await chum.promise;
        } catch (err) {
            MessageBus.send('error', err);
            expect(false, err).to.be.true;
        }

        await bobPromise;
    });

    it('should run a full sync of no accessible objects with delayed start of Bob', async function test13() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const bobPromise = wait(1000)
            .then(() => bobEmptyChum())
            .catch(err => MessageBus.send('error', err));

        try {
            const chum = startTestChum(
                Object.assign(defaultInitialChumObj, {
                    connection: await createWsPromiObj()
                })
            );
            await chum.promise;
        } catch (err) {
            MessageBus.send('error', err);
            expect(false, err).to.be.true;
        }

        await bobPromise;
    });

    it('should run a full sync with object access', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(5000);

        const testRes = await createObj({
            $type$: 'Person',
            email: 'testperson@mail.com'
        } as Person);

        await createAccess([
            {
                object: testRes.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const bobPromise: Promise<VersionedObjectResult<Chum>> = bobEmptyChum();

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

        // Tell bob to check for the testPersonObj it should have arrived after the chum sync
        const result = await bobCheckExistence(testRes.hash);

        expect(result).to.equal(true);

        const bob = await bobPromise;

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);
    });

    it('should run a full sync with ID object access', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const testRes1 = await createObj({
            $type$: 'Person',
            email: 'testperson@mail.com'
        } as Person);

        const testRes2 = await createObj({
            $type$: 'Person',
            email: 'testperson@mail.com',
            name: 'Franz'
        } as Person);

        const testRes3 = await createObj({
            $type$: 'Person',
            email: 'testperson@mail.com',
            name: 'Franz Müller'
        } as Person);

        await createAccess([
            {
                id: testRes1.idHash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const bobPromise = bobEmptyChum();

        bobPromise.catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alice = await startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj()
            })
        ).promise;

        const result = await Promise.all([
            bobCheckExistence(testRes1.hash),
            bobCheckExistence(testRes2.hash),
            bobCheckExistence(testRes3.hash)
        ]);

        expect(result).to.deep.equal([true, true, true]);

        const bob = await bobPromise;

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);
    });

    it.skip('should run a full sync and merge versioned object history', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const email = 'testperson@mail.com';

        const testRes1 = await createObj({
            $type$: 'Person',
            email,
            name: 'Franz the First'
        } as Person);

        const testRes2 = await createObj({
            $type$: 'Person',
            email,
            name: 'Franz the Second'
        } as Person);

        const testRes3 = await createObj({
            $type$: 'Person',
            email,
            name: 'Franz the Third'
        } as Person);

        const testRes4 = await createObj({
            $type$: 'Person',
            email,
            name: 'Franz the Fourth'
        } as Person);

        const testRes5 = await createObj({
            $type$: 'Person',
            email,
            name: 'Franz the Fifth'
        } as Person);

        await createAccess([
            {
                id: testRes1.idHash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const bobPromise = bobEmptyChum();

        bobPromise.catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alice = await startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj()
            })
        ).promise;

        const result = await Promise.all([
            bobCheckExistence(testRes1.hash),
            bobCheckExistence(testRes2.hash),
            bobCheckExistence(testRes3.hash),
            bobCheckExistence(testRes4.hash),
            bobCheckExistence(testRes5.hash)
        ]);

        expect(result).to.deep.equal([true, true, true, true, true]);

        const bob = await bobPromise;

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);
    });

    it('should run a full sync and then remain connected and send new accessible objects', async function test15() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        // ##################################################################################
        // Create initial objects on Alice (for the full sync. part)
        // ##################################################################################

        const testPersonObjResult = await createObj({
            $type$: 'Person',
            email: 'onGoingChumtestperson@mail.com'
        } as Person);

        // Create new Access object for the person ID "Bob" is logged in on "Alice"
        // NOTE: ID hash link so that "new version" updates can be tested
        await createAccess([
            {
                object: testPersonObjResult.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // Create initial objects on Bob (for the full sync. part)
        // ##################################################################################

        const person1Result = await bobCreateObj({
            $type$: 'Person',
            email: 'demo1@demo.org'
        } as Person);

        expect(person1Result.status).to.equal('new');
        expect(person1Result.obj.$type$).to.equal('Person');

        // "OneTest$Email" is versioned (makes no sense, but it's just for the tests) - create
        // one version now, one version later
        const email1Result = await bobCreateObj({
            $type$: 'OneTest$Email',
            messageID: '1-dummy-123.123@dummy.com',
            from: [person1Result.idHash],
            to: [person1Result.idHash],
            cc: [],
            date: 1438418318010,
            subject: 'Nothing'
        } as OneTest$Email);

        expect(email1Result.status).to.equal('new');
        expect(email1Result.obj.$type$).to.equal('OneTest$Email');

        // Create new Access object for the person ID "Alice" is logged in on "Bob"
        // NOTE: ID hash link so that "new version" updates can be tested
        // GRANTS ACCESS TO THREE OBJECTS: OneTest$Email (direct), Person, Person (through
        // OneTest$Email) Type: Array<VersionedObjectResult<Access>>
        await bobGrantAccess([
            {
                id: email1Result.idHash,
                person: [aliceIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // START CHUMS on both Alice and Bob
        // ##################################################################################

        const bobPromise = bobOnGoingChum();

        // In case there is a process-stopping error between bob-promise creation and the
        // "await" of that promise further down below
        bobPromise.catch((e: any) => MessageBus.send('error', 'BOB ERROR:', e));

        const connection = await createWsPromiObj();

        const alicePromise = startTestChum(
            Object.assign(
                {},
                Object.assign(defaultInitialChumObj, {
                    connection
                }),
                {
                    keepRunning: true
                }
            )
        ).promise;

        // In case there is a process-stopping error between promise creation and the
        // "await" of that promise further down below
        alicePromise.catch(e => MessageBus.send('error', 'ALICE:', e));

        // ##################################################################################
        // Give the chum sync some time to find and transfer the testObj
        // ##################################################################################

        const result1 = await bobWaitForObject(testPersonObjResult.hash);

        expect(result1).to.equal(true);

        // ##################################################################################
        // CREATE A NEW VERSION ON ALICE
        // ##################################################################################

        // ACCESS ALREADY GRANTED TO ID HASH
        const altVersionObjRes = await createObj({
            $type$: 'Person',
            email: 'onGoingChumtestperson@mail.com'
        } as Person);

        // ##################################################################################
        // CREATE NEW OBJECTS ON BOB
        // ##################################################################################

        // NO ACCESS TO THIS OBJECT YET
        const person2Result = await bobCreateObj({
            $type$: 'Person',
            email: 'other@gigi.org'
        } as Person);

        expect(person2Result.status).to.equal('new');
        expect(person2Result.obj.$type$).to.equal('Person');

        // NO ACCESS TO THIS OBJECT YET
        const email2Result = await bobCreateObj({
            $type$: 'OneTest$Email',
            messageID: '2-dummy-123.123@dummy.com',
            from: [person1Result.idHash],
            to: [person1Result.idHash, person2Result.idHash],
            cc: [],
            date: 1438418318011,
            subject: 'Zwei Anhänge'
        } as OneTest$Email);

        expect(email2Result.status).to.equal('new');
        expect(email2Result.obj.$type$).to.equal('OneTest$Email');

        // ##################################################################################
        // Give the chum sync some time to find and transfer the new objects
        // ##################################################################################

        // CHECK ON BOB

        const result2 = await bobWaitForObject(altVersionObjRes.hash);

        expect(result2).to.equal(true);

        // CHECK ON ALICE

        expect(await exists(person1Result.idHash as SHA256IdHash)).to.equal(true);
        expect(await exists(person1Result.hash)).to.equal(false);
        expect(await exists(person2Result.idHash as SHA256IdHash)).to.equal(false);
        expect(await exists(person2Result.hash)).to.equal(false);
        expect(await exists(email2Result.idHash as SHA256IdHash)).to.equal(false);
        expect(await exists(email2Result.hash)).to.equal(false);

        // ##################################################################################
        // Give access to the Email and through it *indirectly* tp person2
        // ##################################################################################

        await bobGrantAccess([
            {
                object: email2Result.hash,
                person: [bobIdRef, aliceIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // Give the chum sync some time to find and transfer the new objects
        // ##################################################################################

        // CHECK ON ALICE

        const result5_1 = await waitForObject(person1Result.idHash as SHA256IdHash);
        expect(result5_1).to.equal(true);

        const result5 = await waitForObject(person2Result.idHash as SHA256IdHash);
        expect(result5).to.equal(true);

        const result6 = await waitForObject(email2Result.hash);
        expect(result6).to.equal(true);

        await wait(1000);

        // ##################################################################################
        // THE END - Stop the synchronization
        // ##################################################################################

        connection.close();

        try {
            const [bob, alice] = await Promise.all([bobPromise, alicePromise]);

            if (alice?.obj?.errors.length > 0) {
                MessageBus.send('error', 'ALICE ERRORS:');
                alice?.obj?.errors.forEach((err: any) => MessageBus.send('error', err));
            }

            if (bob?.obj?.errors.length > 0) {
                MessageBus.send('error', 'BOB ERRORS:');
                bob?.obj?.errors.forEach((err: any) => MessageBus.send('error', err));
            }

            expect(alice?.obj?.errors.length ?? 0).to.equal(0);
            expect(bob?.obj?.errors.length ?? 0).to.equal(0);
        } catch (err) {
            MessageBus.send('error', err);
            expect(false, err).to.be.true;
        }
    });

    it('should transfer blobs and clobs', async function test30() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        // ##################################################################################
        // Create initial objects on Alice (for the full sync. part)
        // ##################################################################################

        const testPersonObjResult = await createObj({
            $type$: 'Person',
            email: 'onGoingChumtestperson@mail.com'
        } as Person);

        // Create new Access object for the person ID "Bob" is logged in on "Alice"
        // NOTE: ID hash link so that "new version" updates can be tested
        await createAccess([
            {
                object: testPersonObjResult.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // Create initial objects on Bob (for the full sync. part)
        // ##################################################################################

        const person1Result = await bobCreateObj({
            $type$: 'Person',
            email: 'demo1@demo.org'
        } as Person);

        expect(person1Result.status).to.equal('new');
        expect(person1Result.obj.$type$).to.equal('Person');

        // ##################################################################################
        // START CHUMS on both Alice and Bob
        // ##################################################################################

        const bobPromise = bobOnGoingChum();

        const connection = await createWsPromiObj();

        const alicePromise = startTestChum(
            Object.assign(
                {},
                Object.assign(defaultInitialChumObj, {
                    connection
                }),
                {
                    keepRunning: true
                }
            )
        ).promise;

        // ##################################################################################
        // Give the chum sync some time to find and transfer the testObj
        // ##################################################################################

        expect(await bobWaitForObject(testPersonObjResult.hash)).to.equal(true);

        // ##################################################################################
        // CREATE CLOBs and BLOBs
        // ##################################################################################

        const refs = await createBlobsAndClobs();
        const refsObj = await storeUnversionedObject({
            $type$: 'OneTest$ReferenceTest',
            blob: refs.blobs.map(({hash}) => hash),
            clob: refs.clobs.map(({hash}) => hash)
        } as OneTest$ReferenceTest);

        await createAccess([
            {
                object: refsObj.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const blobAttachmentRes = await createObj({
            $type$: 'OneTest$BlobAttachment',
            dataType: 'html',
            data: refs.blobs[0].hash
        } as OneTest$BlobAttachment);

        const clobAttachmentRes = await createObj({
            $type$: 'OneTest$ClobAttachment',
            dataType: 'html',
            data: refs.clobs[0].hash
        } as OneTest$ClobAttachment);

        await createAccess([
            {
                object: blobAttachmentRes.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            },
            {
                object: clobAttachmentRes.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // Give the chum sync some time to find and transfer the altVersionObjRes
        // ##################################################################################

        expect(await bobWaitForObject(clobAttachmentRes.hash)).to.equal(true);
        expect(await bobWaitForObject(blobAttachmentRes.hash)).to.equal(true);

        await wait(250);

        // ##################################################################################
        // THE END - Stop the synchronization
        // ##################################################################################

        connection.close();

        let _bob, _alice;

        try {
            [_bob, _alice] = await Promise.all([bobPromise, alicePromise]);

            // TODO Connection Closed errors
            // expect(
            //     _alice?.obj?.errors.length ?? 0,
            //     'Alice: ' + alice?.obj?.errors.map((o: any) => o.message).join('\n')
            // ).to.equal(0);
            // expect(
            //     _bob?.obj?.errors.length ?? 0,
            //     'Bob: ' + bob?.obj?.errors.map((o: any) => o.message).join('\n')
            // ).to.equal(0);
        } catch (err) {
            // Filter out "Connection closed with # requests still pending"
            if (err.code !== 'WSP-ONCL') {
                expect(false, 'Error in Alice or Bob').to.be.true;
                MessageBus.send('error', err);
            }
        }
    });

    it('should not transfer data without access', async function test31() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        // Start ongoing chum sync from bobs side
        const bobPromise = bobOnGoingChum();

        // In case there is a process-stopping error between bob-promise creation and the
        // "await" of that promise further down below
        bobPromise.catch(err => MessageBus.send('error', err));

        const connection = await createWsPromiObj();

        const alicePromise = startTestChum(
            Object.assign(
                {},
                Object.assign(defaultInitialChumObj, {
                    connection
                }),
                {
                    keepRunning: true
                }
            )
        ).promise;

        // In case there is a process-stopping error between promise creation and the
        // "await" of that promise further down below
        alicePromise.catch(err => MessageBus.send('error', err));

        // ##################################################################################
        // Give the chum sync some time to finish the initial full sync
        // ##################################################################################
        await wait(1000);

        const testObjResult = await createObj({
            $type$: 'Person',
            email: 'onGoingChumtestperson@mail.com'
        } as Person);

        // ##################################################################################
        // Give the chum sync some time to find and transfer the testObj which it shouldn't.
        // ##################################################################################

        const result1 = await bobWaitForObject(testObjResult.hash, 1000);

        expect(result1).to.equal(false);

        // ##################################################################################
        // THE END - Stop the synchronization
        // ##################################################################################

        connection.close();

        try {
            const [bob, alice] = await Promise.all([bobPromise, alicePromise]);
            expect(alice?.obj?.errors.length ?? 0).to.equal(0);
            expect(bob?.obj?.errors.length ?? 0).to.equal(0);
        } catch (err) {
            MessageBus.send('error', err);
            expect(false, err).to.be.true;
        }
    });

    // TODO Add "IdAccess" and newGroup and newAccess object and new version of "IdAccess" ID hash
    //  tests

    it('should run a full sync with many objects (Access)', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(20000);

        const N = 2;

        const testResInitial: Array<VersionedObjectResult<OneTest$VersionedReferenceTest>> = [];

        for (let i = 1; i <= N; i++) {
            testResInitial.push(await createTestRoot(`tree-${i}`, i + 5));

            await createAccess([
                {
                    object: testResInitial[i - 1].hash,
                    person: [bobIdRef],
                    group: [],
                    mode: SET_ACCESS_MODE.REPLACE
                }
            ]);
        }

        const bobPromise = bobEmptyChum();

        bobPromise.catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alice = await startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj()
            })
        ).promise;

        for (let i = 1; i <= N; i++) {
            expect(await bobCheckExistence(testResInitial[i - 1].hash)).to.equal(true);
        }

        const bob = await bobPromise;

        const expectedObjHashes = new Set<SHA256Hash>();
        const expectedIdHashes = new Set<SHA256IdHash>();
        const expectedBlobHashes = new Set<SHA256Hash<BLOB>>();
        const expectedClobHashes = new Set<SHA256Hash<CLOB>>();

        for (let i = 1; i <= N; i++) {
            const currentNode = await getCurrentVersionNode(testResInitial[i - 1].idHash);
            await iterateAnyObjects(
                [currentNode.obj],
                {
                    referenceToObj: args => {
                        for (const hash of args.values) {
                            expectedObjHashes.add(hash);
                        }
                    },
                    referenceToId: args => {
                        for (const hash of args.values) {
                            expectedIdHashes.add(hash);
                        }
                    },
                    referenceToBlob: args => {
                        for (const hash of args.values) {
                            expectedBlobHashes.add(hash);
                        }
                    },
                    referenceToClob: args => {
                        for (const hash of args.values) {
                            expectedClobHashes.add(hash);
                        }
                    }
                },
                {iterateChildObjects: true, iterateChildIdObjects: true},
                false
            );
        }

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);

        for (const collection of [
            expectedObjHashes,
            expectedIdHashes,
            expectedBlobHashes,
            expectedClobHashes
        ]) {
            for await (const hash of collection) {
                expect(await bobCheckExistence(hash)).to.equal(true);
            }
        }

        expect(alice.obj.AtoBObjects.length).to.equal(expectedObjHashes.size);
        // o21111 is referenced as ID but also as an object, and when the object is created
        // first then the ID object is too, and then it already exists when the ID hash link is
        // reached
        // expect(alice.obj.AtoBIdObjects.length).to.equal(expectedIdHashes.size - (N + 5));
        expect(alice.obj.AtoBBlob.length).to.equal(expectedBlobHashes.size);
        expect(alice.obj.AtoBClob.length).to.equal(expectedClobHashes.size);

        expect(alice.obj.BtoAObjects.length).to.equal(0);
        expect(alice.obj.BtoAIdObjects.length).to.equal(0);
        expect(alice.obj.BtoABlob.length).to.equal(0);
        expect(alice.obj.BtoAClob.length).to.equal(0);

        expect(bob.obj.BtoAObjects.length).to.equal(expectedObjHashes.size);
        // o21111 is referenced as ID but also as an object, and when the object is created
        // first then the ID object is too, and then it already exists when the ID hash link is
        // reached
        // expect(bob.obj.BtoAIdObjects.length).to.equal(expectedIdHashes.size - (N + 5));
        expect(bob.obj.BtoABlob.length).to.equal(expectedBlobHashes.size);
        expect(bob.obj.BtoAClob.length).to.equal(expectedClobHashes.size);

        expect(bob.obj.AtoBObjects.length).to.equal(0);
        expect(bob.obj.AtoBIdObjects.length).to.equal(0);
        expect(bob.obj.AtoBBlob.length).to.equal(0);
        expect(bob.obj.AtoBClob.length).to.equal(0);
    });

    it('should run a full sync with many objects (IdAccess)', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(20000);

        const N = 2;

        const testResInitial: Array<VersionedObjectResult<OneTest$VersionedReferenceTest>> = [];

        for (let i = 1; i <= N; i++) {
            testResInitial.push(await createTestRoot('tree-root', i + 5));
        }

        await createAccess([
            {
                id: testResInitial[0].idHash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const bobPromise = bobEmptyChum();

        bobPromise.catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alice = await startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj()
            })
        ).promise;

        for (let i = 1; i < 1; i++) {
            expect(await bobCheckExistence(testResInitial[i].hash)).to.equal(true);
        }

        const bob = await bobPromise;

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);
    });

    it.skip('should run a full sync with many objects (keepRunning)', async function test14() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(20000);

        const testResInitial = await createTestRoot('tree-root', 1);

        await createAccess([
            {
                id: testResInitial.idHash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        const bobPromise = bobEmptyChum();

        bobPromise.catch(e => MessageBus.send('error', 'BOB ERROR:', e));

        const alicePromise = startTestChum(
            Object.assign(defaultInitialChumObj, {
                connection: await createWsPromiObj(),
                keepRunning: true
            })
        ).promise;

        for (let i = 1; i < 1; i++) {
            expect(await waitForObject(testResInitial.hash)).to.equal(true);
        }

        const alice = await alicePromise;
        const bob = await bobPromise;

        expect(alice?.obj?.errors.length ?? 0).to.equal(0);
        expect(bob?.obj?.errors.length ?? 0).to.equal(0);
    });

    it('should handle premature connfection closing', async function test32() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(10000);

        const errors: string[] = [];
        MessageBus.on('error', (src, err) => {
            errors.push(src + ': ' + String(err));
        });

        // Start ongoing chum sync from bobs side
        const bobPromise = bobOnGoingChum();

        // In case there is a process-stopping error between bob-promise creation and the
        // "await" of that promise further down below
        bobPromise.catch(err => MessageBus.send('error', 'BOB', err));

        // ##################################################################################
        // Start full sync
        // ##################################################################################

        const connection = await createWsPromiObj();

        const alicePromise = startTestChum(
            Object.assign(
                defaultInitialChumObj,
                {
                    connection
                },
                {
                    keepRunning: true
                }
            )
        ).promise;

        // In case there is a process-stopping error between promise creation and the
        // "await" of that promise further down below
        alicePromise.catch(err => MessageBus.send('error', 'ALICE', err));

        // ##################################################################################
        // Give the chum sync some time to finish the initial full sync
        // ##################################################################################

        await wait(1000);

        // ##################################################################################
        // Create objects and give access
        // ##################################################################################

        const testPersonObjResult = await createObj({
            $type$: 'Person',
            email: 'onGoingChumtestperson@mail.com'
        } as Person);

        await createAccess([
            {
                object: testPersonObjResult.hash,
                person: [bobIdRef],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);

        // ##################################################################################
        // Do NOT allow any time to pass before closing the connection!
        // ##################################################################################

        connection.close();

        let bob: VersionedObjectResult<Chum>;
        let alice: VersionedObjectResult<Chum>;

        try {
            [bob, alice] = await Promise.all([bobPromise, alicePromise]);
        } catch (err) {
            expect(false, err).to.be.true;
            throw err;
        }

        expect(
            alice?.obj?.errors.length ?? 0,
            JSON.stringify(alice?.obj?.errors, errObjConverter, 4)
        ).to.equal(0);
        expect(
            bob?.obj?.errors.length ?? 0,
            JSON.stringify(bob?.obj?.errors, errObjConverter, 4)
        ).to.equal(0);

        // ##################################################################################
        // Bob should not have received the object yet
        // ##################################################################################

        const result1 = await bobCheckExistence(testPersonObjResult.hash);

        expect(result1).to.equal(false);

        // ##################################################################################
        // Wait a bit and see if there are any errors reported after the chum already ended
        // ##################################################################################

        await wait(1000);

        // TODO Different error that now needs to come from the importer, not yet implemented

        expect(errors.length).to.equal(0); // FOR NOW

        // expect(errors.length, errors.join('\n')).to.equal(1);
        // expect(errors[0]).to.include('Chum exporter iterator FAILED to complete');
    });

    afterEach(async () => {
        MessageBus.send('log', 'TEST SETUP "AFTER EACH"');
        await bobDeleteTestDB();
        await closeAndDeleteCurrentInstance();
    });

    after(async () => {
        MessageBus.send('log', 'END OF CHUM TESTS - Cleaning up');

        if (CommunicationServer !== undefined) {
            CommunicationServer.stopCommServer();
        }

        if(bobConnection !== undefined) {
            bobConnection.clearServices();
            bobConnection.close();
        }

        stopLogger();
    });
});
