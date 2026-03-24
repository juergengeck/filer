// noinspection JSMethodCanBeStatic

import {getUint8Array} from '@refinio/one.core/lib/util/buffer.js';
import type {
    ConnectionClosedEvent,
    ConnectionIncomingEvent,
    ConnectionOutgoingEvent,
    EventCreationFunctions
} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';

/**
 * Returns the byte count of the passed string in UTF-8 notation.
 *
 * @param input
 */
function utf8ByteCount(input: string): number {
    return new TextEncoder().encode(input).length;
}

/**
 * Shortens the input string to be lesser or equal than maxByteLength in UTF-8 representation.
 *
 * It is not the most efficient solution, but the efficient solution would be much more complex like
 * estimating the number of bytes that have to be removed by something like ceil(length -
 * mayByteLength / 4)
 *
 * @param input - Input string that is possibly longer than maxByteLength
 * @param maxByteLength - Maximum length.
 */
function shortenStringUTF8(input: string, maxByteLength: number): string {
    let inputShort = input;
    while (utf8ByteCount(inputShort) > maxByteLength) {
        inputShort = inputShort.slice(0, -1);
    }
    return inputShort;
}

/**
 * This class is a wrapper for web sockets, that allows to receive messages with async / await
 * instead of using callbacks (onmessage onopen ...)
 *
 * It also has a on('message') event, because sometimes you just need it. When you solely use the
 * event based interface, and don't use the waitForMessage functions, then you need to set
 * disableWaitForMessage to true, because otherwise you will get an error that you didn't collect
 * incoming messages with waitFor... functions.
 */
export default class WebSocketPlugin extends ConnectionPlugin {
    // Members
    public webSocket: WebSocket | null;
    private readonly deregisterHandlers: () => void;
    private closeEventSent = false;
    private closedReason: ConnectionClosedEvent | null = null;

    /**
     * Construct a new connection - at the moment based on WebSockets
     */
    constructor(webSocket: WebSocket) {
        super('websocket');

        // Setup members
        this.webSocket = webSocket;

        // Configure for binary messages
        this.webSocket.binaryType = 'arraybuffer';

        // configure websocket callbacks
        const boundOpenHandler = this.handleOpen.bind(this);
        const boundMessageHandler = this.handleMessage.bind(this);
        const boundCloseHandler = this.handleClose.bind(this);
        const boundErrorHandler = this.handleError.bind(this);
        this.webSocket.addEventListener('open', boundOpenHandler);
        this.webSocket.addEventListener('message', boundMessageHandler);
        this.webSocket.addEventListener('close', boundCloseHandler);
        this.webSocket.addEventListener('error', boundErrorHandler);
        this.deregisterHandlers = () => {
            if (this.webSocket) {
                this.webSocket.removeEventListener('open', boundOpenHandler);
                this.webSocket.removeEventListener('message', boundMessageHandler);
                this.webSocket.removeEventListener('close', boundCloseHandler);
                this.webSocket.removeEventListener('error', boundErrorHandler);
            }
        };
    }

    public attachedToConnection(eventCreationFunctions: EventCreationFunctions, id: number): void {
        super.attachedToConnection(eventCreationFunctions, id);
        const webSocket = this.assertNotDetached();

        if (webSocket.readyState === webSocket.OPEN) {
            this.handleOpen(null);
        }
        if (
            webSocket.readyState === webSocket.CLOSING ||
            webSocket.readyState === webSocket.CLOSED
        ) {
            this.setClosedReasonOnce('Websocket was already closed', 'local');
            this.sendClosedEvent();
        }
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        return null;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        if (event.type === 'close') {
            if (event.terminate) {
                this.terminate(event.reason);
            } else {
                this.close(event.reason);
            }
        }
        if (event.type === 'message') {
            let arr: ArrayBufferLike | string;
            if (typeof event.data === 'string') {
                arr = event.data;
            } else {
                arr = event.data.buffer.slice(
                    event.data.byteOffset,
                    event.data.byteOffset + event.data.byteLength
                );
            }

            this.assertOpen().send(arr);
        }
        return null;
    }

    /**
     * Releases the websocket from this class.
     *
     * All handlers are de-registered, the rest is left as-is.
     *
     * Attention: If messages arrive in the meantime they might get lost.
     *            Usually it is better to pass around the WebSocketPromiseBased
     *            instance, because it buffers messages that arrive in the time
     *            until new handlers are registered.
     */
    public releaseWebSocket(): WebSocket {
        if (!this.webSocket) {
            throw Error('No websocket is bound to this instance.');
        }

        this.deregisterHandlers();
        this.setClosedReasonOnce('detached websocket', 'local');
        this.sendClosedEvent();

        const webSocket = this.webSocket;
        this.webSocket = null;
        return webSocket;
    }

