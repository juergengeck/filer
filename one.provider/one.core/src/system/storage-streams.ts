/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/* eslint-disable @typescript-eslint/no-unused-vars, jsdoc/require-returns-check */

/**
 * @module
 */

import type {HashTypes} from '../recipes.js';
import type {SimpleReadStream, SimpleWriteStream, StorageDirTypes} from '../storage-base-common.js';
import {STORAGE} from '../storage-base-common.js';
import type {SHA256Hash} from '../util/type-checks.js';
import {ensurePlatformLoaded} from './platform.js';

type SstBrowser = typeof import('./browser/storage-streams.js');
type SstNode = typeof import('./nodejs/storage-streams.js');

// Needed because we have synchronous functions - we cannot use the promise's value for them
let SST: SstNode | SstBrowser;

export function setPlatformForSst(exports: SstBrowser | SstNode): void {
    SST = exports;
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
 * The stream starts automatically as soon as the data event handler function has been added.
 * You can get the positive or negative (error) result from the stream promise at any later time.
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
 * - undefined: binary stream (ArrayBuffer) (not available on React Native)
 * - 'base64': base64 encoded binary stream
 *
 * For ONE objects and CLOBs:
 * - 'utf8': UTF-8 string stream of UTF-8 contents
 * @throws {Error} Throws a synchronous `Error` if no filename is given
 * @throws {Error} Rejects with an Error whose name property is set to `FileNotFoundError` if the
 * file cannot be found
 * @returns {SimpleReadStream} Returns a system-dependent readable stream.
 */
export function createFileReadStream<E extends undefined | 'base64' | 'utf8'>(
    hash: SHA256Hash<HashTypes>,
    encoding?: E
): SimpleReadStream<E> {
    ensurePlatformLoaded();
    return SST.createFileReadStream(hash, encoding) as SimpleReadStream<E>;
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

/**
 * Have a look at the description of the {@link SimpleWriteStream} object returned by the method.
 * @static
 * @param {('base64'|'utf8')} [encoding=undefined] - 'utf8' for text file streams or 'base64' for
 * base64 encoded string streams, `undefined` for binary streams
 * @param {string} [filename]
 * @param {StorageDirTypes} [type='objects']
 * @returns {SimpleWriteStream} Returns a simple platform-independent writable stream.
 */
export function createFileWriteStream<E extends undefined | 'base64' | 'utf8'>(
    encoding?: E,
    filename?: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): SimpleWriteStream<E> {
    ensurePlatformLoaded();
    return SST.createFileWriteStream(encoding, filename, type);
}
