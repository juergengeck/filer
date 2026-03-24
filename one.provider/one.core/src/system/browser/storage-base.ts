/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * # Storage module for browser platform
 *
 * ## IndexedDB SPec and Examples
 *
 * {@link https://www.w3.org/TR/IndexedDB/#introduction}
 *
 * ## Reliability of IndexedDB
 *
 * Writing data: When the "oncomplete" event of the transaction fires write operations are not
 * guaranteed to have been committed to disk. They were given to the OS to write but without
 * waiting for confirmation that the writes completed (See
 * {@link https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction}).
 *
 * There are wildly varying limits (quotas) on the amount of space available to an IndexedDB
 * database, and the data stored in it can be wiped out at any time. The storage of a
 * browser-based application should be considered secondary and/or a cache of data stored
 * elsewhere in a safer location.
 *
 * ## Transactions in IndexedDB
 *
 * In this module each function uses exactly one transaction, and each call produces a new one.
 * There are no transactions that spans across functions.
 *
 * IndexedDB's transactions auto-commit when the last success/error callback fires and
 * that callback schedules no more requests. It is not related to scope of any variables
 * (also see {@link https://stackoverflow.com/a/10405196/544779}).
 *
 * ## Requests
 *
 * See {@link https://www.w3.org/TR/IndexedDB-2/#request-construct}
 *
 * > When a request is made, a new request is returned with its done flag unset. If a request
 * > completes successfully, the done flag is set, the result is set to the result of the
 * > request, and an event with type success is fired at the request.
 *
 * > If an error occurs while performing the operation, the done flag is set, the error is set
 * > to the error, and an event with type error is fired at the request.
 *
 * This means we can use the `success` and `error` properties of the
 * {@link https://www.w3.org/TR/IndexedDB-2/#idbrequest|IDBRequest} object. The
 * {@link https://www.w3.org/TR/domcore/#concept-event|`target` property of the event object}
 * received by the `onerror`and `onsuccess` handlers points to the request object and can also
 * be used (and is the only choice if the request object is not available, for example when
 * using chaining instead of variables).
 *
 * ## Errors and successes of requests
 *
 * Because of transactions we need the `oncomplete` event of the transaction to confirm success.
 * We only have one request per transaction.
 *
 * Errors can be reported on the `onerror` handler of the request (since they are "final").
 * @private
 * @module
 */

/*
 * NOTE ABOUT ERRORS
 *
 * Low-level functions for file-access don't throw standard Javascript errors, they throw SYSTEM
 * errors: see https://nodejs.org/api/errors.html#errors_system_errors for details.
 *
 * General errors are just passed through as-is with the current function added to the stacktrace.
 * Some errors, at this point FileNotFoundError, are "normalized" - created new, and they will be
 * platform-independent.
 */

/**
 * @global
 * @typedef {object} IndexedDBEvent
 * @property {('ABORT' | 'CLOSE' | 'CLOSE_NORMAL' | 'ERROR')} code
 * @property {string} message
 */
export interface IndexedDBEvent {
    code: 'ABORT' | 'CLOSE' | 'CLOSE_NORMAL' | 'ERROR';
    message: string;
}

import {createError} from '../../errors.js';
import type {HashTypes, Instance} from '../../recipes.js';
import type {
    FileCreationStatus,
    InitStorageOptions,
    StorageDirTypes
} from '../../storage-base-common.js';
import {CREATION_STATUS, STORAGE} from '../../storage-base-common.js';
import {getTypeFromMicrodata} from '../../util/object.js';
import {createEventSource} from '../../util/one-event-source.js';
import {wait} from '../../util/promise.js';
import {stringify} from '../../util/sorted-stringify.js';
import {substrForceMemCopy} from '../../util/string.js';
import {isInteger, isString} from '../../util/type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from '../../util/type-checks.js';
import {isHash} from '../../util/type-checks.js';
import {getBaseDirOrName, setBaseDirOrName} from '../storage-base.js';
import {
    _changeStoragePassword,
    decrypt,
    decryptKey,
    encrypt,
    encryptKey,
    getApproxSize,
    initEncryption
} from './storage-crypto.js';
import {isSharedArrayBufferSupported} from '../../util/feature-detection.js';

let DB: undefined | IDBDatabase;

// "private" is always encrypted
let encryptAllStorage = false;

const indexedDbEvent = createEventSource<IndexedDBEvent>();

export const onIndexedDB = indexedDbEvent.consumer;

/**
 * Internal function used by other browser storage modules (delete-file, streams) to know if
 * filenames and contents should be en- or decrypted, respectively, or not.
 *
 * Creates a single point to decide - originally created to help to turn off encryption in a
 * single place completely, including for "private" storage space where it is always on.
 * @private
 * @internal
 * @param {StorageDirTypes} type
 * @returns {boolean}
 */
export function shouldBeEncrypted(type: StorageDirTypes = STORAGE.OBJECTS): boolean {
    return encryptAllStorage || type === STORAGE.PRIVATE;
}

/**
 * **BROWSER ONLY**
 * This function is not part of the public ONE API. It is exported for other one.core browser
 * storage modules.
 * @internal
 * @static
 * @returns {IDBDatabase} Returns the database instance
 * @throws {Error} Throws an error if the database has not yet been initialized
 */
export function getDbInstance(): IDBDatabase {
    if (DB === undefined) {
        throw createError('SB-NO-INIT1');
    }

    return DB;
}

/**
 * @private
 * @static
 * @returns {Promise<undefined>}
 */
function wipeStorageFn(): Promise<void> {
    return new Promise((resolve, reject) => {
        for (const type of Object.values(STORAGE)) {
            const transaction = getDbInstance().transaction(type, 'readwrite');

            // Note: IndexedDB transactions are not safe, i.e. when we get this event the contents
            // may not be on the disk yet. At this point the browser told the OS to write the data
            // but there is no guarantee it actually happened.
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(createError('SB-WIPE1', transaction.error));

            const objectStore = transaction.objectStore(type);
            const getAllKeysRequest = objectStore.getAllKeys();

            // TODO This bubbles up to the transaction, do we need this?
            getAllKeysRequest.onerror = () =>
                reject(createError('SB-WIPE2', getAllKeysRequest.error));

            // For a read task we can resolve from the request's success handler, no need to wait
            // for the transaction's "oncomplete" handler.
            getAllKeysRequest.onsuccess = () => {
                for (const file of getAllKeysRequest.result) {
                    const deleteRequest = objectStore.delete(file);
                    deleteRequest.onerror = () =>
                        reject(createError('SB-WIPE3', deleteRequest.error));
                }
            };
        }
    });
}

const INSTANCES_KEY_STORE = 'instances';

/**
 * @private
 * @returns {Array<SHA256IdHash<Instance>> | null}
 */
function retrieveInstanceIdHashesFromStore(): Array<SHA256IdHash<Instance>> {
    const content = localStorage.getItem(INSTANCES_KEY_STORE);

    if (content === null) {
        return [];
    }

    const instances = JSON.parse(content);

    if (!Array.isArray(instances) || instances.some(value => !isHash(value))) {
        throw createError('SB-RIFS1', {instances});
    }

    return instances;
}

/**
 * Persist the given instance id hash into the `localStorage` under the
 * {@link INSTANCES_STORE_KEY} key
 * @private
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {undefined}
 */
function persistInstanceIdHashToStore(instanceIdHash: SHA256IdHash<Instance>): void {
    const instances = retrieveInstanceIdHashesFromStore();

    if (!instances.includes(instanceIdHash)) {
        instances.push(instanceIdHash);
        localStorage.setItem(INSTANCES_KEY_STORE, stringify(instances));
    }
}

/**
 * Checks if the given instanceIdHash exists or not in `localStorage` under the
 * {@link INSTANCES_KEY_STORE} key
 * @private
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {boolean}
 */
function isInstanceIdHashInStore(instanceIdHash: SHA256IdHash<Instance>): boolean {
    const instances = retrieveInstanceIdHashesFromStore();
    return instances.includes(instanceIdHash);
}

/**
 * @internal
 * @static
 * @param {object} options
 * @param {SHA256IdHash} options.instanceIdHash
 * @param {boolean} [options.wipeStorage=false] - If `true` **all files in storage will be
 * deleted** when the instance is initialized. All files means *every single file*. Storage is
 * wiped clean.
 * @param {string} [options.name='OneDB')]
 * @param {number} [options.nHashCharsForSubDirs=0] - In "object" storage, the first `n` characters
 * of o files name - a hexadecimal SHA-256 hash string - are used to locate the file in a
 * subdirectory of that name. For example, if a file name (hash) starts with "0fe123...." and
 * n=2, then the file will be located not in directory `objects/` but in directory
 * `objects/0f/`. This hierarchical storage option is only offered on *some* platforms. When
 * this option has a number higher than 0 on a platform that does not support it an error is thrown.
 * **On this platform (browser) this option is not supported.**
 * @param {number} [options.storageInitTimeout=1000] - The browser platform accepts this
 * parameter to time out the `indexedDB.open()` attempt in case the request blocks (found on
 * Safari). Default is 1000ms. This can or should be used together with `one.core/util/promise
 * method` `retry`. On other platforms this parameter is ignored.
 * The value of 1000 as default was chosen after some testing done with different CPU loads (10-20%,
 * 50%, 80%+), on Chrome and Firefox. The highest values obtained were between 400-500ms.
 * @param {boolean} [options.encryptStorage=false] - **Only if the platform supports it.**
 * If set to `true` all items in all storage spaces are encrypted. Storage space "private" is
 * always encrypted.
 * @param {string|null} [options.secretForStorageKey] - This secret is used to derive a key to be
 * used to en- and decrypt all items in all storage spaces, or only the ones in "private",
 * depending on the value of `encryptStorage`.
 * @returns {Promise<undefined>}
 * @throws {Error} Throws an `Error` if the first parameter is not a hash
 */
export function initStorage({
    instanceIdHash,
    wipeStorage = false,
    name,
    nHashCharsForSubDirs = 0,
    storageInitTimeout = 1000,
    encryptStorage = false,
    secretForStorageKey
}: InitStorageOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        if (nHashCharsForSubDirs > 0) {
            throw createError('SB-INIT4', {nHashCharsForSubDirs});
        }

        if (secretForStorageKey === null) {
            throw createError('SB-INIT6');
        }

        if (DB !== undefined) {
            throw createError('SB-INIT2', {dbName: DB.name});
        }

        setBaseDirOrName(name);

        const dbName = `${getBaseDirOrName()}#${instanceIdHash}`;

        // Note: Storage area "private" is always encrypted (browser), so we always have to set up and
        // load keys even if this is set to `false`.
        encryptAllStorage = encryptStorage;

        // https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest
        const dbOpenRequest = indexedDB.open(dbName, 1);

        // Special IDBOpenDBRequest event
        // Fired when an open connection to a database is blocking a versionchange transaction
        // on the same database.
        dbOpenRequest.onblocked = () => reject(createError('SB-INIIT11', {dbName}));

        // The upgradeneeded event is fired when an attempt was made to open a database with a
        // version number higher than its current version.
        // https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event
        // Here we create the ObjectStores. If the event handler exits successfully, the
        // success-handler of the "open database" request will then be triggered.
        // See https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
        // Section "Creating or updating the version of the database"
        // Special IDBOpenDBRequest event
        dbOpenRequest.onupgradeneeded = _event => {
            const db = dbOpenRequest.result;

            // Now store is available to be populated
            // Unused because the onsuccess handler is automatically called.
            // request.transaction.oncomplete = event => {};
            for (const type of Object.values(STORAGE)) {
                if (!db.objectStoreNames.contains(type)) {
                    // We don't have keys (or structured data), nor indexes, so we do not need the
                    // IDBObjectStore object returned by the function. See
                    // https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/createObjectStore#Example
                    // const objectStore: IDBObjectStore =
                    db.createObjectStore(type);
                }
            }
        };

        // Standard IDBRequest event (inherited by IDBOpenDBRequest)
        dbOpenRequest.onerror = () => reject(createError('SB-INIT10', dbOpenRequest.error));

        // Standard IDBRequest event (inherited by IDBOpenDBRequest)
        dbOpenRequest.onsuccess = () => {
            const db = dbOpenRequest.result;

            // An event fired when a request returns an error and the event bubbles up to the
            // connection object.
            // https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/error_event
            db.onerror = () =>
                indexedDbEvent.dispatch({
                    code: 'ERROR',
                    message: 'Transaction error'
                });

            // The abort event is fired when an IndexedDB transaction is aborted.
            // This non-cancelable event bubbles to the associated IDBDatabase object (i.e. here).
            // The event.target property refers to the IDBTransaction object that bubbles up.
            // https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/abort_event
            db.onabort = () =>
                indexedDbEvent.dispatch({
                    code: 'ABORT',
                    message: 'Transaction aborted'
                });

            // The close event is fired on IDBDatabase when the database connection is
            // unexpectedly closed. This could happen, for example, if the underlying storage is
            // removed or if the user clears the database in the browser's history preferences.
            // https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/close_event
            // The close event only fires if the connection closes abnormally, e.g. if the
            // origin’s storage is cleared, or there is corruption or an I/O error. If close()
            // is called explicitly the event does not fire.
            // https://www.w3.org/TR/IndexedDB/#closing-connection
            db.onclose = () =>
                indexedDbEvent.dispatch({
                    code: 'CLOSE',
                    message: 'Unexpected close event'
                });

            // The versionchange event is fired when a database structure change (upgradeneeded
            // event send on an IDBOpenDBRequest or IDBFactory.deleteDatabase) was requested
            // elsewhere (most probably in another window/tab on the same computer).
            // https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/versionchange_event
            // A versionchange will be fired at an open connection if an attempt is made to
            // upgrade or delete the database. This gives the connection the opportunity to
            // close to allow the upgrade or delete to proceed.
            // https://www.w3.org/TR/IndexedDB/#database-connection
            db.onversionchange = _vc_event => {
                // We need to unblock whatever happens, in any case the DB can not be used any
                // more after this event.
                // We don't have structure changes, version number always is 1, so there has to
                // be a deleteDatabase() somewhere (e.g. in another tab). By closing we
                // unblock it and allow it to proceed.
                db.close();
                indexedDbEvent.dispatch({
                    code: 'CLOSE',
                    message: 'Unexpected versionchange event, closing the database'
                });
            };

            // Needs to be set for wipeStorage and initEncryption. At this point storage and
            // instance are already available so this is semantically correct - but if either of
            // those functions fail we must reset those values to undefined again.
            DB = db;

            (wipeStorage ? wipeStorageFn() : Promise.resolve())
                .then(() =>
                    initEncryption(secretForStorageKey).then(() => {
                        // Firefox does not have this call implemented
                        // Reference (https://bugzilla.mozilla.org/show_bug.cgi?id=934640)
                        // We need to manually store each DB to be able to know which ones
                        // we have.
                        if (indexedDB.databases === undefined) {
                            persistInstanceIdHashToStore(instanceIdHash);
                        }

                        // Not clearing the timeout does not hurt because after the promise is
                        // resolved a subsequent reject has no consequence. However, leaving a
                        // timeout running is not necessary if we can just clear it so easily.
                        clearTimeout(rejectRaceTimeout);

                        resolve();
                    })
                )
                .catch(err => {
                    // No indexedDbEvent fired for closing the DB, since this is caught and
                    // returned immediately as this function's promise resolution
                    db.close();
                    DB = undefined;
                    reject(err);
                });
        };

        // Start a race between resolve and reject (first one wins the Promise)
        const rejectRaceTimeout = setTimeout(() => {
            // This property can be null for certain requests, for example those returned from
            // IDBFactory.open unless an upgrade is needed.
            // https://developer.mozilla.org/en-US/docs/Web/API/IDBRequest
            if (dbOpenRequest.transaction !== null) {
                dbOpenRequest.transaction.abort();
            }

            reject(new Error(`Timeout after ${storageInitTimeout} ms`));
        }, storageInitTimeout);
    });
}

/**
 * Closes the IndexedDB once all running transactions have finished. Closing is done in a
 * separate thread, so when this function returns the IndexedDB may still be open.
 * If there is no open database the function does nothing.
 * @internal
 * @static
 * @returns {undefined}
 */
export function closeStorage(): void {
    if (DB !== undefined) {
        DB.close();

        indexedDbEvent.dispatch({
            code: 'CLOSE_NORMAL',
            message: 'Normal DB shutdown'
        });
    }

    DB = undefined;
}

/**
 * Deletes the storage by the given instanceIdHash if it exists. If there is no such database
 * nothing happens.
 * @internal
 * @static
 * @async
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<void>}
 */
export async function deleteStorage(instanceIdHash: SHA256IdHash<Instance>): Promise<void> {
    // The wait() gives a previous db.close() time to finish.
    // When calling this function milliseconds should not be critical anyway, and we have no
    // good way to know when db.close() is actually done since when it finishes the close-action
    // is performed in another thread, so if someone has the unfortunately synchronous
    // db.close() followed by deleteStorage immediately this would be blocked.
    await wait(10);

    // Event based request needs to be converted to a Promise
    return await new Promise<void>((resolve, reject) => {
        if (!isHash(instanceIdHash)) {
            return reject(createError('SB-DELST1', {instanceIdHash}));
        }

        // https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/deleteDatabase
        const request = indexedDB.deleteDatabase(`${getBaseDirOrName()}#${instanceIdHash}`);

        request.onerror = event => {
            reject(event);
        };

        request.onblocked = _event => {
            reject(new Error('Database deletion blocked'));
        };

        request.onsuccess = _event => {
            resolve();
        };
    });
}

/**
 * Checks if the instance exists or not.
 * @internal
 * @static
 * @async
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<boolean>}
 */
export async function doesStorageExist(instanceIdHash: SHA256IdHash<Instance>): Promise<boolean> {
    // Firefox does not have this call implemented, so we must check in `localStorage` for the DB
    // Reference (https://bugzilla.mozilla.org/show_bug.cgi?id=934640)
    if (indexedDB.databases === undefined) {
        return isInstanceIdHashInStore(instanceIdHash);
    }

    const presentIdHashes = (await indexedDB.databases()).reduce(
        (result, db) => {
            if (db.name !== undefined) {
                result.push(
                    db.name.replace(getBaseDirOrName() + '#', '') as SHA256IdHash<Instance>
                );
            }

            return result;
        },
        [] as Array<SHA256IdHash<Instance>>
    );

    const foundInstance = presentIdHashes.find(idHash => idHash === instanceIdHash);

    return foundInstance !== undefined;
}

/**
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<string>} Resolves with a string. The promise is rejected if the file does
 * not exist.
 * @throws {Error} Throws an `Error` if no filename is given
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found, or `FileDeletedError`
 */
export function readUTF8TextFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (filename === undefined) {
            // NOTE: throw synchronous errors (also prevents any further execution of the
            // function), reject() is used for ASYNCHRONOUS errors.
            return reject(createError('SB-READ1'));
        }

        const transaction = getDbInstance().transaction(type);

        transaction.onerror = () =>
            reject(createError('SB-READ4', {err: transaction.error, filename, type}));

        const objectStore = transaction.objectStore(type);
        const request = shouldBeEncrypted(type)
            ? objectStore.get(encryptKey(filename))
            : objectStore.get(filename);

        request.onerror = () =>
            reject(createError('SB-READ5', {err: transaction.error, filename, type}));

        // If "filename" does not exist:
        // See https://www.w3.org/TR/IndexedDB-2/#dom-idbobjectstore-get
        //   "This method produces the same result if a record with the given key doesn't exist
        //    as when a record exists, but has undefined as value."
        // We should not have any "undefined" values for any key in the database.
        request.onsuccess = () => {
            if (request.result === undefined) {
                return reject(createError('SB-READ2', {name: 'FileNotFoundError', filename, type}));
            }

            try {
                // For a read task we can resolve from the request's success handler, no need to
                // wait for the transaction's "oncomplete" handler.
                const contents = shouldBeEncrypted(type) ? decrypt(request.result) : request.result;

                if (!isString(contents)) {
                    return reject(createError('SB-RD-NOSTR', {filename}));
                }

                return resolve(contents);
            } catch (err) {
                return reject(err);
            }
        };
    });
}

/**
 * Read *a section* of the given UTF-8 encoded file as string.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {number} offset - Where to start reading the UTF-8 encoded file. On this platform
 * this is a character offset, since strings are stored as-is in IndexedDB, and we don't have
 * access to their byte representation. If the offset is negative it is counted backwards from
 * the end of the file.
 * @param {number} length - How many characters to read (same as bytes assuming UTF-8 encoded
 * ASCII set characters) starting at the given offset (always forward).
 * @returns {Promise<string>} - Returns the given string section
 * @param {StorageDirTypes} [type='objects']
 * @throws {Error} Throws an `Error` if a parameter is missing
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found, or `FileDeletedError`
 */
export async function readTextFileSection(
    filename: string,
    offset: number,
    length: number,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    if (!isString(filename) || !isInteger(offset) || !isInteger(length) || length < 0) {
        throw createError('SB-RASEC1', {filename, type, offset, length});
    }

    const contents = await readUTF8TextFile(filename, type);

    if (offset < 0) {
        if (-offset < length) {
            throw createError('SB-RASEC3', {filename, type, offset, length});
        }

        if (-offset > contents.length) {
            throw createError('SB-RASEC4', {filename, type, offset, length, size: contents.length});
        }

        return contents.slice(offset, contents.length - offset + length);
    } else if (offset + length > contents.length) {
        throw createError('SB-RASEC5', {filename, type, offset, length, size: contents.length});
    }

    return contents.slice(offset, offset + length);
}

/**
 * **Note that existing files will not be overwritten!** That is because this function is
 * made for our special context, where all files are stored under their SHA-256 hash as name, so
 * overwriting a file would make no sense.
 * @internal
 * @static
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIR[type]
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new, exists).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given
 */
export function writeUTF8TextFile(
    contents: string,
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<FileCreationStatus> {
    return new Promise((resolve, reject) => {
        if (contents === undefined) {
            throw createError('SB-WRITE1');
        }

        if (filename === undefined) {
            throw createError('SB-WRITE2');
        }

        const transaction = getDbInstance().transaction(type, 'readwrite');

        // Note: IndexedDB transactions are not safe, i.e. when we get this event the contents
        // may not be on the disk yet. At this point the browser told the OS to write the data
        // but there is no guarantee it actually happened.
        transaction.oncomplete = () => resolve(CREATION_STATUS.NEW);

        transaction.onerror = () => reject(createError('SB-WRITE', transaction.error));

        const objectStore = transaction.objectStore(type);

        // From (green box just ABOVE) https://w3c.github.io/IndexedDB/#dom-idbobjectstore-put
        //   "If put() is used, any existing record with the key will be replaced. If add() is
        //    used, and if a record with the key already exists the request will fail, with
        //    request’s error set to a "ConstraintError" DOMException.
        //    If successful, request’s result will be the record's key."
        const request = shouldBeEncrypted(type)
            ? objectStore.add(encrypt(contents), encryptKey(filename))
            : objectStore.add(contents, filename);

        // We report success from "oncomplete" of the transaction, but we can report failure
        // from the request event.
        request.onerror = event => {
            if ((request.error as DOMException).name === 'ConstraintError') {
                // Key already exists in the object store.
                event.preventDefault();
                event.stopPropagation();
                resolve(CREATION_STATUS.EXISTS);
            } else {
                reject(createError('SB-WRITE', request.error));
            }
        };

        // Unused, because writing is not final yet, only when the transaction is complete.
        // request.onsuccess = () => undefined;
    });
}

/**
 * **Note that existing files will be overwritten!**
 * @internal
 * @static
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIR[type]
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if
 * the 3rd parameter is not "rmaps" or "vheads"
 */
export function writeUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    return new Promise((resolve, reject) => {
        if (contents === undefined) {
            throw createError('SB-WRITEM1');
        }

        if (filename === undefined) {
            throw createError('SB-WRITEM2');
        }

        if (type !== STORAGE.RMAPS && type !== STORAGE.VHEADS) {
            throw createError('SB-WRITEM3', {type});
        }

        const transaction = getDbInstance().transaction(type, 'readwrite');

        // Note: IndexedDB transactions are not safe, i.e. when we get this event the contents
        // may not be on the disk yet. At this point the browser told the OS to write the data
        // but there is no guarantee it actually happened.
        transaction.oncomplete = () => resolve(CREATION_STATUS.NEW);

        transaction.onerror = () => reject(createError('SB-WRITEM', transaction.error));

        const objectStore = transaction.objectStore(type);

        // From (green box just ABOVE) https://w3c.github.io/IndexedDB/#dom-idbobjectstore-put
        //   "If put() is used, any existing record with the key will be replaced. If add() is
        //    used, and if a record with the key already exists the request will fail, with
        //    request’s error set to a "ConstraintError" DOMException.
        //    If successful, request’s result will be the record's key."
        const request = objectStore.put(
            shouldBeEncrypted(type) ? encrypt(contents) : contents,
            shouldBeEncrypted(type) ? encryptKey(filename) : filename
        );

        // We report success from "oncomplete" of the transaction, but we can report failure
        // from the request event.
        request.onerror = _event => {
            reject(createError('SB-WRITEM', request.error));
        };

        // Unused, because writing is not final yet, only when the transaction is complete.
        // request.onsuccess = () => undefined;
    });
}

/**
 * **This function is reserved for system internal version-map and reverse-map files.**
 * @internal
 * @static
 * @param {string} contents - The string to append
 * @param {string} filename - Plain filename
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string which always is "new" to be consistent with the writeUTF8TextFile()
 * method
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if the 3rd
 * parameter is not "rmaps" or "vheads"
 */
export function appendUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    return new Promise((resolve, reject) => {
        if (contents === undefined) {
            throw createError('SB-APPEND1');
        }

        if (filename === undefined) {
            throw createError('SB-APPEND2');
        }

        if (type !== STORAGE.RMAPS && type !== STORAGE.VHEADS) {
            throw createError('SB-APPEND3', {type});
        }

        // Transaction for a read followed by a write operation
        const transaction = getDbInstance().transaction(type, 'readwrite');

        transaction.onerror = () => reject(createError('SB-APPEND', transaction.error));

        let status: FileCreationStatus = CREATION_STATUS.EXISTS;

        // Note: IndexedDB transactions are not safe, i.e. when we get this event the contents
        // may not be on the disk yet. At this point the browser told the OS to write the data
        // but there is no guarantee it actually happened.
        transaction.oncomplete = () => resolve(status);

        const objectStore = transaction.objectStore(type);

        // If "filename" does not exist:
        // See https://www.w3.org/TR/IndexedDB-2/#dom-idbobjectstore-get
        //   "This method produces the same result if a record with the given key doesn't exist
        //    as when a record exists, but has undefined as value."
        // We don't save "undefined" as object contents so for us undefined as result always
        // means "file not found".
        const readRequest = objectStore.get(
            shouldBeEncrypted(type) ? encryptKey(filename) : filename
        );

        readRequest.onerror = () => reject(createError('SB-APPEND', readRequest.error));

        readRequest.onsuccess = () => {
            try {
                if (readRequest.result === undefined) {
                    status = CREATION_STATUS.NEW;
                }

                const prevContents =
                    readRequest.result === undefined
                        ? ''
                        : shouldBeEncrypted(type)
                          ? (decrypt(readRequest.result) as string)
                          : (readRequest.result as string);

                const contentsRaw = prevContents + contents;

                // If the object does not exist (result === undefined) silently create it.
                // See https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put
                //  "The put() method of the IDBObjectStore interface updates a given record in a
                //   database, or inserts a new record if the given item does not already exist."
                const writeRequest = objectStore.put(
                    // undefined: "File not found" - that's okay
                    shouldBeEncrypted(type) ? encrypt(contentsRaw) : contentsRaw,
                    shouldBeEncrypted(type) ? encryptKey(filename) : filename
                );

                writeRequest.onerror = _ev => reject(createError('SB-APPEND', writeRequest.error));
                // writeRequest.onsuccess is unused because success is reported from the transaction
            } catch (err) {
                reject(err);
            }
        };
    });
}

