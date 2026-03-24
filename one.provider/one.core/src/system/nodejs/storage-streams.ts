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

/*
 * NOTE ABOUT ERRORS AND PROMISE STYLE (promise.catch instead of try/catch)
 *
 * Low-level functions for file-access don't throw standard Javascript errors, they throw
 * node.js SYSTEM errors. Ref.: https://nodejs.org/api/errors.html#errors_system_errors
 *
 * When calling node.js fs methods we use .catch() instead of try/catch because
 *
 * 1. Only the former manages to enable async. stack trace creation (a feature available in
 *    recent node.js/V8)
 * 2. We also need to throw a createError(err) to get the stack trace. The one we get from Node.js
 *    does not have it. Our createError() method always creates a createError.
 */

import {createHash} from 'crypto';
import {createReadStream, createWriteStream} from 'fs';
import {rename, stat, unlink} from 'fs/promises';
import {join} from 'path';

import {createError} from '../../errors.js';
import type {BLOB, CLOB, HashTypes} from '../../recipes.js';
import type {
    FileCreation,
    FileCreationStatus,
    SimpleReadStream,
    SimpleWriteStream,
    StorageDirTypes
} from '../../storage-base-common.js';
import {createTempFileName, CREATION_STATUS, STORAGE} from '../../storage-base-common.js';
import {createEventSource} from '../../util/one-event-source.js';
import {createTrackingPromise} from '../../util/promise.js';
import {isString} from '../../util/type-checks-basic.js';
import type {SHA256Hash} from '../../util/type-checks.js';
import {deleteFile} from './storage-base-delete-file.js';
import {getStorageDirForFileType, normalizeFilename} from './storage-base.js';
import {getArrayBuffer} from '../../util/buffer.js';

/**
 * Promisified version of node.js file rename method. This "rename" refuses to replace an
 * already existing file - which is to support higher level code in recognizing that an object
 * already exists. That prevents "new object" events, which usually lead to actions like adding
 * the new object to one or more maps, and all that work is not necessary if a file with the
 * same hash and therefore the same contents already exists.
 * @private
 * @param {string} oldName - Old filename
 * @param {string} newName - New filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type creation
 * status string (new, exists)
 */
async function moveFromTempToObjectSpace(
    oldName: string,
    newName: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<FileCreationStatus> {
    if (oldName === undefined || newName === undefined) {
        throw createError('SST-MV1', {oldName, newName});
    }

    const oldWithPath = join(getStorageDirForFileType(STORAGE.TMP), oldName);
    const newWithPath = join(normalizeFilename(newName, type));

    // If renaming fails because the file already exists we delete the temporary file. The
    // context is the fact that ONE stores files under the SHA-256 of their contents, so if
    // something already exists we conclude the exact same file already exists, and there
    // is therefore no point in keeping the old one around.
    // PROMISE CHAIN METHODS ARE DELIBERATE, SEE NOTE AT TOP
    return await stat(newWithPath)
        .then(stats => {
            if (stats.isFile()) {
                // The target file already exists (and we assume it is the exact same contents)
                return unlink(oldWithPath)
                    .then(() => CREATION_STATUS.EXISTS)
                    .catch((unlinkErr: NodeJS.ErrnoException) => {
                        if (unlinkErr.code === 'ENOENT') {
                            // The file we were supposed to rename no longer exists. While this is
                            // seemingly okay since the target already exists so that it seems we've
                            // got what we wanted the disappearance of the file is unexpected.
                            throw createError('SST-MV2', {
                                name: 'FileNotFoundError',
                                filename: oldName,
                                type: STORAGE.TMP
                            });
                        }

                        throw createError('SST-MV6', unlinkErr);
                    });
            }

            // This is an "impossible" error, but you never know
            throw createError('SST-MV7', {old: oldWithPath, new: newWithPath});
        })
        .catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                // "No such file or directory" - perfect, go ahead.
                return rename(oldWithPath, newWithPath)
                    .then(() => CREATION_STATUS.NEW)
                    .catch((renameErr: NodeJS.ErrnoException) => {
                        if (renameErr.code === 'ENOENT') {
                            throw createError('SST-MV3', {
                                name: 'FileNotFoundError',
                                filename: oldName,
                                type: STORAGE.TMP
                            });
                        }

                        throw createError('SST-MV4', renameErr);
                    });
            }

            throw createError('SST-MV5', err);
        });
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
    encoding?: E
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
 * For BLOBSs:
 * - undefined: binary stream (ArrayBuffer)
 * - 'base64': base64 encoded binary stream
 *
 * For ONE objects and CLOBs:
 * - 'utf8': UTF-8 string stream of UTF-8 contents
 * @returns {SimpleReadStream} Returns a simple platform-independent readable stream.
 * @throws {Error} Throws a synchronous `Error` if no filename is given
 * @throws {Error} Throws an Error whose name is `FileNotFoundError` if the version map does not
 * exist
 */
