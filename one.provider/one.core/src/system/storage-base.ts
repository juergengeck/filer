/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/require-await */

/**
 * @module
 */

import {createError} from '../errors.js';
import type {HashTypes, Instance} from '../recipes.js';
import type {
    FileCreationStatus,
    InitStorageOptions,
    StorageDirTypes
} from '../storage-base-common.js';
import {STORAGE} from '../storage-base-common.js';
import type {EventHandlerCb, OneEventSourceConsumer} from '../util/one-event-source.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';
import type {IndexedDBEvent} from './browser/storage-base.js';
import {ensurePlatformLoaded} from './platform.js';

type SbBrowser = typeof import('./browser/storage-base.js');
type SbNode = typeof import('./nodejs/storage-base.js');

export type {IndexedDBEvent} from './browser/storage-base.js';

/*
 * Browser: IndexedDB name to use if none is given
 * node.js: Directory name to be used if none is given
 */
export const DEFAULT_STORAGE_LOCATION = 'OneDB';

let SB: SbNode | SbBrowser;

export function setPlatformForSb(exports: SbBrowser | SbNode): void {
    SB = exports;
}

/**
 * **Only available on the browser platform.**
 *
 * On node.js an error is thrown on access attempt.
 *
 * On browsers, and if the browser platform module has not been loaded by the time an access
 * attempt is made, an error is thrown.
 *
 * Emits events of type {@link IndexedDBEvent}
 * @static
 * @type {OneEventSourceConsumer<IndexedDBEvent>}
 */
export const onIndexedDB: OneEventSourceConsumer<IndexedDBEvent> = {
    get addListener(): (cb: EventHandlerCb<IndexedDBEvent>) => () => void {
        ensurePlatformLoaded();

        if ((SB as SbBrowser).onIndexedDB === undefined) {
            throw createError('SB-ONIDXDB1');
        }

        return (SB as SbBrowser).onIndexedDB.addListener;
    },
    get removeListener(): (cb: EventHandlerCb<IndexedDBEvent>) => void {
        ensurePlatformLoaded();

        if ((SB as SbBrowser).onIndexedDB === undefined) {
            throw createError('SB-ONIDXDB1');
        }

        return (SB as SbBrowser).onIndexedDB.removeListener;
    }
};

/**
 * The arguments are different depending on the concrete platform. React Native and node.js want
 * a directory (string), for example, the browser wants a name of an IndexedDB database.
 * @static
 * @async
 * @param {object} options
 * @param {SHA256IdHash} options.instanceIdHash
 * @param {boolean} [options.wipeStorage=false] - If `true` **all files in storage will be
 * deleted** when the instance is initialized. All files means *every single file*. Storage is
 * wiped clean.
 * @param {string} [options.name] - Platform dependent optional identifier of the storage location.
 * One platform where the file system is used, such as node.js, this is a directory. In browsers
 * this is the name component of the IndexedDB database (the other component is the instance ID
 * hash).
 * If this is a directory, **independent of the platform always use "/" as path component
 * separator here.** *(We have to be flexible handling paths we get from the system, but we have
 * to standardize the paths we use in our cross-platform code.)*
 * @param {number} [options.nHashCharsForSubDirs=0] - In "object" storage, the first `n`
 * characters of o files name - a hexadecimal SHA-256 hash string - are used to locate the file in
 * a subdirectory of that name. For example, if a file name (hash) starts with "0fe123...." and
 * n=2, then the file will be located not in directory `objects/` but in directory
 * `objects/0f/`. This hierarchical storage option is only offered on *some* platforms. When
 * this option has a number higher than 0 on a platform that does not support it an error is thrown.
 * @param {number} [options.storageInitTimeout=1000] - The browser platform accepts this
 * parameter to time out the `indexedDB.open()` attempt in case the request blocks (found on
 * Safari). Default is 1000ms. This can or should be used together with `one.core/util/promise
 * method` `retry`. On other platforms this parameter is ignored.
 * @param {boolean} [options.encryptStorage=false] - **Only if the platform supports it.**
 * If set to `true` all items in all storage spaces are encrypted. Storage space "private" is
 * always encrypted.
 * @param {string|null} [options.secretForStorageKey] - This secret is used to derive a key to be
 * used to en- and decrypt all items in all storage spaces, or only the ones in "private",
 * depending on the value of `encryptStorage`.
 * @returns {Promise<undefined>}
 * @throws {Error} Throws an `Error` if the first parameter is not a hash
 */
export async function initStorage(options: InitStorageOptions): Promise<void> {
    ensurePlatformLoaded();
    return await SB.initStorage(options);
}

export function closeStorage(): void {
    if (SB === undefined) {
        // Storage is not even open yet
        return;
    }

    ensurePlatformLoaded();

    return SB.closeStorage();
}

