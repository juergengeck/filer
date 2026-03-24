import {createChum} from '@refinio/one.core/lib/chum-sync.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {Instance} from '@refinio/one.core/lib/recipes.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {createWebsocketPromisifier} from '@refinio/one.core/lib/websocket-promisifier.js';

const MessageBus = createMessageBus('Protocols/StartChum');

/**
 * Starts the corresponding chum connection.
 *
 * @param conn
 * @param localPublicInstanceKey - This key is just used to get unique chum objects for
 * connections.
 * @param remotePublicInstanceKey - This key is just used to get unique chum objects for
 * connections.
 * @param localPersonId
 * @param remotePersonId
 * @param protocol
 * @param initiatedLocally
 * @param keepRunning
 */
import type Connection from '../../Connection/Connection.js';
import type {OEvent} from '../../OEvent.js';
import type {Protocols} from './CommunicationInitiationProtocolMessages.js';

export async function startChumProtocol(
    conn: Connection,
    localPersonId: SHA256IdHash<Person>,
    localInstanceId: SHA256IdHash<Instance>,
    remotePersonId: SHA256IdHash<Person>,
    remoteInstanceId: SHA256IdHash<Instance>,
    initiatedLocally: boolean,
    connectionRoutesGroupName: string,
    onProtocolStart: OEvent<
        (
            initiatedLocally: boolean,
            localPersonId: SHA256IdHash<Person>,
            localInstanceId: SHA256IdHash<Instance>,
            remotePersonId: SHA256IdHash<Person>,
            remoteInstanceId: SHA256IdHash<Instance>,
            protocol: Protocols
        ) => void
    >,
    disableImporter: boolean = false,
    disableExporter: boolean = false,
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
) {
    // SURGICAL LOGGING: Check SharedArrayBuffer availability at function entry
    MessageBus.send('log', `🔬 [startChumProtocol] ${conn.id}: ENTRY - SharedArrayBuffer availability check`);
    MessageBus.send('log', `   - typeof SharedArrayBuffer: ${typeof SharedArrayBuffer}`);
    MessageBus.send('log', `   - globalThis.SharedArrayBuffer: ${typeof globalThis.SharedArrayBuffer}`);
    MessageBus.send('log', `   - window?.SharedArrayBuffer: ${typeof (globalThis as any).window?.SharedArrayBuffer}`);
    MessageBus.send('log', `   - global?.SharedArrayBuffer: ${typeof (globalThis as any).global?.SharedArrayBuffer}`);
    MessageBus.send('log', `   - self?.SharedArrayBuffer: ${typeof (globalThis as any).self?.SharedArrayBuffer}`);

    onProtocolStart.emit(
        initiatedLocally,
        localPersonId,
        localInstanceId,
        remotePersonId,
        remoteInstanceId,
        'chum'
    );

    // Send synchronisation messages to make sure both instances start the chum at the same time.
    conn.send('synchronisation');
    await conn.promisePlugin().waitForMessage();
    conn.removePlugin('promise');

    // SURGICAL LOGGING: Check SharedArrayBuffer before createChum call
    MessageBus.send('log', `🔬 [startChumProtocol] ${conn.id}: BEFORE createChum - SharedArrayBuffer check`);
    MessageBus.send('log', `   - typeof SharedArrayBuffer: ${typeof SharedArrayBuffer}`);
    MessageBus.send('log', `   - execution context: ${typeof globalThis} / ${typeof window} / ${typeof global}`);

    // Core takes either the ws package or the default websocket
    // depending on for what environment it was compiled. In this
    // project we use the isomorphic-ws library for this. This is
    // why we need to ignore the below error, because after compilation
    // the types of the websockets will be the same.
    const websocketPromisifierAPI = createWebsocketPromisifier(conn);

    MessageBus.send('log', `🔬 [startChumProtocol] ${conn.id}: CALLING createChum now...`);

    if (objectFilter) {
        MessageBus.send('log', `[startChumProtocol] Using objectFilter for Group/Access filtering`);
    }

    await createChum({
        connection: websocketPromisifierAPI,
        localPersonId,
        remotePersonId,

        // used only for logging purpose
        chumName: connectionRoutesGroupName,
        localInstanceName: (await getIdObject(localInstanceId)).name,
        remoteInstanceName: (await getIdObject(remoteInstanceId)).name,

        keepRunning: true,
        disableImporter,
        disableExporter,
        objectFilter
    }).promise;
    MessageBus.send('log', `🔬 [startChumProtocol] ${conn.id}: createChum completed successfully`);
}