/**
 * Reads a binary file from storage space "private". Storage encryption is ignored, the raw file is
 * returned.
 *
 * On web browser platforms, using IndexedDB as backend, we store either strings or `ArrayBuffer`
 * and get exactly that back. To ensure the function always returns only `ArrayBuffer`,
 * on that platform the function includes a check of the type of the returned object and reject
 * with an Error if it is not `ArrayBuffer`.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @returns {Promise<ArrayBuffer>}
 */
export function readPrivateBinaryRaw(filename: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        if (!isString(filename)) {
            throw createError('SB-RPBR1', {filename});
        }

        const transaction = getDbInstance().transaction(STORAGE.PRIVATE);

        const objectStore = transaction.objectStore(STORAGE.PRIVATE);
        const request = objectStore.get(encryptKey(filename));

        request.onerror = () => reject(createError('SB-RPBR2', {err: request.error}));

        request.onsuccess = () =>
            request.result === undefined
                ? reject(
                      createError('SB-RPBR3', {
                          name: 'FileNotFoundError',
                          filename,
                          type: STORAGE.PRIVATE
                      })
                  )
                : request.result instanceof ArrayBuffer
                  ? resolve(decrypt(request.result) as ArrayBuffer)
                  : reject(createError('SB-RPBR4', {filename}));
    });
}

