/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH & Maximilian Wisgickl 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module connects two ONE instances and synchronizes (transfers) all objects accessible
 * by one instance to the other. The exchange is bidirectional. When the synchronization is
 * finished a {@link Chum|Chum object} is written by both sides with a log of the exchange.
 *
 * ## Limitations
 *
 * Changes to group memberships performed while a Chum is active are ignored. The Chum uses the
 * group memberships it finds when the exchange is initialized.
 *
 * Writes to storage while a synchronization is running may or may not influence it depending on
 * mode and on timing. For example, in mode "keepRunning = false" (see below) the list of all
 * {@link Access|Access objects} accessible by the given person (by ID hash) are calculated
 * at the start. If an Access object is for an ID hash, i.e. for all versions of a versioned
 * object, any new versions written while the synchronization is running *may* be
 * transferred (or not) depending on if the object was written before that particular object
 * was transferred or after. In mode "keepRunning = true" it will be transferred for certain if
 * the write-operation occurs before the synchronization is explicitly ended.
 *
 * ## keepRunning = false
 *
 * The Chum synchronizes all currently accessible objects and then exits.
 *
 * Note that there is no locking, the behavior if the application continues to write to storage
 * depends on what it writes and on timing, if it modifies access settings that would be
 * relevant to the currently connected remote ONE instance. We do not wish to disable (or queue)
 * all write requests while a synchronization is running, since this may take quite a long time.
 * We also don't want to incur the cost of checking if any writes are relevant. We think it is
 * easy (easier, cheaper) for the application to be programmed in such a way that continued
 * writing to ONE storage while an exchange is running has no undesirable consequences.
 *
 * ## keepRunning = true
 *
 * The Chum performs a full synchronization and then keeps the connection open and keeps
 * synchronizing any objects as they become available _and accessible_. Only when the
 * synchronization is explicitly ended are the final Chum log objects written by both sides. It
 * will not lose any relevant writes because immediately after the initial calculation of
 * accessible Access objects (which point to the accessible objects) the code starts watching
 * what ONE objects are written and, if relevant, adds them to the collection of accessible
 * hashes unknown with those found through the originally started full synchronization.
 *
 * While there is no sharp distinction between objects (hashes) found through the request for a
 * full synchronization and those found while watching new objects being written there is a "full
 * synchronization achieved" status. It is achieved when the objects reachable through all
 * {@link Access} objects found initially (not through monitoring ongoing storage writes) have
 * all been processed (hashes collected, sent to the remote instance, processed and then
 * acknowledged by the remote instance). It is significant because there is a timestamp given to
 * the remote instance when it makes its request. "Full synchronization" means that all objects
 * accessible at that point have been processed. The timestamp can then be used by the remote
 * instance to only ask for objects created after that timestamp.
 *
 * @module
 */

import {initAccessManager} from './accessManager.js';
import {createChumExporter} from './chum-exporter.js';
import {createChumImporter} from './chum-importer.js';
import {createError, type ErrorWithCode} from './errors.js';
import {createMessageBus} from './message-bus.js';
import type {BLOB, Chum, CLOB, Person} from './recipes.js';
import type {AnyObjectCreation, FileCreation} from './storage-base-common.js';
import type {IdFileCreation, VersionedObjectResult} from './storage-versioned-objects.js';
import {STORE_AS, storeVersionedObject} from './storage-versioned-objects.js';
import type {AnyObject} from './util/object.js';
import type {OneEventSource} from './util/one-event-source.js';
import {createEventSource} from './util/one-event-source.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import type {WebsocketPromisifierAPI} from './websocket-promisifier.js';

/**
 * @typedef {object} ChumSyncOptions
 * @property {WebsocketPromisifierAPI} connection - A WebSocket promisifier API object
 * @property {SHA256IdHash} localPersonId - The ID hash of the owner of the local instance the
 * chum is exchanging data with. This does not have to be the main instance but some anonymous
 * ID, so we cannot simply query the instance for the main instance's Person ID
 * @property {SHA256IdHash} remotePersonId - The ID hash of the owner of the remove instance the
 * chum is exchanging data with
 * @property {string} chumName - Name of the Chum
 * @property {string} localInstanceName - Name of local instance
 * @property {string} remoteInstanceName - Name of remote instance
 * @property {boolean} [keepRunning=false] - The connection remains until stopped explicitly
 * @property {number} [pollInterval=5000] - KeepRunning interval between polls (in ms)
 */
export interface ChumSyncOptions {
    connection: WebsocketPromisifierAPI;
    localPersonId: SHA256IdHash<Person>;
    remotePersonId: SHA256IdHash<Person>;
    chumName: string;
    localInstanceName: string;
    remoteInstanceName: string;
    keepRunning?: boolean;
    pollInterval?: number;
    disableImporter?: boolean;
    disableExporter?: boolean;
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>;
}

