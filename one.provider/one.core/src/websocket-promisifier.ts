/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module provides an API for a websocket connection. Services provided by one side can be
 * called by the other through a promisified cross-network function (service) call, and use of a
 * communication server as middleman so that clients that themselves cannot provide a network
 * service can act as service providers through the middleman.
 *
 * Receiving events from the communication partner(s) is possible by providing an
 * event-message receiving service on the client's side.
 *
 * ONE.core uses this module for its {@link chum-sync.ts|chum-sync} module. The entire module
 * can be used by apps using the one.core library on both sides to provide cross-client
 * communication.
 * @module
 */

/**
 * The API assumes that all communication goes through a communication server that forwards
 * messages between clients that usually could not connect directly to one another. Client code
 * receives the API-object of this type when the other client has connected to the same
 * communication server, so that an end-to-end connection exists with the comm-server in the
 * middle as forwarding agent.
 *
 * Use `send()` to send requests, use `close()` to end the connection. The final close status
 * consisting of code and reason from the WebSocket's CloseEvent (see
 * {@link https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent}) are available
 * directly through the `promise`. If the CloseEvent was the result of calling
 * `close()` as either a resolved promise if the code was 1000 (`NORMAL`), or a rejected
 * promise with an Error object with code and reason in the Error's `message` string property.
 *
 * Note that none of the API functions need to be bound (they don't use `this`).
 * @typedef {object} WebsocketPromisifierAPI
 * @property {Promise<{code:number,reason:string}>} promise - Promise tracking the websocket state
 * @property {number} connId - The ID of the underlying `Connection`
 * @property {function(number,AnyFunction):void} addService
 * @property {function(number):void} removeService
 * @property {function():void} clearServices
 * @property {function(string,string,number=):Promise<undefined>} connect
 * @property {function(number,...*):Promise<*>} send - 1st param: Service ID, rest: params for
 * service function
 * @property {function(string):void} close - Initiate connection shutdown, results are in
 * `promise. The optional close reason string must be no longer than 123 bytes (encoded in
 * UTF-8). If it is longer, one.models' WebSocketPlugin close() function will shorten it
 * automatically.
 * @property {WebsocketStatistics} stats - Read-only access to sent/received bytes and nr.
 * of requests statistics
 */
export interface WebsocketPromisifierAPI {
    promise: Promise<WebsocketStatistics>;
    connId: number;
    addService: (id: number, fn: AnyFunction) => void;
    removeService: (id: number) => void;
    clearServices: () => void;
    send: (type: number, ...args: readonly unknown[]) => Promise<unknown>;
    close: (reason?: string) => void;
    stats: Readonly<WebsocketStatistics>;
}

export interface MsgResponseObject {
    responseId: number;
    type: 'data';
    data: unknown;
}

export interface MsgResponseStreamObject {
    responseId: number;
    type: 'stream';
    chunk: string;
    encoding: undefined | 'base64' | 'utf8';
}

export interface MsgResponseStreamEndObject {
    responseId: number;
    type: 'stream-end';
}

export interface MsgResponseStreamErrorObject {
    responseId: number;
    type: 'stream-error';
    error: string;
}

export interface MsgResponseErrorObject {
    responseId: number;
    type: 'error';
    error: {
        name?: string;
        message: string;
        code?: string;
    };
}

export type MsgResponseTypes =
    | MsgResponseObject
    | MsgResponseStreamObject
    | MsgResponseStreamEndObject
    | MsgResponseStreamErrorObject
    | MsgResponseErrorObject;

export interface MsgRequestObject {
    requestId: number;
    type: 'request';
    serviceId: number;
    args?: undefined | readonly unknown[];
}

export interface MsgRequestErrorObject {
    requestId: number;
    type: 'write-stream-error';
}

export type MsgRequestTypes = MsgRequestObject | MsgRequestErrorObject;

export type FindServiceByChannelAndId = (id: number) => void | AnyFunction;

export interface EncryptedConnectionInterface {
    id: number;

    close(reason?: string): void;

    send(message: ArrayBufferLike | Uint8Array | string): void;

    bufferedAmount: number;
    state: {
        onEnterState: {
            listen(listener: (state: 'connecting' | 'open' | 'closed') => void): () => void;
        };
        currentState: 'connecting' | 'open' | 'closed';
    };
    onMessage: {
        listen(listener: (message: ArrayBufferLike | Uint8Array | string) => void): () => void;
    };
}

export type RequestData = [
    serviceId: number,
    resolve: PromiseResolveCb<any>,
    reject: PromiseRejectCb
];

