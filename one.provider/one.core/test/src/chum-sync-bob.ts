/* eslint-disable no-console, arrow-parens */

/**
 * @file The node.js side of an Alice-Bob chum connection. Alice, the other part, can run on
 * node.js too, or in a browser.
 */

import {createAccess} from '../../lib/access.js';
import type {ChumSyncOptions} from '../../lib/chum-sync.js';
import {closeAndDeleteCurrentInstance} from '../../lib/instance.js';
import {startLogger, stopLogger} from '../../lib/logger.js';
import {createMessageBus} from '../../lib/message-bus.js';
import type {Chum, Instance, Person} from '../../lib/recipes.js';
import type {VersionedObjectResult} from '../../lib/storage-versioned-objects.js';
import {storeVersionedObject} from '../../lib/storage-versioned-objects.js';
import {SYSTEM} from '../../lib/system/platform.js';
import {exists} from '../../lib/system/storage-base.js';
import type {AnyFunction} from '../../lib/util/function.js';
import {calculateIdHashOfObj} from '../../lib/util/object.js';
import {isObject, isString} from '../../lib/util/type-checks-basic.js';
import type {SHA256IdHash} from '../../lib/util/type-checks.js';
import {ensureHash, ensureIdHash} from '../../lib/util/type-checks.js';
import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';

import {
    CONFIGURATION,
    ENABLED_LOG_LVLS,
    SERVICE,
    startTestChum,
    waitForObject
} from './_chum-sync-common.js';
import {createWsPromiObj} from './_chum-test-create-ws.js';
import * as StorageHelpers from './_helpers.js';

const MessageBus = createMessageBus('test:chum-sync-bob');

// setProtocolVersion(3);

async function init(): Promise<Instance> {
    MessageBus.send('log', 'init');

    const instance = await StorageHelpers.init({
        email: CONFIGURATION.bob.initialDataObj.email,
        name: CONFIGURATION.bob.initialDataObj.instanceName
    });

    // need to store both users for the authentication to work
    await Promise.all([
        storeVersionedObject(CONFIGURATION.alice.person),
        storeVersionedObject(CONFIGURATION.bob.person)
    ]);

    return instance;
}

export interface BobChumOptions {
    bobPersonId?: SHA256IdHash<Person>;
    alicePersonId?: SHA256IdHash<Person>;
    bobInstanceName?: string;
    aliceInstanceName?: string;
    keepRunning?: boolean;
}

function ensureBobChumOptionsOrUndefined(opts: unknown): BobChumOptions {
    if (opts === undefined) {
        return {};
    }

    if (!isObject(opts)) {
        throw new Error('Data not an object');
    }

    if (opts.bobPersonId !== undefined) {
        ensureIdHash(opts.bobPersonId);
    }

    if (opts.alicePersonId !== undefined) {
        ensureIdHash(opts.alicePersonId);
    }

    if (opts.bobInstanceName !== undefined && !isString(opts.bobInstanceName)) {
        throw new Error('opts.bobInstanceName is not a string');
    }

    if (opts.aliceInstanceName !== undefined && !isString(opts.aliceInstanceName)) {
        throw new Error('opts.aliceInstanceName is not a string');
    }

    if (opts.keepRunning !== undefined && typeof opts.keepRunning !== 'boolean') {
        throw new Error('keepRunning is not boolean');
    }

    return opts as BobChumOptions;
}

async function emptyChum(opts: BobChumOptions = {}): Promise<VersionedObjectResult<Chum>> {
    MessageBus.send('log', 'Running "emptyChum"');

    const {bobPersonId, alicePersonId, bobInstanceName, aliceInstanceName, keepRunning} =
        ensureBobChumOptionsOrUndefined(opts);

    const initialChumObj = {
        connection: await createWsPromiObj(),
        localPersonId:
            bobPersonId === undefined
                ? await calculateIdHashOfObj(CONFIGURATION.bob.person)
                : bobPersonId,
        remotePersonId:
            alicePersonId === undefined
                ? await calculateIdHashOfObj(CONFIGURATION.alice.person)
                : alicePersonId,
        chumName: 'MochaTest',
        localInstanceName:
            bobInstanceName === undefined ? CONFIGURATION.bob.instance.name : bobInstanceName,
        remoteInstanceName:
            aliceInstanceName === undefined ? CONFIGURATION.alice.instance.name : aliceInstanceName,
        keepRunning: keepRunning === undefined ? false : keepRunning,
        pollInterval: 200
    } as ChumSyncOptions;

    return startTestChum(initialChumObj).promise;
}

async function onGoingChum(): Promise<VersionedObjectResult<Chum>> {
    MessageBus.send('log', 'Running "onGoingChum"');

    return startTestChum({
        connection: await createWsPromiObj(),
        localPersonId: await calculateIdHashOfObj(CONFIGURATION.bob.person),
        remotePersonId: await calculateIdHashOfObj(CONFIGURATION.alice.person),
        chumName: 'MochaTest',
        localInstanceName: CONFIGURATION.bob.instance.name,
        remoteInstanceName: CONFIGURATION.alice.instance.name,
        keepRunning: true,
        pollInterval: 200
    }).promise;
}

function reportErrorAndRethrow(fn: AnyFunction): (...args: any[]) => Promise<any> {
    return async function reportAndRethrow(...args: any[]): Promise<any> {
        try {
            return await fn(...args);
        } catch (err) {
            MessageBus.send('error', err);
        }
    };
}

let aliceConnection: WebsocketPromisifierAPI;

async function startBob(): Promise<void> {
    await import(`../../lib/system/load-${SYSTEM}.js`);

    console.log = (...data: any[]) => aliceConnection.send(SERVICE.log, data);
    console.error = (...data: any[]) => aliceConnection.send(SERVICE.error, data);

    aliceConnection = await createWsPromiObj('AliceControl', 'BobControl');

    aliceConnection.addService(SERVICE.init, reportErrorAndRethrow(init));
    aliceConnection.addService(
        SERVICE.deleteTestDB,
        reportErrorAndRethrow(closeAndDeleteCurrentInstance)
    );
    aliceConnection.addService(SERVICE.emptyChum, reportErrorAndRethrow(emptyChum));
    aliceConnection.addService(SERVICE.onGoingChum, reportErrorAndRethrow(onGoingChum));
    aliceConnection.addService(SERVICE.grantAccess, reportErrorAndRethrow(createAccess));
    aliceConnection.addService(
        SERVICE.checkExistence,
        reportErrorAndRethrow((data: unknown) => exists(ensureHash(data)))
    );
    aliceConnection.addService(SERVICE.waitForObject, reportErrorAndRethrow(waitForObject));
    aliceConnection.addService(SERVICE.createObj, reportErrorAndRethrow(StorageHelpers.createObj));
    aliceConnection.addService(SERVICE.reportMemoryUsage, process.memoryUsage);

    aliceConnection.promise.catch(_ignore => null).finally(() => aliceConnection.clearServices());

    await aliceConnection.promise;
}

// https://stackoverflow.com/q/14031763/544779
// https://stackoverflow.com/a/31562361/544779
function cleanExit(): void {
    process.exit();
}

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
process.on('SIGUSR1', cleanExit);
process.on('SIGUSR2', cleanExit);
process.on('uncaughtException', cleanExit);
process.on('unhandledRejection', cleanExit);

process.on('exit', () => {
    if (aliceConnection !== undefined) {
        aliceConnection.close();
    }

    stopLogger();
});

startLogger({includeInstanceName: true, types: ENABLED_LOG_LVLS});

startBob().catch(err => console.error(err));