export interface ChumApi {
    promise: Promise<VersionedObjectResult<Chum>>;
    onFullSync: OneEventSource<void>;
    /* onBlobSaved: OneEventSource<FileCreation<BLOB>>;
    onClobSaved: OneEventSource<FileCreation<CLOB>>;
    onIdObjectSaved: OneEventSource<IdFileCreation>;
    onObjectSaved: OneEventSource<AnyObjectCreation>;
    onActivity: OneEventSource<string>;*/
}

const MessageBus = createMessageBus('chum-sync');

const chumStartEvent = createEventSource<ChumSyncOptions>();

export const onChumStart = chumStartEvent.consumer;

const chumEndEvent = createEventSource<ChumSyncOptions>();

export const onChumEnd = chumEndEvent.consumer;

// Uses the above two events. This has to come AFTER their initialization above so that they are
// available when the AM tries to subscribe to the events.
initAccessManager();

// FOR TESTS ONLY
// export function setProtocolVersion(v: number): void {
//     PROTOCOL_VERSION = v;
// }

/**
 * @private
 * @param {Chum} chumObj
 * @returns {number} Returns total number of transfers logged in the Chum object
 */
function nrOfTotalLoggedTransfers(chumObj: Readonly<Chum>): number {
    return [
        'AtoBObjects',
        'AtoBIdObjects',
        'AtoBBlob',
        'AtoBClob',
        'BtoAObjects',
        'BtoAIdObjects',
        'BtoABlob',
        'BtoAClob'
    ].reduce(
        (sum, prop) => sum + (chumObj as AnyObject)[prop].length,
        0 // Initial value
    );
}

/**
 * @private
 * @param {ChumSyncOptions} options - An object with options
 * @param {ChumApi} events - The Chum API object, passed through for the OneEventSource objects, to
 * dispatch the events from the proper places in the various Chum modules
 * @returns {Promise<VersionedObjectResult<Chum>>}
 */
