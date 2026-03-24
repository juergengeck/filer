import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type * as CommunicationServerProtocol from './CommunicationServerProtocol.js';
import {isServerMessage} from './CommunicationServerProtocol.js';
import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import PromisePlugin from '../../Connection/plugins/PromisePlugin.js';
import Connection from '../../Connection/Connection.js';
import {PongPlugin} from '../../Connection/plugins/PingPongPlugin.js';

/**
 * This class implements the client side of communication server communication
 */
class CommunicationServerConnection_Client {
    public connection: Connection; // The websocket used for the communication

    /**
     * Creates a client connection to a communication server for registering connection listeners.
     *
     * @param url
     */
    constructor(url: string) {
        this.connection = new Connection(createWebSocket(url));
        this.connection.addPlugin(new PromisePlugin());
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
        this.stopPingPong();
        return this.connection.websocketPlugin().releaseWebSocket();
    }

    /**
     * Closes the websocket
     *
     * @param reason - The reason for closing. If specified it is sent unencrypted to the remote side!
     */
    public close(reason?: string): void {
        return this.connection.close(reason);
    }

    /**
     * Terminates the web socket.
     *
     * @param reason - The reason for closing. If specified it is sent unencrypted to the remote side!
     */
    public terminate(reason?: string): void {
        return this.connection.terminate(reason);
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
     * Send a register message to the communication server.
     *
     * @param publicKey
     */
    public async sendRegisterMessage(publicKey: PublicKey): Promise<void> {
        await this.sendMessage({
            command: 'register',
            publicKey: uint8arrayToHexString(publicKey)
        });
    }

    /**
     * Send response to authentication request message.
     *
     * @param response
     */
    public async sendAuthenticationResponseMessage(response: Uint8Array): Promise<void> {
        await this.sendMessage({
            command: 'authentication_response',
            response: uint8arrayToHexString(response)
        });
    }

    // ######## Message receiving ########

    /**
     * Wait for a message with the specified command.
     *
     * @param  command - The expected command of the next message
     * @returns
     */
    public async waitForMessage<T extends keyof CommunicationServerProtocol.ServerMessages>(
        command: T
    ): Promise<CommunicationServerProtocol.ServerMessages[T]> {
        const message = await this.connection
            .promisePlugin()
            .waitForJSONMessageWithType(command, 'command');
        if (isServerMessage(message, command)) {
            return message;
        }
        throw Error("Received data does not match the data expected for command '" + command + "'");
    }

    /**
     * Starts answering pings of the server.
     *
     * @param pingInterval - Interval since last pong when to send another ping.
     * @param pongTimeout - Time to wait for the pong (after a ping) before severing the connection.
     */
    public startPingPong(pingInterval: number, pongTimeout: number): void {
        if (this.connection.hasPlugin('pong')) {
            throw new Error('Already ping / ponging');
        }

        this.connection.addPlugin(new PongPlugin(pingInterval, pongTimeout), {before: 'promise'});
    }

    /**
     * Stops answering pings of the server.
     */
    public stopPingPong(): void {
        if (!this.connection.hasPlugin('pong')) {
            return;
        }
        this.connection.pongPlugin().disable();
        this.connection.removePlugin('pong');
    }

    // ######## Private ########

    /**
     * Send a message to the communication server.
     *
     * @param message - The message to send
     */
    private async sendMessage<T extends CommunicationServerProtocol.ClientMessageTypes>(
        message: T
    ): Promise<void> {
        await this.connection.waitForOpen();
        this.connection.send(JSON.stringify(message));
    }
}

export default CommunicationServerConnection_Client;