import {createError} from './errors.js';
import {createMessageBus} from './message-bus.js';
import type {WebsocketStatistics} from './recipes.js';
import {getArrayBuffer, getUint8Array} from './util/buffer.js';
import type {AnyFunction} from './util/function.js';
import {createReadonlyTrackingObj} from './util/object.js';
import type {PromiseRejectCb, PromiseResolveCb} from './util/promise.js';
import {createTrackingPromise} from './util/promise.js';
import {isFunction, isInteger, isObject, isString, isSymbol} from './util/type-checks-basic.js';
import type {ElementType} from './util/type-checks.js';
import type {WebsocketRequestHandler} from './websocket-request-handler.js';
import {createRequestHandler} from './websocket-request-handler.js';
import type {WebsocketResponseHandler} from './websocket-response-handler.js';
import {createResponseHandler} from './websocket-response-handler.js';
import {isSharedArrayBufferSupported} from './util/feature-detection.js';

const MessageBus = createMessageBus('websocket-promisifier');

// When sending requests to the remote client undefined values in JSON-stringified arguments
// that are undefined are represented by this string constant. JSON.stringify would turn
// undefined into null. The string is chosen in the hope that there is no such string as
// (complete) value in the data.
// Also see {@link encodeUnstringifiableValues} and {@link decodeUnstringifiableValues}
const UNDEFINED_STR = '$__undefined$';

/**
 * ### Utility function for JSON.stringify
 *
 * Used to encode special values for the JSON string that we sent over a websocket connection.
 *
 * The encode/decode utility functions used with JSON.stringify and JSON.parse, respectively,
 * only encode (and decode) special values that we actually need. We definitely need to
 * support `undefined`, because when calling a remote service - a remote function - that is a
 * plausible value for a parameter for a function. The arguments are items in an array, and
 * JSON.stringify changes `undefined` to `null` in an array context. This would have undesirable
 * consequences, since an `undefined` function parameter often is incompatible with setting
 * the same parameter to `null`.
 *
 * Functions as parameters: While obviously a common thing in JS code, sending a function to the
 * remote site for execution is not supported.
 *
 * Symbols: Unsupported, since it is hard to see the value of sending a symbol across the net.
 *
 * Special numeric values: For now we simply forbid sending NaN or Infinity since it's hard to
 * see a use case.
 *
 * However, the function does not silently swallow unsupported values but throws an error when
 * it encounters one.
 * @private
 * @param {string} key - Ignored/unused
 * @param {*} value - Any value
 * @returns {*} Returns the input value <i>except</i> for when the input value is `undefined`,
 * in which case a replacement string is returned
 * @throws {Error} Throws an `Error` if a value is of an unsupported type
 */
function encodeUnstringifiableValues<T extends unknown>(
    key: string,
    value: T
): T | typeof UNDEFINED_STR {
    // Support "undefined" so that optional parameters using variables with a possible value of
    // "undefined" can be used as arguments when sending requests
    if (value === undefined) {
        return UNDEFINED_STR;
    }

    if (
        isSymbol(value) ||
        isFunction(value) ||
        value === Infinity ||
        value === -Infinity ||
        Number.isNaN(value)
    ) {
        throw createError('WSP-ESV', {
            key,
            value: isFunction(value) ? '[function]' : String(value),
            typeofValue: typeof value
        });
    }

    return value;
}

/**
 * ### Utility function for JSON.parse
 *
 * Used to decode special values for the JSON string that we received over a websocket connection.
 *
 * This function decodes values found while parsing JSON encoded on another machine. Also see
 * {@link encodeUnstringifiableValues}.
 * @private
 * @param {string} _key - Ignored/unused
 * @param {*} value
 * @returns {*} Returns the decoded value or if no decoding was necessary the value itself
 */
function decodeUnstringifiableValues<T extends unknown>(_key: string, value: T): undefined | T {
    if (value === UNDEFINED_STR) {
        return undefined;
    }

    return value;
}

const ResponseTypes: Set<MsgResponseTypes['type']> = new Set([
    'data',
    'stream',
    'stream-end',
    'stream-error',
    'error'
] as const);

/**
 * @private
 * @param {*} thing
 * @returns {boolean}
 */
function isMsgResponse(thing: unknown): thing is MsgResponseTypes {
    return isObject(thing) && ResponseTypes.has(thing.type) && isInteger(thing.responseId);
}

// const RequestTypes: Set<MsgRequestTypes['type']> = new Set([
//     'request',
//     'write-stream-error'
// ] as const);

/**
 * @private
 * @param {*} thing
 * @returns {boolean}
 */
function isMsgRequest(thing: unknown): thing is MsgRequestTypes {
    return (
        isObject(thing) &&
        ((thing.type === 'request' && isInteger(thing.requestId) && isInteger(thing.serviceId)) ||
            thing.type === 'write-stream-error')
    );
}

