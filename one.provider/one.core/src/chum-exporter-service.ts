/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {
    getAccessibleRootHashes,
    getChildren,
    getChildrenForIdObject,
    isAccessibleBy,
    isIdAccessibleBy
} from './accessManager.js';
import {MESSAGE_TYPES, PROTOCOL_VERSION} from './chum-base.js';
import {createError, type ErrorWithCode} from './errors.js';
import {createMessageBus} from './message-bus.js';
import type {BLOB, CLOB, OneObjectTypes, OneVersionedObjectTypes, Person} from './recipes.js';
import type {SimpleReadStream} from './storage-base-common.js';
import {readUTF8TextFile} from './system/storage-base.js';
import {createFileReadStream} from './system/storage-streams.js';
import type {AnyFunction} from './util/function.js';
import {createRethrowingAsyncErrorWrapper} from './util/function.js';
import {ID_OBJ_MICRODATA_START, MICRODATA_START} from './util/object.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {ensureHash, ensureIdHash} from './util/type-checks.js';
import type {WebsocketPromisifierAPI} from './websocket-promisifier.js';

const MessageBus = createMessageBus('chum-exporter-service-functions');

/**
 * Manages and implements all service functions exported by the exporter.
 */
export class ExporterService {
    private readonly ws: WebsocketPromisifierAPI;
    private readonly remotePersonId: SHA256IdHash<Person>;
    private readonly services: Array<[number, AnyFunction]>;
    private readonly objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>;

    onError?: (err: ErrorWithCode) => void;
    onBlobSent?: (hash: SHA256Hash<BLOB>) => void;
    onClobSent?: (hash: SHA256Hash<CLOB>) => void;
    onObjectSent?: (hash: SHA256Hash) => void;
    onIdObjectSent?: (hash: SHA256IdHash) => void;
    onFin?: () => void;

    /**
     * @param {WebsocketPromisifierAPI} ws
     * @param {SHA256IdHash<Person>} remotePersonId
     * @param {Function} objectFilter - Optional filter function to determine if an object should be shared
     */
    constructor(
        ws: WebsocketPromisifierAPI,
        remotePersonId: SHA256IdHash<Person>,
        objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
    ) {
        this.ws = ws;
        this.remotePersonId = remotePersonId;
        this.objectFilter = objectFilter;
        this.services = [
            [MESSAGE_TYPES.GET_PROTOCOL_VERSION, this.getProtocolVersion],
            [MESSAGE_TYPES.GET_ACCESSIBLE_ROOTS, this.getAccessibleRoots],
            [MESSAGE_TYPES.GET_OBJECT_CHILDREN, this.getObjectChildren],
            [MESSAGE_TYPES.GET_ID_OBJECT_CHILDREN, this.getIdObjectChildren],
            [MESSAGE_TYPES.GET_OBJECT, this.getObject],
            [MESSAGE_TYPES.GET_ID_OBJECT, this.getIdObject],
            [MESSAGE_TYPES.GET_BLOB, this.getBlob],
            [MESSAGE_TYPES.FIN, this.handleFin]
        ];
    }

    /**
     * Starts the exporter by registereing all services at the web socket object.
     */
    start(): void {
        const serviceFnErrorWrapper = createRethrowingAsyncErrorWrapper(error => {
            this.onError && this.onError(error);
        });

        for (const [serviceId, serviceFn] of this.services) {
            this.ws.addService(serviceId, serviceFnErrorWrapper(serviceFn.bind(this)));
        }
    }

    /**
     * Stops the exporter by de-registereing all services at the web socket object.
     */
    stop(): void {
        for (const [serviceId] of this.services) {
            this.ws.removeService(serviceId);
        }
    }

    // #### Implementation of the services ####

