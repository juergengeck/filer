/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module contains functions and definitions for the base storage module functions that are
 * shared across all platforms.
 * @module
 */

/**
 * Options for the {@link initStorage} function in module `system/storage-base`. The function is
 * called by `initInstance`.
 * @global
 * @typedef {object} InitStorageOptions
 * @param {SHA256IdHash} instanceIdHash
 * @param {boolean} [wipeStorage]
 * @param {string} [name]
 * @param {number} [nHashCharsForSubDirs]
 * @param {number} [storageInitTimeout]
 * @param {boolean} [encryptStorage]
 * @param {(string|null)} secretForStorageKey
 */
export interface InitStorageOptions {
    instanceIdHash: SHA256IdHash<Instance>;
    wipeStorage?: boolean;
    name?: string;
    nHashCharsForSubDirs?: number;
    storageInitTimeout?: number;
    encryptStorage?: boolean;
    secretForStorageKey: string | null;
}

/**
 * The settings store is a key-value store used to store instance settings that cannot or should
 * not be stored in the usual ONE storage places.
 * The browser implementation uses `localStorage` and the node.js version stores a file with the
 * settings ina JSON.stringified object in the "private" storage space.
 * @global
 * @typedef {object} SettingStoreApi
 * @property {function(string):Promise<string|AnyObject|undefined>} getItem
 * @property {function(string,(string|AnyObject)):Promise<undefined>} setItem
 * @property {function(string):Promise<undefined>} removeItem
 * @property {function():Promise<undefined>} clear
 */
export interface SettingStoreApi {
    getItem: (key: string) => Promise<string | AnyObject | undefined>;
    setItem: (key: string, value: string | AnyObject) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    clear: () => Promise<void>;
}

/**
 * `SystemReadStream` objects are created by factory function
 * {@link system/storage-streams.module:ts.createFileReadStream|system/storage-streams.createFileReadStream}.
 *
 * This type has a generic parameter for the encoding setting: `undefined` | 'utf8' | 'base64'.
 * Depending on the encoding the `ondData` function yields `string` or `Buffer` or `Uint8Array` data.
 *
 * It provides a platform independent interface to streams: filesystem streams on node.js,
 * {@link https://github.com/wkh237/react-native-fetch-blob|RNFetchBlob} on React Native, and a
 * custom minimal implementation on browsers.
 *
 * The event system is modeled after the one found for IndexedDB and for WebSockets, among
 * others: You simply assign a function to the appropriately named property on the
 * `SimpleReadStream` object.
 * @global
 * @typedef {object} SimpleReadStream
 * @property {('base64'|'utf8')} [encoding] - `undefined` for Uint8Array based binary streams,
 * "`base64"` for string based binary streams, "`utf8"` for UTF-8 string based text streams. In
 * the ONE library context:
 * Requests for BLOBs: `undefined` (normal case) or `base64` (React Native client)
 * Requests for CLOBs and ONE objects: `utf8`
 * @property {OneEventSourceConsumer<string|ArrayBufferLike|Uint8Array>} onData - Event source property with its
 * public methods to subscribe to events
 * @property {function():void} pause - Pause the read stream; `() => void`
 * @property {function():void} resume - Resume the read stream; `() => void`
 * @property {function():void} cancel - Cancel the read stream; `() => void`
 * @property {Promise<void>} promise - A
 * {@link util/promise.module:ts.createTrackingPromise|tracking promise}
 * for 3rd parties to get the result when the stream ends (stream completed or error)
 */
export interface SimpleReadStream<
    E extends undefined | 'base64' | 'utf8' = undefined | 'base64' | 'utf8'
> {
    encoding: E;
    onData: OneEventSourceConsumer<E extends undefined ? ArrayBufferLike | Uint8Array : string>;
    pause: () => void;
    resume: () => void;
    cancel: () => void;
    promise: Promise<void>;
}

