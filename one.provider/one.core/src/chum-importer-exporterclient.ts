/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

import {MESSAGE_TYPES} from './chum-base.js';
import {createError, type ErrorWithCode} from './errors.js';
import {createMessageBus} from './message-bus.js';
import {convertIdMicrodataToObject, convertMicrodataToObject} from './microdata-to-object.js';
import {isVersionedObject} from './object-recipes.js';
import {
    type BLOB,
    type CLOB,
    type OneIdObjectTypes,
    type OneObjectTypeNames,
    type OneObjectTypes,
    type OneUnversionedObjectTypes,
    type OneVersionedObjectTypes
} from './recipes.js';
import {reverseMapUpdaterForIdObject} from './reverse-map-updater.js';
import type {AnyObjectCreation, FileCreation} from './storage-base-common.js';
import {storeUnversionedObjectWithMicrodata} from './storage-unversioned-objects.js';
import type {IdFileCreation} from './storage-versioned-objects.js';
import {idObjEvent, storeVersionedObjectWithMicrodataNoMerge} from './storage-versioned-objects.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {writeUTF8TextFile} from './system/storage-base.js';
import {parseAccessibleObjects} from './util/determine-accessible-hashes.js';
import type {AccessibleObject} from './util/determine-accessible-hashes.js';
import {parseChildren} from './util/determine-children.js';
import type {ChildObject} from './util/determine-children.js';
import type {AnyFunction} from './util/function.js';
import {createRethrowingAsyncErrorWrapper} from './util/function.js';
import {isArray, isString} from './util/type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {isFileCreationResult} from './util/type-checks.js';
import type {WebsocketPromisifierAPI} from './websocket-promisifier.js';

const MessageBus = createMessageBus('chum-importer-request-functions');

// HACK
// https://github.com/refinio/one.core/issues/86
// Chum: Reject incoming Access and Group objects
const REJECTED_TYPES: ReadonlySet<OneObjectTypeNames> = new Set(['Access', 'IdAccess', 'Group']);

export class ExporterClient {
    private readonly ws: WebsocketPromisifierAPI;
    private readonly services: Array<[number, AnyFunction]>;

    onError?: (err: ErrorWithCode) => void;
    onDisconnect?: (err?: unknown) => void;
    onBlobStored?: (hash: SHA256Hash<BLOB>) => void;
    onClobStored?: (hash: SHA256Hash<CLOB>) => void;
    onObjectStored?: (hash: SHA256Hash) => void;
    onIdObjectStored?: (hash: SHA256IdHash) => void;

    onNewAccessibleRoot?: () => void;

    constructor(ws: WebsocketPromisifierAPI) {
        this.ws = ws;
        this.services = [[MESSAGE_TYPES.NEW_ACCESSIBLE_ROOT_EVENT, this.handleNewAccessibleRoot]];
    }

    get connId(): number {
        return this.ws.connId;
    }

    start(): void {
        const serviceFnErrorWrapper = createRethrowingAsyncErrorWrapper((error: ErrorWithCode) => {
            this.onError && this.onError(error);
        });

        this.ws.promise.then(
            () => {
                this.onDisconnect && this.onDisconnect();
            },
            err => {
                this.onDisconnect && this.onDisconnect(err);
            }
        );

        for (const [serviceId, serviceFn] of this.services) {
            this.ws.addService(serviceId, serviceFnErrorWrapper(serviceFn.bind(this)));
        }
    }

    stop(): void {
        for (const [serviceId] of this.services) {
            this.ws.removeService(serviceId);
        }
    }

    async getProtocolVersion(): Promise<unknown> {
        return this.ws.send(MESSAGE_TYPES.GET_PROTOCOL_VERSION);
    }

    async getAccessibleRoots(): Promise<AccessibleObject[]> {
        return parseAccessibleObjects(await this.ws.send(MESSAGE_TYPES.GET_ACCESSIBLE_ROOTS));
    }

    async getObjectChildren(hash: SHA256Hash): Promise<ChildObject[]> {
        return parseChildren(await this.ws.send(MESSAGE_TYPES.GET_OBJECT_CHILDREN, hash));
    }

    async getIdObjectChildren(idHash: SHA256IdHash): Promise<ChildObject[]> {
        return parseChildren(await this.ws.send(MESSAGE_TYPES.GET_ID_OBJECT_CHILDREN, idHash));
    }