/**
 * Browser:
 * The name of the IndexedDB database
 *
 * node.js:
 * The directory given to initInstance() that holds all instance directories. The directory for
 * the current instance named with its Instance ID hash is in this directory, and so are any
 * other instances that were given the same directory in their instance options.
 * @type {string|undefined}
 */
let BASE_NAME: undefined | string;

/**
 * Set the base DB name, but it can only be set once. Calling this function again with a
 * different value than the first time causes an error. This exists for compatibility with the
 * node.js storage-base, where this is the base directory, and it can be set before storageInti
 * (instanceInit) for the SettingsStore. The browser SettingsStore uses localStorage and does
 * not require this information.
 * @static
 * @async
 * @param {string} [name='OneDB']
 * @returns {undefined}
 */
export function setBaseDirOrName(name: string = DEFAULT_STORAGE_LOCATION): void {
    if (BASE_NAME !== undefined && BASE_NAME !== name) {
        throw createError('SB-SETDIR', {oldDir: BASE_NAME, newDir: name});
    }

    BASE_NAME = name;
}

/**
 * Used by module settings-store at least, meant for any module that needs to write outside and
 * above the instance storage directories under BASE_DIR/INSTANCE_ID/[objects|tmp|vmap|rmap|...].
 *
 * The function is also useful if setBaseDirOrName was called without a parameter, so that the
 * default name was used. In that case, if app code wants to find out that default, this
 * function can be called.
 * @static
 * @returns {string}
 */
export function getBaseDirOrName(): string {
    if (BASE_NAME === undefined) {
        throw createError('SB-NO-INIT1');
    }

    return BASE_NAME;
}

/**
 *
 * @static
 * @async
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<void>}
 */
export async function deleteStorage(instanceIdHash: SHA256IdHash<Instance>): Promise<void> {
    ensurePlatformLoaded();
    return SB.deleteStorage(instanceIdHash);
}

/**
 * Checks if the instance exists or not.
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<boolean>}
 */
export async function doesStorageExist(instanceIdHash: SHA256IdHash<Instance>): Promise<boolean> {
    ensurePlatformLoaded();
    return SB.doesStorageExist(instanceIdHash);
}

/**
 * Read the given file as UTF-8 string. If the file has a bOM it is not stripped.
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<string>}
 * @throws {Error} Throws an `Error` if no filename is given
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found
 */
export async function readUTF8TextFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    ensurePlatformLoaded();
    return SB.readUTF8TextFile(filename, type);
}

/**
 * Read *a section* of the given UTF-8 encoded file as string. If the file has a bOM the offset
 * will be off. If a UTF-8 character used in the file uses more than one byte the offset will be
 * off. That is why unless you calculate the byte offset yourself the byte offset only matches the
 * character offset in the Javascript string representation of the file contents if the file
 * only contains characters from the ASCII-compatible section of UTF-8 codes.
 * @static
 * @async
 * @param {string} filename
 * @param {number} offset - Where to start reading the UTF-8 encoded file. Depending on how the
 * platform stores text files this is a byte offset (node.js) or a character offset (browser,
 * strings stored in IndexedDB). Those are equal if there is no BOM and the stored string only
 * contains characters from the ASCII character set. If the offset is **negative** it is counted
 * backwards from the end of the file.
 * @param {number} length - How many bytes to read starting at the given offset (always forward).
 * @returns {Promise<string>} - Returns the given section converted to a Javascript string
 * @param {StorageDirTypes} [type='objects']
 * @throws {Error} Throws an `Error` if a parameter is missing
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found
 */
export async function readTextFileSection(
    filename: string,
    offset: number,
    length: number,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    ensurePlatformLoaded();
    return SB.readTextFileSection(filename, offset, length, type);
}

/**
 * **Note that existing files will not be overwritten!** That is because this function is
 * made for our special context, where all files are stored under their SHA-256 hash as name, so
 * overwriting a file would make no sense.
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIR[type]
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new, exists).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given
 */
export async function writeUTF8TextFile(
    contents: string,
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<FileCreationStatus> {
    ensurePlatformLoaded();
    return SB.writeUTF8TextFile(contents, filename, type);
}

/**
 * **Note that existing files will be overwritten!**
 * The file is silently created if it does not exist.
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIR[type]
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if the 3rd
 * parameter is not "rmaps" or "vheads"
 */
export async function writeUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    ensurePlatformLoaded();
    return SB.writeUTF8SystemMapFile(contents, filename, type);
}

/**
 * **This function is reserved for system internal version-map and reverse-map files.**
 * This function silently creates the file if it does not exist.
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename without directory
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string which always is "new" to be consistent with the writeUTF8TextFile()
 * method
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if the 3rd
 * parameter is not "rmaps" or "vheads"
 */