/**
 * Two types of messages: binary or JSON. The former always are chunks of files streamed to us
 * in response to a request, which is why we can relay such response types to the
 * websocket-response-handler module right away. JSON messages however can be
 * - Requests to us
 * - Responses to our requests
 * - Client-errors encountered when saving stream chunks it requested (the only kind of client
 *   errors we need to learn about, to stop the stream and not waste bandwidth for data the
 *   client cannot handle anymore)
 * - Messages from the communication server
 * @private
 * @param {WebsocketMessageResponseHandler} requestHandler
 * @param {WebsocketMessageResponseHandler} responseHandler
 * @param {WebsocketStatistics} statistics
 * @returns {WebsocketMessageResponseHandler} Returns a {@link JsonMessageHandlerFn} function
 */
function createJsonMessageHandler(
    requestHandler: WebsocketRequestHandler['requestMsgHandler'],
    responseHandler: WebsocketResponseHandler['jsonResponseMsgHandler'],
    statistics: WebsocketStatistics
): (json: string) => void {
    return (json: string): void => {
        // In the error cases below there is no way to find which request may have lead to the
        // response, so we can only make a note, but we cannot find a specific request whose promise
        // we could reject as failed. Such an error always is an error of the connection as a whole.

        // UNKNOWN NETWORK DATA
        let msg;

        // POLICY DECISION: Ignore erroneous or unparsable messages

        try {
            msg = JSON.parse(json, decodeUnstringifiableValues);
        } catch (_) {
            statistics.requestsReceivedInvalid += 1;
            return MessageBus.send('alert', 'Received unparsable message: ' + json);
        }

        if (!isObject(msg)) {
            statistics.requestsReceivedInvalid += 1;
            return MessageBus.send('alert', 'Received message is invalid:' + json);
        }

        // Asynchronous - but no use "await"-ing the result because there is nobody there waiting
        // for it apart from the communication partner that sent the request (in a different
        // environment)
        if (isMsgRequest(msg)) {
            // Requests to us, and client-side stream error notifications
            statistics.requestsReceivedTotal += 1;
            requestHandler(msg);
        } else if (isMsgResponse(msg)) {
            // Responses to requests we sent (incl. to the communication server)
            responseHandler(msg);
        } else {
            statistics.requestsReceivedInvalid += 1;
            MessageBus.send('alert', 'Received message is invalid:' + json);
        }
    };
}

/**
 * @static
 * @param {EncryptedConnectionInterface} connection
 * @returns {WebsocketPromisifierAPI} Returns a {@link WebsocketPromisifierAPI} object
 */