    /**
     * Fetch an object by requesting the microdata and then writing it to disk with a specific type.
     *
     * @param {SHA256Hash} hash
     * @param {OneObjectTypeNames} type
     * @param {Function} assertBeforeWrite - This function is called with the fetched object
     * before it is stored. So it can be used to assert stuff before writing. If assertion fails
     * throw an error.
     * @returns {Promise<AnyObjectCreation>}
     */
    async fetchObjectWithType<T extends OneObjectTypes>(
        hash: SHA256Hash<T>,
        type: T['$type$'],
        assertBeforeWrite?: (obj: T) => Promise<void> | void
    ): Promise<AnyObjectCreation<T>> {
        return this.fetchObject(hash, async obj => {
            if (obj.$type$ !== type) {
                throw createError('CIEC-FOWT1', {
                    eType: type,
                    fType: obj.$type$
                });
            }

            if (assertBeforeWrite) {
                await assertBeforeWrite(obj as T);
            }
        }) as Promise<AnyObjectCreation<T>>;
    }

    /**
     * Fetch an object by requesting the microdata and then writing it to disk.
     *
     * @param {SHA256Hash} hash
     * @param {Function} assertBeforeWrite - This function is called with the fetched object
     * before it is stored. So it can be used to assert stuff before writing. If assertion fails
     * throw an error.
     * @returns {Promise<AnyObjectCreation>}
     */
    async fetchObject(
        hash: SHA256Hash,
        assertBeforeWrite?: (obj: OneObjectTypes) => Promise<void> | void
    ): Promise<AnyObjectCreation> {
        MessageBus.send('debug', `[${this.ws.connId}] fetchObject for ${hash}`);

        const microdata = await this.ws.send(MESSAGE_TYPES.GET_OBJECT, hash);

        if (!isString(microdata)) {
            throw createError('CIEC-FO1', {type: typeof microdata});
        }

        // We check that we were told the correct hash. We don't use the hash that we could get back
        // from the save-to-storage function because if the hash doesn't match we don't want to
        // write the object in the first place!
        const calculatedHash = await createCryptoHash(microdata);

        if (calculatedHash !== hash) {
            throw createError('CIEC-FO2', {hash, calculatedHash});
        }

        // Instead of storing the string directly we convert the microdata to Javascript object
        // form. This step ensures that the microdata really is a syntactically correct ONE
        // object.
        // This operation throws an Error (object) if it cannot completely parse the
        // microdata to the last character, which leads to a rejected promise - so we don't
        // need to add any additional "if"-checks.
        const obj = convertMicrodataToObject(microdata);

        // HACK
        // https://github.com/refinio/one.core/issues/86
        // Chum: Reject incoming Access and Group objects
        if (REJECTED_TYPES.has(obj.$type$)) {
            throw createError('CIEC-FO3', {obj});
        }

        // Perform some assertions before writing anything
        if (assertBeforeWrite) {
            await assertBeforeWrite(obj);
        }

        let result;

        if (isVersionedObject(obj)) {
            result = await storeVersionedObjectWithMicrodataNoMerge(
                obj,
                microdata,
                hash as SHA256Hash<OneVersionedObjectTypes>
            );
        } else {
            result = await storeUnversionedObjectWithMicrodata(
                obj,
                microdata,
                hash as SHA256Hash<OneUnversionedObjectTypes>
            );
        }

        this.onObjectStored && this.onObjectStored(hash);

        return result as AnyObjectCreation;
    }

