/* eslint-disable no-console, arrow-parens, no-await-in-loop */

/*
 * If you want to adjust the directory you will have to do it here and in chumSyncTestBob
 * Conf.NAME.initialDataObj.directory
 * @file
 */

import {createAccess} from '../../lib/access.js';
import {closeInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import type {BLOB, CLOB} from '../../lib/recipes.js';
import type {FileCreation} from '../../lib/storage-base-common.js';
import {SET_ACCESS_MODE} from '../../lib/storage-base-common.js';
import {storeUTF8Clob} from '../../lib/storage-blob.js';
import type {UnversionedObjectResult} from '../../lib/storage-unversioned-objects.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {createRandomString} from '../../lib/system/crypto-helpers.js';
import {listAllIdHashes} from '../../lib/system/storage-base.js';
import {createFileWriteStream} from '../../lib/system/storage-streams.js';
import {isInteger, isString} from '../../lib/util/type-checks-basic.js';

import {CONFIGURATION} from './_chum-sync-common.js';
import {init, objWithNumberValuesToReadableStr} from './_helpers.js';
import type {OneTest$Email, OneTest$KeyValueMap, OneTest$ReferenceTest} from './_register-types.js';

/* ========================================================================================
 * LEAF NODE OBJECTS
 * ======================================================================================== */

async function createTestFiles(
    moduleCreateRandomString: typeof createRandomString,
    depth: number = 1000,
    previousLastRoot?: UnversionedObjectResult<OneTest$ReferenceTest>
): Promise<UnversionedObjectResult<OneTest$ReferenceTest>> {
    function createRandKVMapObj(): Promise<UnversionedObjectResult<OneTest$KeyValueMap>> {
        return storeUnversionedObject({
            $type$: 'OneTest$KeyValueMap',
            name: `Demo Map ${Math.floor(Math.random() * 10000)}`,
            keyJsType: 'string',
            valueJsType: 'string',
            item: Array.from({length: Math.floor(Math.random() * 26) + 2}, (_x, i) => ({
                key: String(i * 10),
                value: [String(i * 100)]
            }))
        });
    }

    async function createRandEmailObj(
        versionCount: number = 1
    ): Promise<VersionedObjectResult<OneTest$Email>> {
        const messageId = await moduleCreateRandomString(64);

        // To create "many" for ID references; will not run when creating only 1 email object
        for (let i = 0; i < versionCount - 1; i++) {
            // eslint-disable-next-line no-await-in-loop
            await storeVersionedObject({
                $type$: 'OneTest$Email',
                messageID: messageId,
                date: Date.now() - Math.floor(Math.random() * 10000),
                // eslint-disable-next-line no-await-in-loop
                subject: await moduleCreateRandomString(100)
            });
        }

        // The only object created when versionCount is 1. When creating many, any of them can
        // be returned, because the ID hash is the same.
        return await storeVersionedObject({
            $type$: 'OneTest$Email',
            messageID: messageId,
            date: Date.now() - Math.floor(Math.random() * 10000),
            subject: await moduleCreateRandomString(100)
        });
    }

    async function createRandomBlob(): Promise<FileCreation<BLOB>> {
        const blob1Stream = createFileWriteStream();
        blob1Stream.promise.catch(err => console.log(err));

        for (let i = 1; i < Math.floor(Math.random() * 32) + 2; i++) {
            const uint8Array = new Uint8Array(256);

            for (let j = 0; j < uint8Array.byteLength; j++) {
                uint8Array[j] = (i * j) % 255;
            }

            blob1Stream.write(uint8Array.buffer);
        }

        return await blob1Stream.end();
    }

    async function createRandomClob(): Promise<FileCreation<CLOB>> {
        return await storeUTF8Clob(
            await moduleCreateRandomString(Math.floor(Math.random() * 2049) + 100)
        );
    }

    let lastRoot: UnversionedObjectResult<OneTest$ReferenceTest> | undefined = previousLastRoot;

    for (let i = 0; i < depth; i++) {
        lastRoot = await storeUnversionedObject({
            $type$: 'OneTest$ReferenceTest',
            versionedRef: Math.random() < 0.6 ? [(await createRandEmailObj()).hash] : undefined,
            unversionedRef: lastRoot ? [lastRoot.hash] : [(await createRandKVMapObj()).hash],
            idRef:
                Math.random() < 0.01
                    ? [(await createRandEmailObj(Math.floor(Math.random() * 100))).idHash]
                    : undefined,
            blob: Math.random() < 0.1 ? [(await createRandomBlob()).hash] : undefined,
            clob: Math.random() < 0.1 ? [(await createRandomClob()).hash] : undefined
        });
    }

    if (lastRoot === undefined) {
        throw new Error('lastRoot is undefined, "depth": ' + depth);
    }

    return lastRoot;
}

// const MessageBus = createMessageBus('test:large-db-create-files');

let reportInterval: undefined | NodeJS.Timeout;

async function setupStorage(name: string, nrOfTrees: number, depthOfTrees: number): Promise<void> {
    if (!isString(name) || !isInteger(nrOfTrees) || !isInteger(depthOfTrees)) {
        throw new Error('Function requires a string and two numeric parameters');
    }

    await init({
        email: CONFIGURATION.alice.initialDataObj.email,
        name: CONFIGURATION.alice.initialDataObj.instanceName + name,
        deleteDb: false,
        initiallyEnabledReverseMapTypes: [],
        initiallyEnabledReverseMapTypesForIdObjects: []
    });

    // Crude method to prevent recreating already existing files - to spare SSDs from
    // getting many useless writes
    const idHashes = await listAllIdHashes();

    if (idHashes.length > 20) {
        console.log('Test files already exist');
        return;
    }

    const [, bobCreationResult] = await Promise.all([
        storeVersionedObject(CONFIGURATION.alice.person),
        storeVersionedObject(CONFIGURATION.bob.person)
    ]);

    console.log(
        'TEST FILE CREATION [START]: ',
        objWithNumberValuesToReadableStr(process.memoryUsage())
    );

    reportInterval = setInterval(() => {
        console.log('ALICE: ', objWithNumberValuesToReadableStr(process.memoryUsage()));
    }, 1000);

    const testFileCreationStart = Date.now();

    /* ===================================================================
     * Each iteration creates a new deep graph that has to be iterated
     * over by the chum-exporter: EDIT NR OF ITERATIONS
     * =================================================================== */
    for (let nrAccessibleGraphs = 0; nrAccessibleGraphs < nrOfTrees; nrAccessibleGraphs++) {
        // const root = await createTestFiles(
        //     createRandomString,
        //     /* ===================================================================
        //      * EDIT GRAPH DEPTH HERE
        //      * =================================================================== */
        //     15000
        // );
        // await createAccess([{
        //     object: root.hash,
        //     person: [bobIdRef],
        //     group: [],
        //     mode: SET_ACCESS_MODE.REPLACE
        // });

        const root = await createTestFiles(createRandomString, depthOfTrees);

        await createAccess([
            {
                object: root.hash,
                person: [bobCreationResult.idHash],
                group: [],
                mode: SET_ACCESS_MODE.REPLACE
            }
        ]);
    }

    clearInterval(reportInterval);

    console.log(
        `TEST FILE CREATION [DONE]: ${Math.round((Date.now() - testFileCreationStart) / 1000)} s\n`,
        objWithNumberValuesToReadableStr(process.memoryUsage())
    );

    closeInstance();
}

async function run(): Promise<void> {
    await setupStorage('-large-deep', 10, 2500);
    await setupStorage('-large-shallow', 2500, 10);
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