export function createWebsocketPromisifier(
    connection: EncryptedConnectionInterface
): WebsocketPromisifierAPI {
    // These are the services we make available to remote ONE instances.
    const services: Map<number, AnyFunction> = new Map();

    // For progress reports to the code using the websocket (reported once per second). The
    // number of sent bytes is obtained by intercepting calls to connection.send(), the number of
    // received bytes is obtained in connection.onMessage.
    const statistics: WebsocketStatistics = {
        requestsSentTotal: 0,
        // Counted in createJsonMessageHandler (it's always JSON, and onMessage could get things
        // other than requests)
        requestsReceivedTotal: 0,
        requestsReceivedInvalid: 0
    };

    function sendObj(data: MsgRequestTypes | MsgResponseTypes): void {
        const str = JSON.stringify(data, encodeUnstringifiableValues);
        return connection.send(str);
    }

    function sendBuf(data: ArrayBufferLike | Uint8Array): void {
        return connection.send(data);
    }

    // 1. For internal use: To find a service
    function getService(id: number): void | AnyFunction {
        return services.get(id);
    }

    // API FUNCTIONS

    // 2. Exported for external use: To control services
    function addService(id: number, fn: AnyFunction): void {
        services.set(id, fn);
    }

    function removeService(id: number): void {
        services.delete(id);
    }

    function clearServices(): void {
        services.clear();
    }

    // The key, a number, is a numeric request ID. The value is the request's service ID number
    // and a pair of functions, the send-request's promise's resolve() and reject() functions,
    // respectively. The promise is created when a request is sent. It can be resolved when a
    // message with the same request ID is received (but the property will be called
    // "responseId" to show it is a response to one of our requests). It can be rejected if
    // communication ends, either because of an error or because it is shut down, so that we
    // don't leave promises hanging.
    // The target service ID is included for debugging and error messages, to be able to tell
    // what kind of request was sent.
    const requests: Map<number, RequestData> = new Map();

    function send(serviceId: number, ...args: readonly unknown[]): Promise<unknown> {
        return new Promise((resolve, reject) => {
            if (!isInteger(serviceId) || serviceId <= 0) {
                return reject(
                    createError('WSP-SN3', {
                        serviceId,
                        typeOfType: typeof serviceId
                    })
                );
            }

            const requestId = statistics.requestsSentTotal;

            // These messages will be passed on to the actual communication partner even
            // though we send it to the communication server
            sendObj({
                requestId,
                type: 'request',
                serviceId,
                args
            } as MsgRequestObject);

            statistics.requestsSentTotal += 1;

            // The promise is resolved when the onmessage handler receives a message (a
            // response) with this ID. It is rejected if there is a communication error,
            // which would prevent the promise from ever being resolved.
            // NOTE: In response messages this request ID will be in property "responseId"
            requests.set(requestId, [serviceId, resolve, reject]);
        });
    }

    function close(reason?: string): void {
        connection.close(reason);
    }

    // CONNECTION EVENT HANDLING

    function onMsgHandler(data: unknown): void {
        try {
            if (data instanceof Uint8Array) {
                // These messages always are responses to our requests for files - if
                // they are sent from a Buffer (we use base64 strings for binary file
                // transfer due to limitations of the React Native platform)
                binaryResponseMsgHandler(getArrayBuffer(data).slice(data.byteOffset, data.byteOffset + data.byteLength));
            }
            else if (data instanceof ArrayBuffer || (isSharedArrayBufferSupported() && data instanceof globalThis.SharedArrayBuffer)) {
                // These messages always are responses to our requests for files - if
                // they are sent from a Buffer (we use base64 strings for binary file
                // transfer due to limitations of the React Native platform)
                const buffer = getUint8Array(data);
                binaryResponseMsgHandler(data.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
            }
            else if (isString(data)) {
                // These messages can be responses to requests we sent, or requests sent
                // to us, or parts of base64-encoded file streams that we receive
                handleJsonMsg(data);
            }
        }
        catch (err) {
            MessageBus.send('error', `Connection [${connection.id}] error from the remote`, err);
            // TRANSPARENCY: Added error reason
            connection.close(`onMsgHandler error: ${String(err)}`);
        }
    }

    // The promise created here is for the entire websocket connection.
    const wsTracker = createTrackingPromise<WebsocketStatistics>();

    function onConnectionStateChange(
        state: ElementType<
            Parameters<
                ElementType<
                    Parameters<EncryptedConnectionInterface['state']['onEnterState']['listen']>
                >
            >
        >
    ): void {
        if (state !== 'closed') {
            return;
        }

        // This is a purely internal cleanup canceling any open read and write streams
        // and is independent of rejection of all open requests above
        cancelReadStreams();
        cancelWriteStreams();

        if (requests.size > 0) {
            const error = createError('WSP-ONCL0');

            const serviceIds: number[] = [];

            // This always is a rejected promise regardless of websocket close code since we
            // don't have the result that was requested
            requests.forEach(([serviceId, _resolveFn, rejectFn], _requestId) => {
                serviceIds.push(serviceId);
                rejectFn(error);
            });

            wsTracker.reject(
                createError('WSP-ONCL1', {
                    nr: requests.size,
                    serviceIds
                })
            );

            requests.clear();

            return;
        }

        wsTracker.resolve(statistics);
    }

    const sunsubscribeOnEnterState = connection.state.onEnterState.listen(onConnectionStateChange);
    const unsubscribeOnMessage = connection.onMessage.listen(onMsgHandler);

    wsTracker.promise
        .catch(_ignore => null)
        .finally(() => {
            sunsubscribeOnEnterState();
            unsubscribeOnMessage();
        });

    // Create response handler functions for messages we receive in response to our
    // requests to the other side:
    const {
        // Responses to requests for files (chunk parts of binary or BASE64 streams)
        binaryResponseMsgHandler,
        // JSON responses (everything that is not a binary message)
        jsonResponseMsgHandler,
        // Helper: Cancel all open write file streams for unfinished requests for files
        cancelWriteStreams
    } = createResponseHandler(requests, sendObj);

    const {requestMsgHandler, cancelReadStreams} = createRequestHandler(
        getService,
        connection,
        sendObj,
        sendBuf
    );

    // The message handler function creation has to happen outside the "onmessage" event
    // handler using them. We don't want to create a new handler function each time an
    // event occurs.
    const handleJsonMsg = createJsonMessageHandler(
        requestMsgHandler,
        jsonResponseMsgHandler,
        statistics
    );

    // The API-object is used to resolve the current promise of connectAndRegisterServices()
    // with - as soon as the communication server sends a response to our request #0 sent by
    // the WebSocket "onopen" event handler below.
    return {
        promise: wsTracker.promise,
        connId: connection.id,
        addService,
        removeService,
        clearServices,
        send,
        close,
        stats: createReadonlyTrackingObj<WebsocketStatistics>(statistics)
    };
}