/**
 * Write a binary file from storage space "private". Storage encryption is ignored, the raw
 * ArrayBuffer  is written. If the file already exists the promise is rejected with an Error.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {ArrayBufferLike | Uint8Array} contents
 * @returns {Promise<void>}
 */
export function writePrivateBinaryRaw(
    filename: string,
    contents: ArrayBufferLike | Uint8Array
): Promise<void> {
    return new Promise((resolve, reject) => {
        // Check if the input is a valid buffer type
        if (!(
            contents instanceof ArrayBuffer ||
            (isSharedArrayBufferSupported() && contents instanceof SharedArrayBuffer) ||
            contents instanceof Uint8Array
        )) {
            throw createError('SB-WPBR1', {type: typeof contents, filename});
        }

        if (!isString(filename)) {
            throw createError('SB-WPBR2', filename);
        }

        const transaction = getDbInstance().transaction(STORAGE.PRIVATE, 'readwrite');

        transaction.oncomplete = () => resolve();

        const objectStore = transaction.objectStore(STORAGE.PRIVATE);
        const request = objectStore.add(encrypt(contents), encryptKey(filename));

        request.onerror = () => {
            if ((request.error as DOMException).name === 'ConstraintError') {
                reject(createError('SB-WPBR3', {filename}));
            } else {
                reject(createError('SB-WPBR4', {err: request.error, filename}));
            }
        };
    });
}