    /**
     * Fetch an id-object by requesting the microdata and then writing it to disk with a specific
     * type.
     *
     * @param {SHA256Hash} idHash
     * @param {OneObjectTypeNames} type
     * @param {Function} assertBeforeWrite - This function is called with the fetched object
     * before it is stored. So it can be used to assert stuff before writing. If assertion fails
     * throw an error.
     * @returns {Promise<AnyObjectCreation>}
     */
    async fetchIdObjectWithType<T extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T>,
        type: T['$type$'],
        assertBeforeWrite?: (obj: T) => Promise<void> | void
    ): Promise<IdFileCreation<T>> {
        return this.fetchIdObject(idHash, async obj => {
            if (obj.$type$ !== type) {
                throw createError('CIEC-FIDOWT1', {
                    eType: type,
                    fType: obj.$type$
                });
            }

            if (assertBeforeWrite) {
                await assertBeforeWrite(obj as T);
            }
        }) as Promise<IdFileCreation<T>>;
    }

    /**
     * Fetch an id-object by requesting the microdata and then writing it to disk.
     *
     * @param {SHA256IdHash} idHash
     * @param {Function} assertBeforeWrite - This function is called with the fetched object
     * before it is stored. So it can be used to assert stuff before writing. If assertion fails
     * throw an error.
     * @returns {Promise<AnyObjectCreation>}
     */
    async fetchIdObject(
        idHash: SHA256IdHash,
        assertBeforeWrite?: (obj: OneIdObjectTypes) => Promise<void> | void
    ): Promise<IdFileCreation<OneVersionedObjectTypes>> {
        MessageBus.send('debug', `[${this.ws.connId}] fetchIdObject for ${idHash}`);

        const microdata = await this.ws.send(MESSAGE_TYPES.GET_ID_OBJECT, idHash);

        if (!isString(microdata)) {
            throw createError('CIEC-FIDO1', {type: typeof microdata});
        }

        // We check that we were told the correct hash. We don't use the hash that we could get back
        // from the save-to-storage function because if the hash doesn't match we don't want to
        // write the object in the first place!
        const calculatedHash = (await createCryptoHash(microdata)) as unknown as SHA256IdHash;

        if (calculatedHash !== idHash) {
            throw createError('CIEC-FIDO2', {idHash, calculatedHash});
        }

        // Instead of storing the string directly we convert the microdata to Javascript object
        // form. This step ensures that the microdata really is a syntactically correct ONE
        // object.
        // This operation throws an Error (object) if it cannot completely parse the
        // microdata to the last character, which leads to a rejected promise - so we don't
        // need to add any additional "if"-checks.
        const obj = convertIdMicrodataToObject(microdata);

        // HACK
        // https://github.com/refinio/one.core/issues/86
        // Chum: Reject incoming Access and Group objects
        if (REJECTED_TYPES.has(obj.$type$)) {
            throw createError('CIEC-FIDO3', {obj});
        }

        // Checks if the children of this object exist
        if (assertBeforeWrite) {
            await assertBeforeWrite(obj);
        }

        // Once all referenced/linked sub-objects have been stored it is finally okay to store
        // the object.
        const result = {
            idHash,
            status: await writeUTF8TextFile(microdata, idHash)
        };

        await reverseMapUpdaterForIdObject(obj, result);

        this.onIdObjectStored && this.onIdObjectStored(idHash);
        idObjEvent.dispatch(result);

        return result;
    }

    /**
     * Request a BLOB file by hash.
     * @param {SHA256Hash} hash
     * @returns {Promise<FileCreation>}
     */
    async fetchBLOB(hash: SHA256Hash<BLOB>): Promise<FileCreation<BLOB>> {
        MessageBus.send('debug', `[${this.ws.connId}] fetchBlob for ${hash}`);

        const result = await this.fetchBLOBorCLOB(hash, false);
        this.onBlobStored && this.onBlobStored(result.hash);
        return result;
    }

    /**
     * Request a CLOB (UTF-8) file by hash.
     * @param {SHA256Hash} hash
     * @returns {Promise<FileCreation>}
     */
    async fetchCLOB(hash: SHA256Hash<CLOB>): Promise<FileCreation<CLOB>> {
        MessageBus.send('debug', `[${this.ws.connId}] fetchClob for ${hash}`);

        const result = await this.fetchBLOBorCLOB(hash, true);
        this.onClobStored && this.onClobStored(result.hash);
        return result;
    }

    /**
     * Signals the exporter, that it is no longer needed.
     *
     * @returns {Promise<void>}
     */
    async sendFin(): Promise<void> {
        await this.ws.send(MESSAGE_TYPES.FIN);
    }

    private async fetchBLOBorCLOB<T extends boolean>(
        hash: SHA256Hash<T extends true ? CLOB : BLOB>,
        clob: T
    ): Promise<FileCreation<T extends true ? CLOB : BLOB>> {
        MessageBus.send(
            'debug',
            `[${this.ws.connId}] fetch[C|B]lob for ${hash} (CLOB flag: ${!!clob})`
        );

        // TODO Prevent misuse - no sending of text files as BLOB, no sending of ONE object
        //  microdata (at all)

        // Default: undefined, which leads to binary streams (ArrayBuffer chunks)
        let encoding;

        if (clob) {
            encoding = 'utf8';
        }

        const blobResult = await this.ws.send(MESSAGE_TYPES.GET_BLOB, hash, encoding);

        if (!isFileCreationResult(blobResult)) {
            throw createError('CIEC-FBL1', {blobResult});
        }

        if (blobResult.hash !== hash) {
            // TODO: Remove file? Probably better only do so after user confirmation in case
            //  they want to look at what exactly is wrong. Quietly removing the evidence - bad.
            throw createError('CIEC-FBL2', {hash, resultHash: blobResult.hash});
        }

        // Type cast: Force acceptance that we checked the type (thoroughly). We only
        // did not check if there are additional properties - they don't matter.
        return blobResult as FileCreation<T extends true ? CLOB : BLOB>;
    }

    private handleNewAccessibleRoot(): void {
        this.onNewAccessibleRoot && this.onNewAccessibleRoot();
    }
}