/**
 * `SimpleWriteStream` objects are created by factory function
 * {@link system/storage-streams.module:ts.createFileWriteStream|storage-streams.createFileWriteStream}.
 *
 * This type has a generic parameter for the encoding setting: `undefined` | 'utf8' | 'base64'.
 * Depending on the encoding the `write` function expects (only) `string` or `Buffer` data.
 *
 * It provides a platform independent interface to streams: filesystem streams on node.js,
 * {@link https://github.com/wkh237/react-native-fetch-blob|RNFetchBlob} on React Native, and a
 * custom minimal implementation on browsers.
 *
 * Instead of events for "error" and "finish" there is a `promise`, which allows for easier
 * integration with promise based code in general and async/await based code in particular.
 *
 * ## Style
 *
 * This write-stream object assumes two different kinds of clients:
 *
 * - A single instance of code that actually uses and manages the stream
 *
 * - An arbitrary number of instances of code not involved with the stream but interested in its
 *   final result.
 *
 * The active code gets functions to control the stream.
 *
 * Passively involved code gets a promise that will resolve or reject when the final result of
 * the stream becomes available. That promise does not control any of the code used to run the
 * stream, it is only used to communicate the official result.
 *
 * The code actually using the stream would have no use for a promise though: Streams and
 * promises are fundamentally different in their aims. The code that *does* end up using the
 * promise, however, a promise is the perfect abstraction - it only wants to know the final result.
 * @global
 * @typedef {object} SimpleWriteStream
 * @property {function((string|ArrayBufferLike|Uint8Array)):void} write - `(data: E extends undefined ?
 * ArrayBuffer | Uint8Array :
 * string) => void` - If the write-stream was created without an encoding the parameter must be
 * an Uint8Array. If it was created with an encoding there must be a string, either UTF-8 or a
 * Base64 encoded binary, depending on the encoding.
 * @property {function():Promise<undefined>} cancel - `() => Promise<void>` -  Cancel stream and
 * remove temporary file
 * @property {function():Promise<FileCreation>} end - `() => Promise<FileCreation<E extends
 * 'utf8' ? CLOB : BLOB>>` - Finish the stream, return final result
 * @property {Promise<FileCreation<'BLOB'>>} promise - A
 * {@link util/promise.module:ts.createTrackingPromise|tracking promise}
 * for 3rd parties to get the result when the stream ends (stream completed or error)
 */
export interface SimpleWriteStream<
    E extends undefined | 'base64' | 'utf8' = undefined | 'base64' | 'utf8'
> {
    write: (data: E extends undefined ? ArrayBufferLike | Uint8Array : string) => void;
    cancel: () => Promise<void>;
    end: () => Promise<FileCreation<E extends 'utf8' ? CLOB : BLOB>>;
    promise: Promise<FileCreation<E extends 'utf8' ? CLOB : BLOB>>;
}

/**
 * A union type of versioned and unversioned object creation result objects, for any ONE object
 * type.
 * @global
 * @typedef {(UnversionedObjectResult|VersionedObjectResult)} AnyObjectCreation
 */
export type AnyObjectCreation<T extends OneObjectTypes = OneObjectTypes> =
    T extends OneUnversionedObjectTypes
        ? UnversionedObjectResult<T>
        : T extends OneVersionedObjectTypes
          ? VersionedObjectResult<T>
          : never;

/**
 * This defines the creation status string constants for files such as ONE microdata files,
 * CLOBs and BLOBs. This overlaps with the status for unversioned ONE objects because those are
 * simple text files for the low-level storage API that does not deal with ONE objects but
 * simple with "files" in the most general sense.
 *
 * To check a status don't use the string constants directly (they could be changed!). Use
 * storage module's exported `CREATION_STATUS` enum (static frozen object) with the properties
 * `NEW` and `EXISTS`.
 *
 * ### Usage
 *
 * Instead of using these strings directly please use the
 * {@link storage-base-common.module:ts.CREATION_STATUS|storage-base-common.CREATION_STATUS}
 * export of
 *
 * ```javascript
 * import {StorageBaseCommon} from 'storage-base-common.js');
 *
 * // StorageBaseCommon.CREATION_STATUS.NEW
 * // StorageBaseCommon.CREATION_STATUS.EXISTS
 * ```
 * @global
 * @typedef {("new"|"exists")} FileCreationStatus
 */
export type FileCreationStatus = (typeof CREATION_STATUS)[keyof typeof CREATION_STATUS];

/**
 * Return result object of creating CLOB and BLOB file objects.
 * @global
 * @typedef {object} FileCreation
 * @property {SHA256Hash} hash - The SHA-256 hash of the contents of a versioned ONE object
 * @property {FileCreationStatus} status - A string constant showing whether the file
 * already existed or if it had to be created.
 */