    /**
     * Implementation of the GET_PROTOCOL_VERSION service
     *
     * @returns {Promise<string>}
     * @private
     */
    private async getProtocolVersion(): Promise<number> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_PROTOCOL_VERSION`);

        const result = PROTOCOL_VERSION;

        MessageBus.send('debug', `[${this.ws.connId}] GET_PROTOCOL_VERSION DONE: ${result}`);

        return result;
    }

    /**
     * Implementation of the GET_ACCESSIBLE_ROOTS service
     *
     * @returns {Promise<string>}
     * @private
     */
    private async getAccessibleRoots(): Promise<string> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_ACCESSIBLE_ROOTS`);

        const result = JSON.stringify(await getAccessibleRootHashes(this.remotePersonId, this.objectFilter));

        MessageBus.send('debug', `[${this.ws.connId}] GET_ACCESSIBLE_ROOTS DONE: ${result}`);

        return result;
    }

    /**
     * Implementation of the GET_OBJECT_CHILDREN service
     *
     * @param {unknown} data - The hash of the object for which to determine children
     * @returns {Promise<string>}
     * @private
     */
    private async getObjectChildren(data: unknown): Promise<string> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_OBJECT_CHILDREN ${data}`);

        const hash = ensureHash<OneObjectTypes>(data);

        if (!(await isAccessibleBy(this.remotePersonId, hash))) {
            throw createError('CES-GOC1', {hash});
        }

        const result = JSON.stringify(await getChildren(this.remotePersonId, hash));

        MessageBus.send('debug', `[${this.ws.connId}] GET_OBJECT_CHILDREN DONE: ${result}`);

        return result;
    }

    /**
     * Implementation of the GET_ID_OBJECT_CHILDREN service
     *
     * @param {unknown} data - The hash of the id-object for which to determine children
     * @returns {Promise<string>}
     * @private
     */
    private async getIdObjectChildren(data: unknown): Promise<string> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_ID_OBJECT_CHILDREN ${data}`);

        const idHash = ensureIdHash<OneVersionedObjectTypes>(data);

        if (!(await isIdAccessibleBy(this.remotePersonId, idHash))) {
            throw createError('CES-GIDOC1');
        }

        const result = JSON.stringify(await getChildrenForIdObject(this.remotePersonId, idHash));

        MessageBus.send('debug', `[${this.ws.connId}] GET_OBJECT_CHILDREN DONE: ${result}`);

        return result;
    }

    /**
     * Implementation of the GET_OBJECT service
     *
     * @param {unknown} data - The hash of object to fetch
     * @returns {Promise<string>}
     * @private
     */
    private async getObject(data: unknown): Promise<string> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_OBJECT ${data}`);

        // RECEIVES NETWORK DATA (type enforced below)
        const hash = ensureHash<OneObjectTypes>(data);

        if (!(await isAccessibleBy(this.remotePersonId, hash))) {
            throw createError('CES-GO1', {hash});
        }

        const microdata = await readUTF8TextFile(hash);

        if (!microdata.startsWith(MICRODATA_START)) {
            throw createError('CES-GO2', {hash});
        }

        this.onObjectSent && this.onObjectSent(hash);

        return microdata;
    }

    /**
     * Implementation of the GET_ID_OBJECT service
     *
     * @param {unknown} data - The hash of id-object to fetch
     * @returns {Promise<string>}
     * @private
     */
    private async getIdObject(data: unknown): Promise<string> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_ID_OBJECT ${data}`);

        const idHash = ensureIdHash(data);

        if (!(await isIdAccessibleBy(this.remotePersonId, idHash))) {
            throw createError('CES-GIDO1', {idHash});
        }

        const microdata = await readUTF8TextFile(idHash);

        if (!microdata.startsWith(ID_OBJ_MICRODATA_START)) {
            throw createError('CES-GIDO2', {idHash});
        }

        this.onIdObjectSent && this.onIdObjectSent(idHash);

        return microdata;
    }

    /**
     * Implementation of the GET_BLOB service
     *
     * @param {unknown} data - The hash of id-object to fetch
     * @param {unknown} encoding - The encoding of the data - either 'utf-8' for clob or
     *                             undefined for blob
     * @returns {Promise<SimpleReadStream>}
     * @private
     */
    private async getBlob(data: unknown, encoding: unknown): Promise<SimpleReadStream> {
        MessageBus.send('debug', `[${this.ws.connId}] GET_BLOB ${data}`);

        // TODO Prevent misuse - no sending of text files as BLOB, no sending of ONE object
        //  microdata (at all)

        // RECEIVES NETWORK DATA
        const hash = ensureHash<BLOB | CLOB>(data);

        if (!(await isAccessibleBy(this.remotePersonId, hash))) {
            throw createError('CES-GBL1', {hash});
        }

        // Requests for BLOBs: undefined (normal case)
        // Requests for CLOBs and ONE objects: utf8
        if (encoding !== 'utf8' && encoding !== undefined) {
            throw createError('CES-GBL2', {encoding});
        }

        const stream = createFileReadStream(hash, encoding);

        // This runs in parallel (no "await"): Ignore stream errors, we are only interested in the
        // success event. Stream errors are handled in websocket-request-handler's
        // readStreamHandler, which informs the recipient.
        stream.promise
            .finally(() => {
                encoding === 'utf8'
                    ? this.onClobSent && this.onClobSent(hash as SHA256Hash<CLOB>)
                    : this.onBlobSent && this.onBlobSent(hash as SHA256Hash<BLOB>);
            })
            // stream promise failure is handled elsewhere, but we need to handle
            // rejections of the new Promise created by the finally() method
            .catch((_ignore: any) => undefined);

        return stream;
    }

    /**
     * Implementation of the FIN service
     *
     * @private
     */
    private handleFin(): void {
        this.onFin && this.onFin();
    }
}