/**
 * This function supports the higher-level storage function that determines a stored files type.
 * By default, the first 100 bytes are interpreted as UTF-8 characters and returned, but starting
 * position as well as the number of bytes can be adjusted.
 * If the function reads less than `length` characters it just returns what it was able to get
 * without raising an exception. If the file was shorter so be it, in the context of our main use
 * case, which is to get the beginning of the microdata string of a ONE object in storage to
 * determine the type, this is not an error condition.
 * @private
 * @static
 * @async
 * @param {string} filename
 * @param {number} [position=0]
 * @param {number} [length=100]
 * @returns {Promise<string>} Returns length characters of the contents of the given file.
 * @throws {Error} Throws an `Error` if no filename is given
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found, or `FileDeletedError`
 */
async function getNCharacters(
    filename: string,
    position: number = 0,
    length: number = 256
): Promise<string> {
    if (filename === undefined) {
        throw createError('SB-GETN1');
    }

    const value = await readUTF8TextFile(filename);

    // Force allocation of a new string: Otherwise the runtime may keep the entire potentially
    // large original string in memory.
    return substrForceMemCopy(value, position, length);
}

/**
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<boolean>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export function exists(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<boolean> {
    return new Promise((resolve, reject) => {
        if (filename === undefined) {
            throw createError('SB-EXISTS');
        }

        const transaction = getDbInstance().transaction(type);

        transaction.onerror = () => reject(createError('SB-EXISTS1', transaction.error));

        const objectStore = transaction.objectStore(type);
        const request = objectStore.openCursor(
            shouldBeEncrypted(type) ? encryptKey(filename) : filename
        );

        request.onerror = () => reject(createError('SB-EXISTS2', request.error));
        request.onsuccess = () => resolve(request.result !== null);
    });
}

/**
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<number>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export function fileSize(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<number> {
    return new Promise((resolve, reject) => {
        if (filename === undefined) {
            throw createError('SB-EXISTS');
        }

        const transaction = getDbInstance().transaction(type);

        transaction.onerror = () =>
            reject(createError('SB-READ4', {err: transaction.error, filename, type}));

        const objectStore = transaction.objectStore(type);
        const request = shouldBeEncrypted(type)
            ? objectStore.get(encryptKey(filename))
            : objectStore.get(filename);

        request.onerror = () =>
            reject(createError('SB-READ5', {err: transaction.error, filename, type}));

        // If "filename" does not exist:
        // See https://www.w3.org/TR/IndexedDB-2/#dom-idbobjectstore-get
        //   "This method produces the same result if a record with the given key doesn't exist
        //    as when a record exists, but has undefined as value."
        // We should not have any "undefined" values for any key in the database.
        request.onsuccess = () => {
            if (request.result === undefined) {
                return reject(createError('SB-READ2', {name: 'FileNotFoundError', filename, type}));
            }

            if (shouldBeEncrypted(type)) {
                try {
                    return resolve(getApproxSize(request.result));
                } catch (err) {
                    return reject(err);
                }
            }

            if (isString(request.result)) {
                return resolve(new Blob([request.result]).size);
            }

            return resolve(request.result.byteLength);
        };
    });
}

/**
 * @internal
 * @static
 * @async
 * @returns {Promise<SHA256Hash[]>} Returns an array of all SHA-256 hashes representing objects
 * in storage.
 */