export interface FileCreation<T extends HashTypes> {
    hash: SHA256Hash<T>;
    status: FileCreationStatus;
}

import type {
    BLOB,
    CLOB,
    HashTypes,
    Instance,
    OneObjectTypes,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypes
} from './recipes.js';
import type {UnversionedObjectResult} from './storage-unversioned-objects.js';
import type {VersionedObjectResult} from './storage-versioned-objects.js';
import type {AnyObject} from './util/object.js';
import type {OneEventSourceConsumer} from './util/one-event-source.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';

/**
 * These static strings describe object creation. If an object did not exist yet - for versioned
 * objects that includes any previous versions based on the ID-object - the status is "new". If
 * an object that is to be created already exists (which is recognized because the names of all
 * files are based on the SHA256 crypto hash of its contents) the status is "exists". For
 * versioned objects this means the exact object already exists, not just a previous version
 * (base don ID-object). The last state is used for versioned objects only. When a previous
 * version of the object exists, based on the ID-object, but the exact version of the object
 * does not, the object is created and added as a new version of the existing ID-object.
 * *Note:* This is defined here and not in storage-unversioned-objects.js because then we
 * would have to import that file here, but since we already do it the other way around it's
 * easier to avoid a cyclic reference for such a minor thing, even though it works. **Always
 * use the names (keys) on this structure, never use the values themselves!**
 * @static
 * @type {object}
 * @property {'new'} NEW - There was not even a previous version of this object
 * @property {'exists'} EXISTS - This exact object (identified by SHA-256) already exists
 */
export const CREATION_STATUS = {
    NEW: 'new',
    EXISTS: 'exists'
} as const;

/**
 * String constants for {@link SetAccessParam}'s `mode` parameter.
 * @static
 * @type {object}
 * @property {'replace'} REPLACE
 * @property {'add'} ADD
 */
export const SET_ACCESS_MODE = {
    REPLACE: 'replace',
    ADD: 'add'
} as const;

/**
 * String constants for the storage types.
 * Avoid having to repeat the string constant
 * @static
 * @type {object}
 * @property {OBJECTS} "objects"
 * @property {PRIVATE} "private"
 */
export const STORAGE = {
    OBJECTS: 'objects',
    TMP: 'tmp',
    RMAPS: 'rmaps',
    VHEADS: 'vheads',
    ACACHE: 'acache',
    PRIVATE: 'private'
} as const;

/**
 * One of these fixed strings: `'objects' | 'tmp' | rmaps | vheads | 'acache', 'private'`
 * @global
 * @typedef {'objects'|'tmp'|'rmaps'|'vheads'|'acache'|'private'} StorageDirTypes
 */
export type StorageDirTypes = (typeof STORAGE)[keyof typeof STORAGE];

/**
 * Used to ensure createTempFileName() creates unique names.
 * @private
 * @type {number}
 */
let tempFileNameCounter = 0;

/**
 * Temporary filenames are needed for files we receive as streams, for example BLOBs received
 * during Chum exchange. We won't know the SHA-256 normally used as filename until we received it
 * completely.
 *
 * **NOTE:** This function cannot be replaced by system/crypto-helpers createRandomString. We
 * need this to be a synchronous function, or we would have to return SimpleWriteStream API
 * objects asynchronously (undesirable because illogical).
 * @static
 * @returns {string} A randomly created temporary filename
 */
export function createTempFileName(): string {
    // Using only the counter is sufficient because each instance, identified by its ID hash,
    // has its own storage space and in it its own "tmp" area. One would have to run two
    // versions of the same instance at the same time to get conflicts. Still, in case of
    // conflict with leftover files from a previous run we also use a timestamp. Also using the
    // counter avoids conflicts for multiple calls to this function within the same millisecond.
    // While there should not be any leftover tmp files from previous runs that is a higher
    // level issue that in this function we don't want to rely on, because that might very well
    // change. So let's just create a name that will still work if name conflicts across
    // multiple runs are possible, since it is so easy to avoid and since it removes a very
    // low-level dependency on high-level design decisions.
    return `tmp-${Date.now()}-${tempFileNameCounter++}`;
}