export function createFileReadStream<E extends undefined | 'base64' | 'utf8'>(
    hash: SHA256Hash<HashTypes>,
    encoding?: E
): SimpleReadStream<E> {
    if (hash === undefined) {
        throw createError('SST-CR1');
    }

    // node.js default highWaterMark of 64 kb; autoClose default: true
    const stream = createReadStream(join(normalizeFilename(hash)), {encoding});

    const streamTracker = createTrackingPromise<void>();
    const onDataEvents =
        createEventSource<E extends undefined ? ArrayBufferLike | Uint8Array : string>();

    // Stream starts in the next event loop iteration as soon as the first (and only) event
    // handler is subscribed
    onDataEvents.onListenerChange = (_oldSize: number, newSize: number) => {
        if (newSize !== 1) {
            stream.removeAllListeners('data');
            stream.pause();
        }

        if (newSize > 1) {
            throw createError('SST-CR2');
        }

        if (newSize === 0) {
            return;
        }

        // SPECIAL TREATMENT for the last chunk of binary buffer chunks is the
        // reason for this if(), otherwise this would be a one-line statement
        if (encoding === undefined) {
            // Our normalized simple stream API promises an ArrayBuffer object
            // https://nodejs.org/dist/latest-v8.x/docs/api/buffer.html#buffer_buf_buffer
            stream.on('data', (data: Buffer | string) => {
                // The last chunk does not use the full buffer size. slice()
                // creates a copy, that's why we only do this when necessary.
                if (isString(data)) {
                    onDataEvents.dispatch(data as any);
                } else if (data.byteOffset !== 0 || data.byteLength < data.buffer.byteLength) {
                    onDataEvents.dispatch(
                        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as any
                    );
                } else {
                    onDataEvents.dispatch(data.buffer as any);
                }
            });
        } else {
            stream.on('data', (data: string | Buffer) => {
                if (isString(data)) {
                    onDataEvents.dispatch(data as any);
                } else {
                    onDataEvents.dispatch(data.toString(encoding) as any);
                }
            });
        }

        stream.resume();
    };

    // No need to close the underlying platform stream since "autoClose" is true by default
    stream.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
            streamTracker.reject(
                createError('SST-CR3', {
                    name: 'FileNotFoundError',
                    filename: hash,
                    type: STORAGE.OBJECTS
                })
            );
        } else {
            streamTracker.reject(createError('SST-CR4', err));
        }
    });

    // https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_event_end
    // The 'end' event is emitted when there is no more data to be consumed from the stream.
    // The 'end' event will not be emitted unless the data is completely consumed.
    stream.on('end', () => {
        streamTracker.resolve();
    });

    return {
        encoding: encoding as E,
        onData: onDataEvents.consumer,
        pause: () => {
            stream.pause();
        },
        resume: () => {
            stream.resume();
        },
        cancel: () => {
            stream.destroy(createError('SST-CR6'));
        },
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
    type?: StorageDirTypes
): SimpleWriteStream<undefined>;
export function createFileWriteStream(
    encoding: 'base64',
    filename: string,
    type?: StorageDirTypes
): SimpleWriteStream<'base64'>;
export function createFileWriteStream(
    encoding: 'utf8',
    filename: string,
    type?: StorageDirTypes
): SimpleWriteStream<'utf8'>;
export function createFileWriteStream(encoding: undefined | 'base64' | 'utf8'): SimpleWriteStream;
export function createFileWriteStream(
    encoding: undefined | 'base64' | 'utf8',
    filename: string,
    type?: StorageDirTypes
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

    // Generate a random name for the temporary file by creating a random number sequence of
    // bytes and converting it to a hex string (string length will be twice the number of
    // bytes).
    const tmpFile = createTempFileName();

    // By definition ONE saves everything using the crypto-hash over the entire buffer (or
    // string) as identifier. Which crypto hash function is used does not matter as long as
    // it is consistent.
    const cryptoHashObj = createHash('sha256');

    const stream = createWriteStream(join(getStorageDirForFileType(STORAGE.TMP), tmpFile), {
        encoding
    });
    const streamTracker = createTrackingPromise<FileCreation<E extends 'utf8' ? CLOB : BLOB>>();

    stream.once('error', (err: NodeJS.ErrnoException) => {
        // According to node.js 12.x API docs at
        // https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_event_error
        // > "The stream is not closed when the 'error' event is emitted."

        // destroy() is new since v8, and close() has been removed from the documentation. At
        // least right now (v8) destroy() calls close(), but we use the newer function.
        // Also see comment at https://github.com/nodejs/node/issues/2006#issuecomment-314070986

        stream.destroy();

        // Remove the temporary file and ignore errors occurring during that step - that error
        // would be secondary to the one we are already dealing with
        deleteFile(tmpFile, STORAGE.TMP)
            .finally(() => streamTracker.reject(err))
            // Promise failure is handled elsewhere, but we need to handle
            // rejections of the new Promise created by the finally() method
            .catch(_ => undefined);
    });

    function writeFn(data: string | ArrayBufferLike | Uint8Array): void {
        let buf: Buffer;

        if (isString(data)) {
            // This is a UTF-8 text file or a base64 encoded binary chunk
            if (encoding === undefined) {
                cancelFn().catch(_ => undefined);
                return streamTracker.reject(createError('SST-CW2'));
            }

            buf = Buffer.from(data, encoding);
        } else {
            if (encoding !== undefined) {
                cancelFn().catch(_ => undefined);
                return streamTracker.reject(createError('SST-CW3', {encoding}));
            }

            buf = Buffer.from(getArrayBuffer(data));
        }

        cryptoHashObj.update(buf);

        stream.write(buf);
    }

    function cancelFn(): Promise<void> {
        // Different points of view: For 3rd party listeners on the stream promise follow-up
        // errors don't matter, for them the cancellation of the stream itself is the error.
        streamTracker.reject(createError('SST-CAN'));

        return new Promise((resolve, reject) => {
            // This 'error' handler only is for the cancel() command's promise.
            stream.once('error', err => {
                reject(createError('SST-CAN1', err));
            });

            // Orderly end: Just finish with whatever we got thus far and then remove the
            // temporary stream file
            stream.end(() => {
                deleteFile(tmpFile, STORAGE.TMP)
                    .then(() => resolve())
                    .catch((err: Error) => {
                        reject(createError('SST-CAN2', err));
                    });
            });
        });
    }

    function endFn(): Promise<FileCreation<E extends 'utf8' ? CLOB : BLOB>> {
        return new Promise((resolve, reject) => {
            // This 'error' handler only is for the stream.end() command's promise.
            stream.once('error', (err: NodeJS.ErrnoException) => {
                reject(createError('SST-WEND', err));
            });

            // https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_event_finish
            // The 'finish' event is emitted after the stream.end() method has been called, and
            // all data has been flushed to the underlying system.
            stream.once('finish', () => {
                const hash = (
                    isString(filename) ? filename : cryptoHashObj.digest('hex')
                ) as SHA256Hash<E extends 'utf8' ? CLOB : BLOB>;

                moveFromTempToObjectSpace(tmpFile, hash, type)
                    .then(status => {
                        const result: FileCreation<E extends 'utf8' ? CLOB : BLOB> = {
                            hash,
                            status
                        };

                        // Tell 3rd party listeners of the stream promise
                        streamTracker.resolve(result);

                        // Tell caller of end()
                        resolve(result);
                    })
                    .catch((err: Error) => {
                        streamTracker.reject(err);
                        reject(err);
                    });
            });

            stream.end();
        });
    }

    return {
        write: writeFn,
        cancel: cancelFn,
        end: endFn,
        promise: streamTracker.promise
    };
}