async function init(
    options: ChumSyncOptions,
    events: Omit<ChumApi, 'promise'>
): Promise<VersionedObjectResult<Chum>> {
    const {
        connection,
        localPersonId,
        remotePersonId,
        chumName,
        localInstanceName,
        remoteInstanceName,
        keepRunning = false,
        pollInterval = 5000,
        disableImporter = false,
        disableExporter = false,
        objectFilter
    } = options;

    MessageBus.send(
        'log',
        `[${connection.connId}] Chum, local: ${localInstanceName}, remote: ${remoteInstanceName}, import: ${!disableImporter}, export: ${!disableExporter}`
    );

    if (localPersonId === undefined || remotePersonId === undefined) {
        throw createError('CS-INIT1', {localPersonId, remotePersonId});
    }

    connection.promise
        .then(() => MessageBus.send('log', `[${connection.connId}] CONECTION CLOSED`))
        .catch(err => MessageBus.send('alert', `[${connection.connId}] CONECTION CLOSED ERR`, err));

    // Tp get the exact same Chum ID on both sides we order ID properties "instance" (name) and
    // "person" in the same way on both sides. Of course, this means the position in the tuple
    // no longer provides the information about which is the remote and which is the local info.
    const order = localInstanceName < remoteInstanceName;

    const chumObj: Chum = {
        $type$: 'Chum',
        name: chumName,
        instance: order
            ? [localInstanceName, remoteInstanceName]
            : [remoteInstanceName, localInstanceName],
        person: order ? [localPersonId, remotePersonId] : [remotePersonId, localPersonId],
        highestRemoteTimestamp: 0,
        // The importer and exporter are configured below to add their transfers directly to
        // these arrays
        AtoBObjects: [],
        AtoBIdObjects: [],
        AtoBBlob: [],
        AtoBClob: [],
        BtoAObjects: [],
        BtoAIdObjects: [],
        BtoABlob: [],
        BtoAClob: [],
        BtoAExists: 0,
        statistics: undefined,
        errors: []
    };

    // If any stored data was already exchanged letting the entire Chum object creation fail is
    // counterproductive since we would lose the log of the exchange entirely. That is why
    // errors are logged and the Chum object creation is allowed to go ahead in that case.
    function logError(err: ErrorWithCode): void {
        MessageBus.send('log', `[${connection.connId}] Failure during chum service execution`, err);

        // Exclude errors from websocket-promisifier remote requests that failed due to the
        // connection having been closed. Since connection failures are not rare and not
        // (usually, if the code is correct) a code issue, and we cannot do anything about it,
        // this is an issue of an incomplete chum exchange, which is not an exception but an
        // expected problem, that needs to be detected and handled on a higher level, not on one
        // failed function and a lower level error.
        if (!err.code?.startsWith('WSP-ONCL')) {
            chumObj.errors.push(err);
        }
    }

    chumStartEvent.dispatch(options);

    const exporterPromise = disableExporter
        ? Promise.resolve()
        : createChumExporter({
              ws: connection,
              remotePersonId,
              objectFilter,
              onBlobSent: hash => chumObj.AtoBBlob.push(hash),
              onClobSent: hash => chumObj.AtoBClob.push(hash),
              onIdObjectSent: hash => chumObj.AtoBIdObjects.push(hash),
              onObjectSent: hash => chumObj.AtoBObjects.push(hash),
              onError: logError
          });

    const importerPromise = disableImporter
        ? connection.promise.then(() => 0)
        : createChumImporter({
              ws: connection,
              keepRunning,
              pollInterval,
              onFirstSync: events.onFullSync.dispatch,
              onBlobSaved: hash => chumObj.BtoABlob.push(hash),
              onClobSaved: hash => chumObj.BtoAClob.push(hash),
              onIdObjectSaved: hash => chumObj.BtoAIdObjects.push(hash),
              onObjectSaved: hash => chumObj.BtoAObjects.push(hash),
              onError: logError
          });

    try {
        MessageBus.send('log', `[${connection.connId}] AWAIT IMPORTER AND EXPORTER PROMISE`);
        await Promise.all([exporterPromise, importerPromise]);

        connection.close(
            `Chum ended [${connection.connId}] normally. Error count ${chumObj.errors.length}`
        );

        MessageBus.send('log', `[${connection.connId}] AWAIT IMPORTER AND EXPORTER PROMISE - DONE`);
    } catch (err) {
        connection.close(`Chum ended [${connection.connId}] with error: ${err}`);

        MessageBus.send(
            'log',
            `[${connection.connId}] AWAIT IMPORTER AND EXPORTER PROMISE - DONE WITH ERRORS`,
            err
        );

        // POLICY DECISION
        // If nothing was transferred, yet we don't bother writing a Chum object. As soon as
        // something was transferred we have to log it though, i.e. we write a Chum object and
        // log the error inside instead of throwing the error. After all, _some_ exchange took
        // place, that is not a total error.
        if (nrOfTotalLoggedTransfers(chumObj) === 0) {
            throw err;
        }
    } finally {
        try {
            chumObj.statistics = await connection.promise;
        } catch (err) {
            // Websocket errors are websocket close codes other than CLOSE_CODES.NORMAL and
            // CLOSE_CODES.PARTNER_DISCONNECT (defined in websocket-promisifier.js). Both importer
            // and exporter ignore websocket error state, they only care about that the connection
            // was closed. That means we have to treat errors here (by logging them in the Chum
            // object). There is no action, we don't really care much why a connection was closed,
            // the synchronization attempts to do what it can and when it's over. We assume the
            // connection _always_ is unreliable to begin with.
            // Both importer and exporter ignore websocket error state, they only care about
            // that the connection was closed. That means we have to treat errors here (by
            // logging them in the Chum object). There is no action, we don't really care much
            // why a connection was closed, the synchronization attempts to do what it can and
            // when it's over, it's over. We assume the connection _always_ is unreliable to
            // begin with.
            chumObj.errors.push(err);
        }

        chumEndEvent.dispatch(options);
    }

    MessageBus.send(
        'debug',
        `[${connection.connId}] FINAL new Chum object: ${JSON.stringify(chumObj, null, 4)}`
    );

    const storedChumResult = await storeVersionedObject(chumObj, STORE_AS.MERGE);

    MessageBus.send(
        'log',
        `[${connection.connId}] END of chum-sync, Chum object HASH ${storedChumResult.hash} ID-HASH ${storedChumResult.idHash}`
    );

    chumObj.errors.forEach((err, idx) =>
        MessageBus.send(
            'log',
            `[${connection.connId}] Chum Error: ${idx + 1} of ${chumObj.errors.length}`,
            err
        )
    );

    return storedChumResult;
}

/**
 * This function executes a Chum synchronization between two ONE instances and when done stores
 * a new Chum object with a log of what was exchanged.
 *
 * @static
 * @async
 * @param {ChumSyncOptions} options
 * @returns {ChumApi} The api that can be used to get more information from the chum.
 */
export function createChum(options: ChumSyncOptions): ChumApi {
    MessageBus.send('log', `CHUM OPTIONS: ${JSON.stringify(options)}`);

    const events = {
        onFullSync: createEventSource<void>(),
        onBlobSaved: createEventSource<FileCreation<BLOB>>(),
        onClobSaved: createEventSource<FileCreation<CLOB>>(),
        onIdObjectSaved: createEventSource<IdFileCreation>(),
        onObjectSaved: createEventSource<AnyObjectCreation>()
    };

    return {
        promise: init(options, events),
        ...events
    };
}
