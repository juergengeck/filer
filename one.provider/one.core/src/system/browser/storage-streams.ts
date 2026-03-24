/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

import {
    fromByteArray as fromByteArrayToBase64,
    toByteArray as toByteArrayFromBase64
} from 'base64-js';

import {createError} from '../../errors.js';
import type {BLOB, CLOB, HashTypes} from '../../recipes.js';
import type {
    FileCreation,
    FileCreationStatus,
    SimpleReadStream,
    SimpleWriteStream,
    StorageDirTypes
} from '../../storage-base-common.js';
import {STORAGE} from '../../storage-base-common.js';
import {concatenateArrayBuffers} from '../../storage-blob.js';
import type {OneEventSource} from '../../util/one-event-source.js';
import {createEventSource} from '../../util/one-event-source.js';
import type {TrackingPromiseObj} from '../../util/promise.js';
import {createTrackingPromise} from '../../util/promise.js';
import {isString} from '../../util/type-checks-basic.js';
import type {SHA256Hash} from '../../util/type-checks.js';
import {createCryptoHash} from './crypto-helpers.js';
import {getDbInstance, shouldBeEncrypted, writeUTF8TextFile} from './storage-base.js';
import {decrypt, encryptKey} from './storage-crypto.js';
import {getArrayBuffer} from '../../util/buffer.js';

/**
 * @private
 * @param {ArrayBufferLike | Uint8Array} buf
 * @returns {Promise<SHA256Hash>}
 */
async function createSHA256FromArrayBuffer(
    buf: ArrayBufferLike | Uint8Array
): Promise<SHA256Hash<BLOB>> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', getArrayBuffer(buf));
    const hashArray = new Uint8Array(hashBuffer);

    return hashArray.reduce(
        (prev, curr) => prev + curr.toString(16).padStart(2, '0'),
        ''
    ) as SHA256Hash<BLOB>;
}

/**
 * Same as browser/storage-base-js method readUTF8TextFile() but for objects saved as ArrayBuffer.
 * Other platforms use real streams, from IndexedDB we can only get the entire object all at once.
 *
 * NOTE: This is the same as the readUTF8TextFile() function in storage-base, except that that
 * function was given a string type check. This is to avoid surprise when that function suddenly
 * returns an ArrayBuffer, and to keep the behavior of that function in line with how it behaves
 * on the other platforms.
 *
 * On the other platforms any UTF-8 file can also be streamed, and any file is a "binary file"
 * including UTF-8 encoded text files. To recreate that behavior we have to work around the fact
 * that we have two types of stored objects, and that one cannot be read as if it where the
 * other even by accident.
 * @private
 * @param {string} filename
 * @returns {Promise<string|ArrayBuffer>}
 */
function readStringOrBuffer(filename: string): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject): void => {
        const transaction = getDbInstance().transaction(STORAGE.OBJECTS);

        transaction.onerror = () => reject(createError('SST-RSB', transaction.error));

        const objectStore = transaction.objectStore(STORAGE.OBJECTS);
        const request = objectStore.get(shouldBeEncrypted() ? encryptKey(filename) : filename);

        request.onerror = () => reject(createError('SST-RSB', request.error));

        // If "filename" does not exist:
        // See https://www.w3.org/TR/IndexedDB-2/#dom-idbobjectstore-get
        //   "This method produces the same result if a record with the given key doesn't exist
        //    as when a record exists, but has undefined as value."
        // We should not have any "undefined" values for any key in the database.
        request.onsuccess = () => {
            if (request.result === undefined) {
                reject(
                    createError('SST-RSB', {
                        name: 'FileNotFoundError',
                        filename,
                        type: STORAGE.OBJECTS
                    })
                );
            } else {
                let r = request.result;

                // The try/catch is for the decrypt(), without it any errors thrown from there
                // would be uncaught
                try {
                    r = shouldBeEncrypted() ? decrypt(request.result) : request.result;
                } catch (err) {
                    reject(err);
                }

                // For a read task we can resolve from the request's success handler, no need to
                // wait for the transaction's "oncomplete" handler.
                resolve(r);
            }
        };
    });
}