    // ######## Private API ########

    /**
     * Closes the underlying websocket.
     *
     * This function waits for the other side to also close the Tcp connection
     * by responding with a FIN package. This might lead to a delay if the
     * connection was interrupted because e.g. the wireless adapter was switched
     * off.
     *
     * @param reason - Reason for timeout
     */
    private close(reason?: string): void {
        const webSocket = this.assertNotDetached();
        if (webSocket.readyState !== webSocket.OPEN) {
            return;
        }

        const wholeReason = 'Close called' + (reason === undefined ? '.' : `: ${reason}`);

        // Shorten the reason string to maximum 123 bytes, because the standard mandates it:
        // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
        webSocket.close(1000, shortenStringUTF8(wholeReason, 123));
        this.setClosedReasonOnce(wholeReason, 'local');
    }

    /**
     * Terminates the connection immediately without waiting for the Tcp FIN handshake.
     *
     * This function terminates the readers immediately instead of waiting for the
     * other side to also close the websocket by sending the Tcp FIN package. This
     * function should only be used when a connection loss is detected (PING / PONG
     * timeout)
     *
     * This also releases the websocket, because the state might still be open, but
     * we don't want anyone to do any operation on the websocket anymore.
     *
     * @param reason - Reason for timeout
     */
    private terminate(reason?: string): void {
        const webSocket = this.assertNotDetached();
        if (webSocket.readyState !== webSocket.OPEN) {
            return;
        }

        const wholeReason = 'Terminate called' + (reason === undefined ? '.' : `: ${reason}`);

        // Shorten the reason string to maximum 123 bytes, because the standard mandates it:
        // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
        webSocket.close(1000, shortenStringUTF8(wholeReason, 123));
        this.setClosedReasonOnce(wholeReason, 'local');
        this.sendClosedEvent();
    }

    /**
     * Set the close reason.
     *
     * If called multiple times only the reason of the first call will be kept.
     *
     * @param reason
     * @param origin
     */
    private setClosedReasonOnce(reason: string, origin: 'local' | 'remote'): void {
        if (this.closedReason === null) {
            this.closedReason = {
                type: 'closed',
                reason,
                origin
            };
        }
    }

    /**
     * Send the close reason that was previously set with setClosedReasonOnce.
     */
    private sendClosedEvent(): void {
        if (this.closeEventSent) {
            return;
        }

        this.eventCreationFunctions.createIncomingEvent(
            this.closedReason || {
                type: 'closed',
                reason:
                    'No reason specified, this should not happen and is most likely an' +
                    ' implementation error.',
                origin: 'local'
            }
        );
        this.closeEventSent = true;
    }

    /**
     * Assert that the websocket is not detached.
     */
    private assertNotDetached(): WebSocket {
        if (!this.webSocket) {
            throw new Error('No websocket is bound to this instance.');
        }

        return this.webSocket;
    }

    /**
     * Function asserts that the connection is open.
     *
     * If it is closed it will throw an error with a message having the close reason.
     */
    private assertOpen(): WebSocket {
        const webSocket = this.assertNotDetached();

        if (webSocket.readyState === webSocket.CONNECTING) {
            throw new Error('The websocket was not opened, yet.');
        }

        if (webSocket.readyState !== webSocket.OPEN) {
            throw new Error(`The websocket was closed: ${this.closedReason?.reason}`);
        }

        return webSocket;
    }

    // ######## Private API - WebSocket event handler ########

    /**
     * This function handles the web sockets open event
     *
     * It notifies any waiting reader.
     *
     * @param openEvent
     */
    private handleOpen(openEvent: unknown) {
        this.eventCreationFunctions.createIncomingEvent({
            type: 'opened'
        });
    }

    /**
     * This function handles the web sockets message event
     *
     * It enqueues the data and notifies any waiting reader.
     *
     * @param messageEvent
     */
    private handleMessage(messageEvent: MessageEvent) {
        this.eventCreationFunctions.createIncomingEvent({
            type: 'message',
            data:
                typeof messageEvent.data === 'string'
                    ? messageEvent.data
                    : getUint8Array(messageEvent.data)
        });
    }

    /**
     * This function handles the websockets close event
     *
     * It notifies any waiting reader.
     *
     * @param closeEvent
     */
    private handleClose(closeEvent: CloseEvent) {
        this.setClosedReasonOnce(`${closeEvent.reason}`, 'remote');
        this.sendClosedEvent();
    }

    /**
     * This function handles the websockets error event
     *
     * It notifies any waiting reader.
     *
     * @param errorEvent
     */
    private handleError(errorEvent: Event) {
        this.setClosedReasonOnce(`Error: ${(errorEvent as any).message}`, 'local');
        this.sendClosedEvent();
    }
}