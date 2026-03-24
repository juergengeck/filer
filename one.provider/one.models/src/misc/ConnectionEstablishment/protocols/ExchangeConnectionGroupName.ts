import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type Connection from '../../Connection/Connection.js';
const MessageBus = createMessageBus('protocols/ExchangeConnectionGroupName');

export type ConnectionGroupMessage = {
    command: 'connection_group';
    connectionGroupName: string;
};

function isConnectionGroupMessage(arg: any): arg is ConnectionGroupMessage {
    return arg && arg.command === 'connection_group' && typeof arg.connectionGroupName === 'string';
}

/**
 * Send the connection group name.
 *
 * @param conn
 * @param connectionGroupName
 */
function sendConnectionGroupName(conn: Connection, connectionGroupName: string): void {
    conn.debug(MessageBus, `Send connection group ${connectionGroupName}`);
    conn.send(
        JSON.stringify({
            command: 'connection_group',
            connectionGroupName
        })
    );
}

/**
 * Wait for the connection group name from the other side.
 *
 * @param conn
 */
async function waitForConnectionGroupName(conn: Connection): Promise<string> {
    conn.debug(MessageBus, 'Wait for connection group.');

    const message = await conn
        .promisePlugin()
        .waitForJSONMessageWithType('connection_group', 'command');

    if (!isConnectionGroupMessage(message)) {
        throw Error(
            "Received data does not match the data expected for command 'connection_group'"
        );
    }

    const connectionGroupName = message.connectionGroupName;
    conn.debug(MessageBus, `Received connection group ${connectionGroupName}`);
    return connectionGroupName;
}

/**
 * Exchange the connection group name.
 *
 * @param conn - The connection used to exchange the connection group name.
 * @param connectionGroupName - The name of the connection group. If specified the connection
 * group will be sent, if omitted it waits for the connection group from the other side.
 */
export async function exchangeConnectionGroupName(
    conn: Connection,
    connectionGroupName?: string
): Promise<string> {
    if (connectionGroupName !== undefined) {
        sendConnectionGroupName(conn, connectionGroupName);
        return connectionGroupName;
    } else {
        return await waitForConnectionGroupName(conn);
    }
}