export async function appendUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    ensurePlatformLoaded();
    return SB.appendUTF8SystemMapFile(contents, filename, type);
}

/**
 * Reads a binary file from storage space "private". Storage encryption is ignored, the raw file is
 * returned.
 *
 * ### Platform difference
 *
 * On node.js the file's contents always is returned as `ArrayBuffer`, even if it is a UTF-8 text
 * file. On web browser platforms, using IndexedDB as backend, we store either strings or
 * `ArrayBuffer` and get exactly that back. To ensure the function always returns only
 * `ArrayBuffer`, on that platform the function includes a check of the type of the returned
 * object and rejects with an Error if it is not `ArrayBuffer`.
 * @static
 * @async
 * @param {string} filename
 * @returns {Promise<ArrayBuffer>}
 */
export async function readPrivateBinaryRaw(filename: string): Promise<ArrayBuffer> {
    ensurePlatformLoaded();
    return SB.readPrivateBinaryRaw(filename);
}

/**
 * Write a binary file from storage space "private". Storage encryption is ignored, the raw
 * ArrayBuffer or Uint8Array is written. If the file already exists the promise is rejected with an Error.
 * @param {string} filename
 * @param {ArrayBufferLike | Uint8Array} contents
 * @returns {Promise<void>}
 */
export async function writePrivateBinaryRaw(
    filename: string,
    contents: ArrayBufferLike | Uint8Array
): Promise<void> {
    ensurePlatformLoaded();
    return SB.writePrivateBinaryRaw(filename, contents);
}

/**
 * @static
 * @async
 * @param {string} filename - With full path
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<boolean>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export async function exists(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<boolean> {
    ensurePlatformLoaded();
    return SB.exists(filename, type);
}

/**
 * Returns the byte size of an object in storage. When storage encryption is enabled the size
 * will only be an approximate value! The main use case for this function is size-based filters
 * for chum exchange, and for that purpose getting the size within a margin of less than a
 * hundred bytes is good enough. This saves us from having to decrypt the contents just to get
 * the size. While the overhead of encryption is fixed and predictable we also add a random
 * padding, and that is the "approximate" part. We simply always subtract the middle value of
 * the maximum possible padding length.
 *
 * When using unencrypted storage the correct byte sizes are returned. On node.js that is the
 * "size" property of a Stat object. On the browser, where we use IndexedDb and not files, it is
 * the "byteLength" property of an `ArrayBuffer`, or the value pf
 * `new Blob([stringValue]).size`, the now most common way to get a byte length for a string in
 * Javascript.
 * @static
 * @async
 * @param {string} filename - With full path
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<boolean>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export async function fileSize(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<number> {
    ensurePlatformLoaded();
    return SB.fileSize(filename, type);
}

/**
 * @static
 * @async
 * @returns {Promise<SHA256Hash[]>}
 */
export async function listAllObjectHashes(): Promise<Array<SHA256Hash<HashTypes> | SHA256IdHash>> {
    ensurePlatformLoaded();
    return SB.listAllObjectHashes();
}

/**
 * @static
 * @async
 * @returns {Promise<SHA256IdHash[]>}
 */
export async function listAllIdHashes(): Promise<SHA256IdHash[]> {
    ensurePlatformLoaded();
    return SB.listAllIdHashes();
}

/**
 * @static
 * @async
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
export async function listAllReverseMapNames(prefix?: string): Promise<string[]> {
    ensurePlatformLoaded();
    return SB.listAllReverseMapNames(prefix);
}

/**
 * Reads the first 100 characters of the given object and returns its type. If it is not a ONE
 * object it simply returns "BLOB".
 * @static
 * @async
 * @param {(SHA256Hash|SHA256IdHash)} hash - Hash identifying a ONE object in storage
 * @returns {Promise<string>} The type string of the given microdata object, or 'BLOB' or 'CLOB'
 * if the given string does not look like ONE object microdata
 */
export async function getFileType(
    hash: SHA256Hash<HashTypes> | SHA256IdHash
): Promise<string | 'BLOB'> {
    ensurePlatformLoaded();
    return SB.getFileType(hash);
}

/**
 * When storage encryption is supported this function changes the secret used to encrypt the
 * storage keys. The function is called from `instance-change-password`'s `changePassword`
 * function.
 * @static
 * @async
 * @param {string} oldSecret
 * @param {string} newSecret
 * @returns {Promise<void>}
 */
export async function changeStoragePassword(oldSecret: string, newSecret: string): Promise<void> {
    ensurePlatformLoaded();
    return SB.changeStoragePassword(oldSecret, newSecret);
}
