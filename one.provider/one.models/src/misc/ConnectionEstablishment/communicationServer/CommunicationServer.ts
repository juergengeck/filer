import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';
import tweetnacl from 'tweetnacl';
import CommunicationServerConnection_Server from './CommunicationServerConnection_Server.js';
import {isClientMessage} from './CommunicationServerProtocol.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import WebSocketServer from '../webSockets/WebSocketServer.js';
import {
    hexToUint8Array,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import Connection from '../../Connection/Connection.js';
import PromisePlugin from '../../Connection/plugins/PromisePlugin.js';
import type {KeyPair} from '@refinio/one.core/lib/crypto/encryption.js';
import {
    createKeyPair,
    decryptWithEmbeddedNonce,
    encryptAndEmbedNonce,
    ensurePublicKey
} from '@refinio/one.core/lib/crypto/encryption.js';

const MessageBus = createMessageBus('CommunicationServer');

/**
 * Container for storing registered connections.
 */
type ConnectionContainer = {
    conn: CommunicationServerConnection_Server;
    removeEventListeners: () => void;
};

/**
 * This class implements the communication server.
 */
class CommunicationServer {
    private webSocketServer: WebSocketServer; // The web socket server that accepts connections
    private keyPair: KeyPair; // The key pair used for the commserver
    private listeningConnectionsMap: Map<string, ConnectionContainer[]>; // Map that stores spare connections
    private readonly openedConnections: Set<WebSocket>; // List of established relays
    private pingInterval: number; // Interval used to ping spare connections
    private pongTimeout: number; // Timeout used to wait for pong responses

    /**
     * Create the communication server.
     */
    constructor() {
        this.webSocketServer = new WebSocketServer();
        this.keyPair = createKeyPair();
        this.listeningConnectionsMap = new Map<string, ConnectionContainer[]>();
        this.openedConnections = new Set<WebSocket>();
        this.pingInterval = 5000;
        this.pongTimeout = 1000;

        this.webSocketServer.onConnection.listen(this.acceptConnection.bind(this));
    }

    /**
     * Start the communication server.
     *
     * @param host - The host to bind to.
     * @param port - The port to bind to.
     * @param pingInterval - The interval in which pings are sent for spare connections.
     * @param pongTimeout - The timeout used to wait for pongs.
     */
    public async start(
        host: string,
        port: number,
        pingInterval: number = 25000,
        pongTimeout = 1000
    ): Promise<void> {
        this.pingInterval = pingInterval;
        this.pongTimeout = pongTimeout;
        await this.webSocketServer.start(host, port);
    }

    /**
     * Stop the communication server.
     */
    public async stop(): Promise<void> {
        MessageBus.send('log', 'Stop communication server');

        // Close spare connections
        for (const connectionContainers of this.listeningConnectionsMap.values()) {
            for (const connectionContainer of connectionContainers) {
                connectionContainer.conn.close();
            }
        }

        // Close forwarded connections
        for (const ws of this.openedConnections) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        }

        MessageBus.send('log', 'Closing websocket listener');
        await this.webSocketServer.stop();

        MessageBus.send('log', 'Stop communication server complete');
    }

    /**
     * Accept a new connection.
     *
     * NOTE: This is a server-side operation
     *
     * @param connection - The incoming connection
     */
    private async acceptConnection(connection: Connection): Promise<void> {
        // All connections are now unified as Connection class
        // No special handling needed for different connection types
        
        const conn = new CommunicationServerConnection_Server(connection);
        // Add PromisePlugin AFTER WebSocketPlugin so processing order is:
        // 1. WebSocketPlugin (filters ping/pong) 
        // 2. PromisePlugin (tries JSON parsing)
        connection.addPlugin(new PromisePlugin(), { after: 'websocket' });

        try {
            const message = await conn.waitForAnyMessage();

            // For register, let's authenticate the client
            if (isClientMessage(message, 'register')) {
                const binPublicKey = ensurePublicKey(hexToUint8Array(message.publicKey));

                MessageBus.send(
                    'log',
                    `${connection.id}: Registering connection for ${uint8arrayToHexString(
                        binPublicKey
                    )}`
                );

                // Step 1: Create, encrypt and send the challenge
                MessageBus.send('log', `${connection.id}: Register Step 1: Sending auth request`);
                const challenge = tweetnacl.randomBytes(64);
                const encryptedChallenge = encryptAndEmbedNonce(
                    challenge,
                    this.keyPair.secretKey,
                    binPublicKey
                );
                await conn.sendAuthenticationRequestMessage(
                    this.keyPair.publicKey,
                    encryptedChallenge
                );

                // Negate all bits in the challenge, so that an attacker can't just send back the
                // challenge unencrypted (symmetric keys!)
                for (let i = 0; i < challenge.length; ++i) {
                    challenge[i] = ~challenge[i];
                }

                // Step 2: Wait for authentication_response, decrypt and verify
                MessageBus.send(
                    'log',
                    `${connection.id}: Register Step 2: Waiting for auth response`
                );
                const authResponseMessage = await conn.waitForMessage('authentication_response');
                const decryptedChallenge = decryptWithEmbeddedNonce(
                    hexToUint8Array(authResponseMessage.response),
                    this.keyPair.secretKey,
                    binPublicKey
                );
                if (!tweetnacl.verify(decryptedChallenge, challenge)) {
                    throw new Error('Client authentication failed.');
                }
                MessageBus.send(
                    'log',
                    `${connection.id}: Register Step 2: Authentication successful`
                );

                // Step 3: Add to spare map and return success message
                this.pushListeningConnection(binPublicKey, conn);
                await conn.sendAuthenticationSuccessMessage(this.pingInterval);

                // Step 4: Start PingPong
                MessageBus.send('log', `${connection.id}: Register Step 3: Starting Ping Pong`);
                conn.startPingPong(this.pingInterval, this.pongTimeout);
            }

            // On communication request, let's connect it to a spare connection of the requested publicKey
            else if (isClientMessage(message, 'communication_request')) {
                MessageBus.send(
                    'log',
                    `${connection.id}: Requesting Relay to ${message.targetPublicKey}`
                );

                const connOther = this.popListeningConnection(
                    hexToUint8Array(message.targetPublicKey)
                );

                // Step 1: Stop the ping ponging
                MessageBus.send('log', `${connection.id}: Relay Step 1: Stop ping pong`);
                await connOther.stopPingPong();

                // Step 2: Send the handover message
                MessageBus.send('log', `${connection.id}: Relay Step 1: Send Handover`);
                await connOther.sendConnectionHandoverMessage();

                // Step 3: Forward the communication request
                MessageBus.send(
                    'log',
                    `${connection.id}: Relay Step 2: Forward connection request`
                );
                await connOther.sendCommunicationRequestMessage(
                    ensurePublicKey(hexToUint8Array(message.sourcePublicKey)),
                    ensurePublicKey(hexToUint8Array(message.targetPublicKey))
                );

                // Step 4: Forward everything
                // TODO: Because we send the communicationRequestMessage on Step3 (with an await) it is theoretically
                // possible, that the answer is received before the web socket send call returns.
                // So it might be possible that the old websocket 'message' handler is scheduled before the new
                // message handler is registered because the 'message' call is scheduled before the await is scheduled
                // (by resolve call after websocket.send())
                // This would only happen if the CPU is so slow, that the websocket send returns after the answer was
                // processed by the kernel. This is so unlikely it seems impossible.
                // A fix would be to call the send after the events have been rewired. But then we cannot use the
                // connection class with the current architecture. So we will do that probably later when we see problems
                MessageBus.send('log', `${connection.id}: Relay Step 3: Connect both sides`);
                const wsThis = conn.releaseWebSocket();
                const wsOther = connOther.releaseWebSocket();
                wsThis.addEventListener('message', (msg: any) => {
                    wsOther.send(msg.data);
                });
                wsOther.addEventListener('message', (msg: any) => {
                    wsThis.send(msg.data);
                });
                wsThis.addEventListener('error', (e: any) => {
                    MessageBus.send('log', `${conn.connection.id}: Error - ${e}`);
                });
                wsOther.addEventListener('error', (e: any) => {
                    MessageBus.send('log', `${connOther.connection.id}: Error - ${e}`);
                });
                wsThis.addEventListener('close', (e: CloseEvent) => {
                    this.openedConnections.delete(wsThis);
                    MessageBus.send(
                        'log',
                        `${conn.connection.id}: Requesting connection closed - ${e.reason}`
                    );
                    wsOther.close(1000, e.reason);
                });
                wsOther.addEventListener('close', (e: CloseEvent) => {
                    this.openedConnections.delete(wsOther);
                    MessageBus.send(
                        'log',
                        `${connOther.connection.id}: Listening connection closed - ${e.reason}`
                    );
                    wsThis.close(1000, e.reason);
                });

                this.openedConnections.add(wsThis);
                this.openedConnections.add(wsOther);
            }

            // On unknown message, throw an error
            else {
                throw new Error('Received unexpected or malformed message from client.');
            }
        } catch (e) {
            MessageBus.send('log', `${connection.id}: ${e}`);
            connection.close(e.message);
        }
    }

    /**
     * Adds a spare connection the the listening connection array.
     *
     * This also adds an event listener to the 'close' event, so that the connection is automatically
     * removed from the listeningConnections list when the websocket is closed.
     *
     * @param publicKey - The public key of the registering client.
     * @param conn - The connection that is registered.
     */
    private pushListeningConnection(
        publicKey: Uint8Array,
        conn: CommunicationServerConnection_Server
    ): void {
        const strPublicKey = uint8arrayToHexString(publicKey);
        MessageBus.send('debug', `${conn.id}: pushListeningConnection(${strPublicKey})`);

        // Add handler that removes the connection from the listening list when the ws closes
        const boundRemoveHandler = this.removeListeningConnection.bind(this, publicKey, conn);
        conn.webSocket.addEventListener('close', boundRemoveHandler);

        // Add handler that is called when the connection is bound to an incoming connection
        function removeEventListeners() {
            conn.webSocket.removeEventListener('close', boundRemoveHandler);
        }

        // Add connection to listeners list
        const connContainer: ConnectionContainer = {
            conn,
            removeEventListeners
        };
        const connectionList = this.listeningConnectionsMap.get(strPublicKey);

        if (connectionList) {
            connectionList.push(connContainer);
        } else {
            this.listeningConnectionsMap.set(strPublicKey, [connContainer]);
        }
    }

    /**
     * Remove the listening connection from the listeningConnection list.
     *
     * This is used to remove it when the websocket is closed before a relay with it has been established.
     *
     * @param publicKey - The public key of the registering client.
     * @param conn - The connection that is removed.
     */
    private removeListeningConnection(
        publicKey: Uint8Array,
        conn: CommunicationServerConnection_Server
    ): void {
        const strPublicKey = uint8arrayToHexString(publicKey);
        MessageBus.send('debug', `${conn.id}: removeListeningConnection(${strPublicKey})`);

        const connectionList = this.listeningConnectionsMap.get(strPublicKey);
        if (connectionList) {
            this.listeningConnectionsMap.set(
                strPublicKey,
                connectionList.filter(elem => elem.conn !== conn)
            );
        }
    }

    /**
     * Pops one listening / spare connection from the listeningConnections list that matches the
     * public key. This is used to find a relay match.
     *
     * @param publicKey - The public key of the registering client / the target of the requested relay.
     * @returns The found connection.
     */
    private popListeningConnection(publicKey: Uint8Array): CommunicationServerConnection_Server {
        const strPublicKey = uint8arrayToHexString(publicKey);
        MessageBus.send('debug', `popListeningConnection(${strPublicKey})`);

        // Get the connection list for the current public key
        const connectionList = this.listeningConnectionsMap.get(strPublicKey);
        if (connectionList === undefined) {
            throw new Error('No listening connection for the specified publicKey.');
        }

        // Remove the list if it only has one element remaining
        if (connectionList.length <= 1) {
            this.listeningConnectionsMap.delete(strPublicKey);
        }

        // Get the topmost spare connection
        const connContainer = connectionList.pop();
        if (!connContainer) {
            throw new Error(
                'No listening connection for the specified publicKey. This error should never happen!'
            );
        }
        MessageBus.send(
            'debug',
            `${connContainer.conn.id}: popListeningConnection(${strPublicKey}) - Returned`
        );

        // Remove the close listener
        connContainer.removeEventListeners();
        return connContainer.conn;
    }
}

export default CommunicationServer;
