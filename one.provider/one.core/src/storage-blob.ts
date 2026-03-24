/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module contains functions that help with BLOBs. Normally BLOBs are written and read
 * using streams, but sometimes you want to get the full BLOB into an Buffer or a
 * Base64-encoded string.
 * @module
 */

/*
 * Implementation Detail
 *
 * These functions are in an extra module to avoid a circular dependency of imports if we put it
 * into storage-base-common. They do not belong into one of the storage related files in the
 * system folder because they are system-independent, by relying on the in turn system-dependent
 *  storage-stream module(s).
 */

import {createError} from './errors.js';
import type {BLOB, CLOB, OneObjectTypes} from './recipes.js';
import type {FileCreation} from './storage-base-common.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {writeUTF8TextFile} from './system/storage-base.js';
import {createFileReadStream, createFileWriteStream} from './system/storage-streams.js';
import {getArrayBuffer, getUint8Array} from './util/buffer.js';
import {logCall} from './util/object-io-statistics.js';
import type {SHA256Hash} from './util/type-checks.js';

/**
 * Concatenate an array of `Buffer` into a single `Buffer`.
 * @static
 * @param {Array<ArrayBufferLike | Uint8Array>} buffers
 * @returns {ArrayBuffer} Returns an `ArrayBuffer`
 */
export function concatenateArrayBuffers(buffers: Array<ArrayBufferLike | Uint8Array>): ArrayBuffer {
    let totalLength = 0;

    for (const arr of buffers) {
        totalLength += arr.byteLength;
    }

    const result = new Uint8Array(totalLength);

    let offset = 0;

    for (const arr of buffers) {
        if (arr instanceof Uint8Array) {
            result.set(arr, offset);
        } else {
            result.set(new Uint8Array(arr), offset);
        }
        offset += arr.byteLength;
    }

    return result.buffer;
}

/**
 * Concatenate an array of `Uint8Array` into a single `Uint8Array`.
 * @static
 * @param {Array<Uint8Array>} buffers
 * @returns {Uint8Array} Returns a `Uint8Array`
 */
export function concatenateUint8Arrays(buffers: Uint8Array[]): Uint8Array {
    let totalLength = 0;

    for (const arr of buffers) {
        totalLength += arr.byteLength;
    }

    const result = new Uint8Array(totalLength);

    let offset = 0;

    for (const arr of buffers) {
        if (arr instanceof Uint8Array) {
            result.set(arr, offset);
        } else {
            result.set(new Uint8Array(arr), offset);
        }
        offset += arr.byteLength;
    }

    return result;
}

/**
 * Reads a binary file in object storage in its entirety and returns it as `ArrayBuffer`.
 * There is an equivalent write function `storeArrayBufferAsBlob` on {@link WriteStorageApi}
 * objects.
 * @static
 * @param {SHA256Hash} hash
 * @returns {Promise<ArrayBuffer>} Returns an `ArrayBuffer`
 */
export async function readBlobAsArrayBuffer(hash: SHA256Hash<BLOB>): Promise<ArrayBuffer> {
    logCall('readBlobAsArrayBuffer', 'BLOB');

    const stream = createFileReadStream(hash);

    const blobData: Array<ArrayBufferLike | Uint8Array> = [];

    stream.onData.addListener(data => {
        blobData.push(data);
    });

    await stream.promise;

    return concatenateArrayBuffers(blobData);
}

/**
 * Reads a binary file in object storage in its entirety and returns it as `Uint8Array`.
 * @static
 * @param {SHA256Hash} hash
 * @returns {Promise<Uint8Array>} Returns a `Uint8Array`
 */
export async function readBlobAsUint8Array(hash: SHA256Hash<BLOB>): Promise<Uint8Array> {
    logCall('readBlobAsUint8Array', 'BLOB');

    const stream = createFileReadStream(hash);

    const blobData: Uint8Array[] = [];

    stream.onData.addListener(data => {
        blobData.push(getUint8Array(data));
    });

    await stream.promise;

    return concatenateUint8Arrays(blobData);
}

/**
 * Reads a binary file in object storage in its entirety and returns it as Base64 encoded string.
 * There is an equivalent write function `storeBase64StringAsBlob` on {@link WriteStorageApi}
 * objects.
 * @static
 * @param {SHA256Hash} hash
 * @returns {Promise<string>} Returns a Base64 encoded string
 */
export async function readBlobAsBase64(hash: SHA256Hash<BLOB>): Promise<string> {
    logCall('readBlobAsBase64', 'BLOB');

    const stream = createFileReadStream(hash, 'base64');

    const data: string[] = [];

    stream.onData.addListener(chunk => {
        data.push(chunk);
    });

    await stream.promise;

    return data.join('');
}

/**
 * Writes an ArrayBuffer or Uint8Array to a file in object storage.
 * @static
 * @param {ArrayBufferLike | Uint8Array} arrayBuffer
 * @returns {Promise<FileCreation>} Returns a promise that resolves with a {@link FileCreation}
 */
export function storeArrayBufferAsBlob(
    arrayBuffer: ArrayBufferLike | Uint8Array
): Promise<FileCreation<BLOB>> {
    logCall('storeArrayBufferAsBlob', 'BLOB');

    const stream = createFileWriteStream();
    stream.write(getArrayBuffer(arrayBuffer));
    return stream.end();
}

/**
 * Writes a Base64 string to a file in object storage.
 * @static
 * @param {string} base64Str
 * @returns {Promise<FileCreation>} Returns a promise that resolves with a {@link FileCreation}
 */
export function storeBase64StringAsBlob(base64Str: string): Promise<FileCreation<BLOB>> {
    logCall('storeBase64StringAsBlob', 'BLOB');

    const stream = createFileWriteStream('base64');
    stream.write(base64Str);
    return stream.end();
}

/**
 * The string will be stored under the name resulting from calculation of a crypto-hash over the
 * string.
 *
 * This function is safe to be used in multistep asynchronous writing operations: It only
 * writes to files using their contents' SHA-256 as filename. That means even if, as part
 * of a parent function, we have a pattern of 1) read file, 2) process, 3) write file it is not
 * possible to lose anything.
 *
 * **This function is not atomic.** Its two steps of creating the SHA-256 hash and of storing
 * the string are independent "await"-ed asynchronous operations, another store operation could
 * take place in between, if scheduled.
 * @static
 * @async
 * @param {string} str - A UTF-8 string
 * @returns {Promise<FileCreation>} A promise with the result of the object creation.
 */
export async function storeUTF8Clob<T extends OneObjectTypes | CLOB = CLOB>(
    str: string
): Promise<FileCreation<T>> {
    if (str === undefined || str.length === 0) {
        throw createError('SB-STORE');
    }

    logCall('storeUTF8Clob', 'CLOB');

    const hash = await createCryptoHash<T>(str);
    const status = await writeUTF8TextFile(str, hash);

    return {
        hash,
        status
    };
}