export function listAllObjectHashes(): Promise<Array<SHA256Hash<HashTypes> | SHA256IdHash>> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.OBJECTS);

        transaction.onerror = () => reject(createError('SB-LH', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.OBJECTS);
        const request = objectStore.getAllKeys();

        request.onerror = () => reject(createError('SB-LH', request.error));

        // For a read task we can resolve from the request's success handler, no need to wait
        // for the transaction's "oncomplete" handler.
        request.onsuccess = () => {
            try {
                resolve(
                    request.result.map(k =>
                        shouldBeEncrypted() ? decryptKey(k as ArrayBuffer) : k
                    ) as Array<SHA256Hash<HashTypes>>
                );
            } catch (err) {
                reject(err);
            }
        };
    });
}

/**
 * @internal
 * @static
 * @async
 * @returns {Promise<SHA256IdHash[]>} Returns an array of all SHA-256 hashes representing objects
 * in storage.
 */
export function listAllIdHashes(): Promise<SHA256IdHash[]> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.VHEADS);

        transaction.onerror = () => reject(createError('SB-LIH', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.VHEADS);
        const request = objectStore.getAllKeys();

        request.onerror = () => reject(createError('SB-LIH', request.error));

        // For a read task we can resolve from the request's success handler, no need to wait
        // for the transaction's "oncomplete" handler.
        request.onsuccess = () => {
            try {
                resolve(
                    request.result.map(k =>
                        shouldBeEncrypted(STORAGE.VHEADS) ? decryptKey(k as ArrayBuffer) : k
                    ) as SHA256IdHash[]
                );
            } catch (err) {
                reject(err);
            }
        };
    });
}

