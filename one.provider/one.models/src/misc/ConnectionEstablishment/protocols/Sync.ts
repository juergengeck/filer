import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type Connection from '../../Connection/Connection.js';
const MessageBus = createMessageBus('protocols/Sync');

export type SyncMessage = {
    command: 'sync';
};

function isSyncMessage(arg: any): arg is SyncMessage {
    return arg && arg.command === 'sync';
}

/**
 * Send the connection group name.
 *
 * @param conn
 */
export function sendSyncMessage(conn: Connection): void {
    conn.debug(MessageBus, 'Send sync message');
    conn.send(
        JSON.stringify({
            command: 'sync'
        })
    );
}

/**
 * Wait for the connection group name from the other side.
 *
 * @param conn
 */
export async function waitForSyncMessage(conn: Connection): Promise<void> {
    conn.debug(MessageBus, 'Wait for sync message');
    const message = await conn.promisePlugin().waitForJSONMessageWithType('sync', 'command');

    if (!isSyncMessage(message)) {
        throw Error("Received data does not match the data expected for command 'sync'");
    }

    conn.debug(MessageBus, 'Received sync message');
}

/**
 * Exchange a sync message.
 *
 * You have to call this on both sides of the connection. One side with 'waits' set to true, one
 * with 'waits' set to false. The one with 'waits' set to true will wait for the other side to
 * send the sync message.
 *
 * @param conn - The connection used to exchange the connection group name.
 * @param waits - If true, then the code waits for the other side to do the same call with this
 * set to false.
 */
export async function sync(conn: Connection, waits: boolean): Promise<void> {
    if (waits) {
        await waitForSyncMessage(conn);
    } else {
        sendSyncMessage(conn);
    }
}
