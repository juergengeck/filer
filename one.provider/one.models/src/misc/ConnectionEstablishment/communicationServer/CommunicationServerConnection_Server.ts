import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type * as CommunicationServerProtocol from './CommunicationServerProtocol.js';
import {isClientMessage} from './CommunicationServerProtocol.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type Connection from '../../Connection/Connection.js';
import {PingPlugin} from '../../Connection/plugins/PingPongPlugin.js';

const MessageBus = createMessageBus('CommunicationServerConnection_Server');

/**
 * This class implements the server side of communication server communication.
 */
class CommunicationServerConnection_Server {
    public connection: Connection; // The websocket used for communication
    /**
     * Creates a server connection based on a WebSocket object
     *
     * @param connection
     */
    constructor(connection: Connection) {
        this.connection = connection;
    }

    get id(): number {
        return this.connection.id;
    }

    // ######## Socket Management & Settings ########

    /**
     * Get the underlying web socket instance
     *
     * @returns
     */
    get webSocket(): WebSocket {
        const webSocket = this.connection.websocketPlugin().webSocket;
        if (!webSocket) {
            throw new Error('No Websocket is assigned to connection.');
        }
        return webSocket;
    }

    /**
     * Releases the underlying websocket, so that it can be used by another class.
     *
     * Attention: If messages arrive in the meantime they might get lost.
     */
    public releaseWebSocket(): WebSocket {
        return this.connection.websocketPlugin().releaseWebSocket();
    }

    /**
     * Closes the web socket.
     *
     * @param reason - The reason for closing. If specified it is sent unencrypted to the remote side!
     */
    public close(reason?: string): void {
        return this.connection.close(reason);
    }

    /**
     * Set the request timeout.
     *
     * This timeout specifies how long the connection will wait for new messages in the wait* methods.
     *
     * @param timeout - The new timeout. -1 means forever, > 0 is the time in ms.
     */
    /*set requestTimeout(timeout: number) {
        this.connection.defaultTimeout = timeout;
    }*/

    /**
     * Get the current request timeout.
     *
     * @returns
     */
    /*get requestTimeout(): number {
        return this.connection.defaultTimeout;
    }*/

    // ######## Message sending ########

    /**
     * Send authentication request message.
     *
     * @param publicKey - the publicKey of the communication server
     * @param challenge - the challenge that has to be decrypted by the receiver
     *                    and sent back in an authentication response message
     */
    public async sendAuthenticationRequestMessage(
        publicKey: PublicKey,
        challenge: Uint8Array
    ): Promise<void> {
        await this.sendMessage({
            command: 'authentication_request',
            publicKey: uint8arrayToHexString(publicKey),
            challenge: uint8arrayToHexString(challenge)
        });
    }

    /**
     * Send the authentication success message.
     */
    public async sendAuthenticationSuccessMessage(pingInterval: number): Promise<void> {
        const ws = this.connection.websocketPlugin().webSocket;
        let clientIp: string | undefined;
        let clientPort: number | undefined;
        
        try {
            if (ws && (ws as any)._socket) {
                clientIp = (ws as any)._socket.remoteAddress?.toString();
                clientPort = (ws as any)._socket.remotePort;
            }
        } catch (e) {
            // Ignore errors when accessing socket properties
        }
        
        await this.sendMessage({
            command: 'authentication_success', 
            pingInterval,
            clientIp,
            clientPort
        });
    }

    /**
     * Send the connection handover message.
     */
    public async sendConnectionHandoverMessage(): Promise<void> {
        await this.sendMessage({command: 'connection_handover'});
    }

    /**
     * Send Ping Message
     */
    public async sendPingMessage(): Promise<void> {
        await this.sendMessage({command: 'comm_ping'});
    }

    /**
     * Send the communication request message
     *
     * @param sourcePublicKey
     * @param targetPublicKey
     */
    public async sendCommunicationRequestMessage(
        sourcePublicKey: PublicKey,
        targetPublicKey: PublicKey
    ): Promise<void> {
        await this.sendMessage({
            command: 'communication_request',
            sourcePublicKey: uint8arrayToHexString(sourcePublicKey),
            targetPublicKey: uint8arrayToHexString(targetPublicKey)
        });
    }

    /**
     * Starts pinging the client.
     *
     * @param pingInterval - Interval since last pong when to send another ping.
     * @param pongTimeout - Time to wait for the pong (after a ping) before severing the connection.
     */
    public startPingPong(pingInterval: number, pongTimeout: number): void {
        MessageBus.send(
            'debug',
            `${this.connection.id}: startPingPong(${pingInterval}, ${pongTimeout})`
        );

        if (this.connection.hasPlugin('ping')) {
            throw new Error('Already ping / ponging');
        }

        this.connection.addPlugin(new PingPlugin(pingInterval, pongTimeout), {before: 'promise'});
    }

    /**
     * Stops the ping / pong process.
     *
     * If currently waiting for a pong, then the promise resolves
     * 1) After the pong was received
     * 2) After the pong timeout was reached
     */
    public async stopPingPong(): Promise<void> {
        MessageBus.send('log', `${this.connection.id}: stopPingPong()`);
        if (!this.connection.hasPlugin('ping')) {
            return;
        }

        await this.connection.pingPlugin().disable();
        this.connection.removePlugin('ping');
    }

    // ######## Message receiving ########

    /**
     * Wait for an arbitrary client message.
     *
     * @returns
     */
    public async waitForAnyMessage(): Promise<CommunicationServerProtocol.ClientMessageTypes> {
        const message = await this.connection.promisePlugin().waitForJSONMessage();
        if (isClientMessage(message, message.command)) {
            return message;
        }
        throw Error('Received data does not match the data of a client message.');
    }

    /**
     * Wait for a client message with certain type.
     *
     * @param command - expected command of message.
     * @returns
     */
    public async waitForMessage<T extends keyof CommunicationServerProtocol.ClientMessages>(
        command: T
    ): Promise<CommunicationServerProtocol.ClientMessages[T]> {
        const message = await this.connection
            .promisePlugin()
            .waitForJSONMessageWithType(command, 'command');
        if (isClientMessage(message, command)) {
            return message;
        }
        throw Error("Received data does not match the data expected for command '" + command + "'");
    }

    // ######## Private ########

    /**
     * Send a message to the communication server client.
     *
     * @param message - The message to send.
     */
    private async sendMessage<T extends CommunicationServerProtocol.ServerMessageTypes>(
        message: T
    ): Promise<void> {
        await this.connection.waitForOpen();
        this.connection.send(JSON.stringify(message));
    }
}

export default CommunicationServerConnection_Server;