/**
 * @internal
 * @static
 * @async
 * @param {string} [prefix]
 * @returns {Promise<string[]>} Returns an array of all SHA-256 hashes representing objects
 * in storage.
 */
export function listAllReverseMapNames(prefix?: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const transaction = getDbInstance().transaction(STORAGE.RMAPS);

        transaction.onerror = () => reject(createError('SB-LM', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.RMAPS);

        const request = isString(prefix)
            ? objectStore.getAllKeys(IDBKeyRange.bound(prefix, prefix + '\uffff', false, true))
            : objectStore.getAllKeys();

        request.onerror = () => reject(createError('SB-LM', request.error));

        // For a read task we can resolve from the request's success handler, no need to wait
        // for the transaction's "oncomplete" handler.
        request.onsuccess = () => {
            try {
                resolve(
                    request.result.map(k =>
                        shouldBeEncrypted(STORAGE.RMAPS)
                            ? decryptKey(k as ArrayBuffer)
                            : (k as string)
                    )
                );
            } catch (err) {
                reject(err);
            }
        };
    });
}

/**
 * Reads the first 100 characters of the given object and returns its type. If it is not a ONE
 * object it simply returns "BLOB".
 * @internal
 * @static
 * @async
 * @param {(SHA256Hash|SHA256IdHash)} hash - Hash identifying a ONE object in storage
 * @returns {Promise<string>} The type string of the given microdata object, or 'BLOB' or 'CLOB'
 * if the given string does not look like ONE object microdata
 */
export async function getFileType(hash: SHA256Hash<HashTypes> | SHA256IdHash): Promise<string> {
    let firstChars;

    try {
        firstChars = await getNCharacters(hash);
    } catch (err) {
        if (err.code === 'SB-RD-NOSTR') {
            return 'BLOB';
        }

        throw err;
    }

    return getTypeFromMicrodata(firstChars);
}

/**
 * @internal
 * @static
 * @async
 * @param {string} oldSecret
 * @param {string} newSecret
 * @returns {Promise<void>}
 */
export async function changeStoragePassword(oldSecret: string, newSecret: string): Promise<void> {
    return _changeStoragePassword(oldSecret, newSecret);
}