/**
 * @private
 * @param {SHA256Hash} hash
 * @param {("base64"|"utf8"|undefined)} encoding
 * @param {TrackingPromiseObj<void>} streamTracker
 * @param {Function} dispatch - A function: `(param: string | ArrayBufferLike | Uint8Array) => void`
 * @returns {Promise<undefined>}
 */
async function emitFileInSingleChunk(
    hash: SHA256Hash<HashTypes>,
    encoding: undefined | 'base64' | 'utf8',
    streamTracker: TrackingPromiseObj<void>,
    dispatch: OneEventSource<string | ArrayBufferLike | Uint8Array>['dispatch']
): Promise<void> {
    try {
        const chunk = await readStringOrBuffer(hash);

        if (isString(chunk)) {
            // This is a text file: it is saved inside IndexedDB as string. By convention, we
            // require (UTF-8) text files to always be streamed with "utf8" encoding to
            // accommodate the various quirks of the platforms and to save on conversions
            // that are unnecessary since in ONE the requester knows the type (ONE object,
            // CLOB, BLOB).
            if (encoding !== 'utf8') {
                return streamTracker.reject(createError('SST-EMIT1', {hash, encoding}));
            }

            dispatch(chunk);
        } else {
            // ArrayBuffer
            if (encoding === 'utf8') {
                return streamTracker.reject(createError('SST-EMIT2', {hash}));
            }

            dispatch(encoding === 'base64' ? fromByteArrayToBase64(new Uint8Array(chunk)) : chunk);
        }

        setTimeout(streamTracker.resolve, 0);
    } catch (err) {
        streamTracker.reject(createError('SST-EMIT', err));
    }
}

// OVERLOADS to help set the "on('data')" event data type to either "string" or "ArrayBuffer",
// depending on the value of "encoding"
export function createFileReadStream(hash: SHA256Hash<HashTypes>): SimpleReadStream<undefined>;
export function createFileReadStream(
    hash: SHA256Hash<HashTypes>,
    encoding: undefined
): SimpleReadStream<undefined>;
export function createFileReadStream(
    hash: SHA256Hash<HashTypes>,
    encoding: 'base64'
): SimpleReadStream<'base64'>;
export function createFileReadStream(
    hash: SHA256Hash<HashTypes>,
    encoding: 'utf8'
): SimpleReadStream<'utf8'>;
export function createFileReadStream(
    hash: SHA256Hash<HashTypes>,
    encoding?: undefined | 'base64' | 'utf8'
): SimpleReadStream;
export function createFileReadStream<E extends undefined | 'base64' | 'utf8'>(
    hash: SHA256Hash<HashTypes>,
    encoding: E
): SimpleReadStream<E>;

/**
 * @internal
 * @static
 * @param {SHA256Hash} hash - Hash (and filename) of a ONE object, CLOB or BLOB
 * @param {('base64'|'utf8')} [encoding] - Use 'utf8' for streams of UTF-8 text files if you want
 * them streamed as UTF-8 (otherwise they are just treated as binary streams). Everything else is
 * treated as "binary" and can be streamed as pure binary stream (ArrayBuffer, leave this
 * parameter undefined), or as base64 encoded binary stream (the React Native platform does not
 * support getting binary data across the native-to-Javascript bridge and requires all binary
 * data to be base64 encoded).
 *
 * For BLOBs, files saved as `ArrayBuffer`:
 * - undefined: binary stream (ArrayBuffer)
 * - 'base64': base64 encoded binary stream (string, JSON)
 *
 * For ONE objects and CLOBs, files saved as `string`:
 * - 'utf8': UTF-8 string stream of UTF-8 contents
 *
 * Special on the browser platform: The files are stored as `string` or `ArrayBuffer` respectively
 * instead of as files. That means the chosen encoding has to match the file format!
 *
 * ENCODING ERROR CONDITIONS: This is why this platform has unique error conditions. On node.js
 * you could deliver a UTF-8 file as binary (buffer), on React Native as base64 encoded binary.
 * On the browser we insist they are only sent with "utf8" encoding to avoid conversions.
 * @returns {SimpleReadStream} Returns a simple platform-independent readable stream.
 * @throws {Error} Throws a synchronous `Error` if no filename is given
 * @throws {Error} Rejects with an Error whose name property is set to `FileNotFoundError` if the
 * file cannot be found
 */
