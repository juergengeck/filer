import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';
import BlockingQueue from '../../BlockingQueue.js';

export default class PromisePlugin extends ConnectionPlugin {
    private dataQueue: BlockingQueue<ConnectionIncomingEvent>;
    private isOpen = false;

    constructor(maxDataQueueSize = 10, defaultReadTimeout = Number.POSITIVE_INFINITY) {
        super('promise');
        this.dataQueue = new BlockingQueue<ConnectionIncomingEvent>(
            maxDataQueueSize,
            1,
            defaultReadTimeout
        );
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type === 'opened') {
            this.isOpen = true;
        } else {
            this.dataQueue.add(event);
        }
        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        return event;
    }

    public cleanup(reason?: string) {
        this.dataQueue.cancelPendingPromises(new Error(reason));
    }

    // ######## Receiving messages ########

    /**
     * Wait for an incoming message with a specific type for a specified period of time.
     *
     * @param type    - The type field of the message should have this type.
     * @param typekey - The name of the member that holds the type that is checked for equality
     *                  with the type param.
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     * @returns The promise will resolve when a value was received. The value will be the
     *          JSON.parse'd object
     *          The promise will reject when
     *          1) the timeout expired
     *          2) the connection was closed
     *          3) the type of the received message doe not match parameter
     *             'type'
     */
    public async waitForJSONMessageWithType(
        type: string,
        typekey: string = 'type',
        timeout?: number
    ): Promise<any> {
        const messageObj = await this.waitForJSONMessage(timeout);

        // Assert that is has a 'type' member
        if (!Object.prototype.hasOwnProperty.call(messageObj, typekey)) {
            throw new Error(`Received message without a '${typekey}' member.`);
        }

        // Assert that the type matches the requested one
        if (messageObj[typekey] !== type) {
            throw new Error(
                `Received unexpected type '${messageObj[typekey]}'. Expected type '${type}'.`
            );
        }

        return messageObj;
    }

    /**
     * Wait for an incoming message for a specified period of time.
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     * @returns The promise will resolve when a value was received. The value will be the
     *          JSON.parsed object.
     *          The promise will reject when
     *          1) the timeout expired
     *          2) the connection was closed
     */
    public async waitForJSONMessage(timeout?: number): Promise<any> {
        const message = await this.waitForStringMessage(timeout);

        try {
            return JSON.parse(message);
        } catch (e) {
            throw new Error('Received message that does not conform to JSON: ' + e.toString());
        }
    }

    /**
     * Wait for a binary message.
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     * @returns The promise will resolve when a value was received.
     *          The promise will reject when
     *          1) the timeout expired
     *          2) the connection was closed
     */
    public async waitForBinaryMessage(timeout?: number): Promise<Uint8Array> {
        const message = await this.waitForMessage(timeout);
        if (!(message instanceof Uint8Array)) {
            throw new Error('Received message that is not a binary message.');
        }
        return new Uint8Array(message);
    }

    /**
     * Wait for a string based message.
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     * @returns The promise will resolve when a value was received.
     *          The promise will reject when
     *          1) the timeout expired
     *          2) the connection was closed
     */
    public async waitForStringMessage(timeout?: number): Promise<string> {
        const message = await this.waitForMessage(timeout);
        if (typeof message !== 'string') {
            throw new Error('Received message that is not a string message.');
        }
        return message;
    }

    /**
     * Wait for an incoming message for a specified period of time.
     *
     * @param timeout - Timeout as unsigned 32-bit integer or Number.POSITIVE_INFINITY. If
     *                  undefined use the default value passed to the constructor.
     * @returns The promise will resolve when a value was received.
     *          The promise will reject when
     *          1) the timeout expired
     *          2) the connection was closed
     */
    public async waitForMessage(timeout?: number): Promise<Uint8Array | string> {
        if (!this.isOpen) {
            throw new Error('The connection is not open, yet.');
        }

        const event = await this.dataQueue.remove(timeout);
        while (event.type !== 'message') {
            if (event.type === 'closed') {
                this.isOpen = false;
                throw new Error(`The connection was closed. ${event.reason}`);
            }
        }

        return event.data;
    }
}