export function createFileReadStream<E extends undefined | 'base64' | 'utf8'>(
    hash: SHA256Hash<HashTypes>,
    encoding?: E
): SimpleReadStream<E> {
    if (hash === undefined) {
        throw createError('SST-CR1');
    }

    const streamTracker = createTrackingPromise<void>();
    const onDataEvents = createEventSource<E extends undefined ? ArrayBuffer : string>();

    // Stream starts in the next event loop iteration as soon as the first (and only) event
    // handler is subscribed.
    onDataEvents.onListenerChange = (_oldSize: number, newSize: number) => {
        // This platform with its single-chunk-emit does not need to stop the stream when the
        // handler is removed. Disallowing more than one handler is  especially necessary for
        // this implementation, because each time a handler is subscribed all current
        // subscribers receive the entire file, and this should definitely only happen once
        // (even if we used chunks). Sorting it out for more than one subscriber is without use
        // case at the moment.
        if (newSize > 1) {
            throw createError('SST-CR2');
        }

        setTimeout(emitFileInSingleChunk, 0, hash, encoding, streamTracker, onDataEvents.dispatch);
    };

    return {
        encoding: encoding as E,
        onData: onDataEvents.consumer,
        pause: () => undefined,
        resume: () => undefined,
        cancel: () => undefined,
        promise: streamTracker.promise
    };
}

export function createFileWriteStream(): SimpleWriteStream<undefined>;
export function createFileWriteStream(encoding: undefined): SimpleWriteStream<undefined>;
export function createFileWriteStream(encoding: 'base64'): SimpleWriteStream<'base64'>;
export function createFileWriteStream(encoding: 'utf8'): SimpleWriteStream<'utf8'>;
export function createFileWriteStream(
    encoding: undefined,
    filename: string,
    type: StorageDirTypes
): SimpleWriteStream<undefined>;
export function createFileWriteStream(
    encoding: 'base64',
    filename: string,
    type: StorageDirTypes
): SimpleWriteStream<'base64'>;
export function createFileWriteStream(
    encoding: 'utf8',
    filename: string,
    type: StorageDirTypes
): SimpleWriteStream<'utf8'>;
export function createFileWriteStream(encoding: undefined | 'base64' | 'utf8'): SimpleWriteStream;
export function createFileWriteStream(
    encoding: undefined | 'base64' | 'utf8',
    filename: string,
    type: StorageDirTypes
): SimpleWriteStream;
export function createFileWriteStream<E extends undefined | 'base64' | 'utf8'>(
    encoding?: E,
    filename?: string,
    type?: StorageDirTypes
): SimpleWriteStream<E>;

/**
 * Have a look at the description of the {@link SimpleWriteStream} object returned by the method
 * for coding style information (purpose of "promise" property, for example).
 * @internal
 * @static
 * @param {('base64'|'utf8')} [encoding] - 'utf8' for text file streams or 'base64' for base64
 * encoded string streams, `undefined` for binary streams
 * @param {string} [filename]
 * @param {StorageDirTypes} [type='objects']
 * @returns {SimpleWriteStream} Returns a simple platform-independent writable stream.
 */
export function createFileWriteStream<E extends undefined | 'base64' | 'utf8'>(
    encoding?: E,
    filename?: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): SimpleWriteStream<E> {
    if (isString(filename) && type === STORAGE.OBJECTS) {
        throw createError('SST-PARA1', {filename});
    }

    // Create a passive "tracking promise" (see creation function for explanation)
    const streamTracker = createTrackingPromise<FileCreation<E extends 'utf8' ? CLOB : BLOB>>();

    // Since we have no underlying system stream object we have to keep track of the stream's
    // state right here on this level
    let streamEnded = false;

    const chunks: Array<string | ArrayBuffer> = [];

    function writeFn(data: string | ArrayBufferLike | Uint8Array): void {
        if (streamEnded) {
            const err = createError('SST-ENDED');
            streamTracker.reject(err);
            throw err;
        }

        try {
            if (chunks.length > 0 && typeof chunks[0] !== typeof data) {
                return streamTracker.reject(
                    createError('SST-WTYPE', {
                        typeofFirstChunk: typeof chunks[0],
                        typeofData: typeof data
                    })
                );
            }

            if (isString(data)) {
                // This is a UTF-8 text file or a base64 encoded binary chunk
                if (encoding === undefined) {
                    streamEnded = true;
                    return streamTracker.reject(createError('SST-CW2'));
                }

                if (encoding === 'base64') {
                    chunks.push(getArrayBuffer(toByteArrayFromBase64(data)));
                } else {
                    chunks.push(data);
                }

                // chunks.push(encoding === 'base64' ? toByteArrayFromBase64(data) : data);
            } else {
                // ArrayBuffer
                if (encoding !== undefined) {
                    streamEnded = true;
                    return streamTracker.reject(createError('SST-CW3', {encoding}));
                }

                chunks.push(getArrayBuffer(data));
            }
        } catch (err) {
            const e = createError('SST-CW', err);
            streamEnded = true;
            streamTracker.reject(e);
            throw e;
        }
    }

    function cancelFn(): Promise<void> {
        streamTracker.reject(createError('SST-CAN'));
        streamEnded = true;
        return Promise.resolve();
    }

    async function endFn(): Promise<FileCreation<E extends 'utf8' ? CLOB : BLOB>> {
        if (streamEnded) {
            const err = createError('SST-ENDED');
            streamTracker.reject(err);
            throw err;
        }

        // NOTE: Keep this check _after_ the check of streamEnded because below we clear "chunks"
        if (chunks.length === 0) {
            const err = createError('SST-END1');
            streamTracker.reject(err);
            throw err;
        }

        // No undefined possible: A failure to computer either value within the try/catch would
        // lead to the "throw" in the catch handler.
        let hash: SHA256Hash<E extends 'utf8' ? CLOB : BLOB>;
        let status: FileCreationStatus;

        try {
            // ALLOW GC TO RECLAIM SPACE
            // "chunks" as well as the respective variable holding the concatenated file is cleared
            // to enable garbage collection, in case the stream object is kept around by the
            // calling environment preventing GC even after the stream ended. BLOBs may use
            // significant space.

            if (isString(chunks[0])) {
                const totalUTF8File = (chunks as string[]).join('');
                chunks.length = 0;
                hash = (
                    isString(filename) ? filename : await createCryptoHash(totalUTF8File)
                ) as SHA256Hash<E extends 'utf8' ? CLOB : BLOB>;
                status = await writeUTF8TextFile(totalUTF8File, hash, type);
            } else {
                // "chunks" array is deliberately emptied in the process of concatenating the
                // buffers!
                const totalBinaryFile = concatenateArrayBuffers(chunks as ArrayBufferLike[]);

                hash = (
                    isString(filename)
                        ? filename
                        : await createSHA256FromArrayBuffer(totalBinaryFile)
                ) as SHA256Hash<E extends 'utf8' ? CLOB : BLOB>;

                // TYPE HACK: If it weren't for the static types that function would not care
                // what it writes. It simply does an add() operation to add the data to the
                // IndexedDB object store.
                status = await writeUTF8TextFile(totalBinaryFile as any, hash, type);
            }
        } catch (err) {
            const e = createError('SST-END', err);
            streamTracker.reject(e);
            throw e;
        } finally {
            streamEnded = true;
        }

        const result: FileCreation<E extends 'utf8' ? CLOB : BLOB> = {
            hash,
            status
        };

        streamTracker.resolve(result);

        return result;
    }

    return {
        write: writeFn,
        cancel: cancelFn,
        end: endFn,
        promise: streamTracker.promise
    };
}
