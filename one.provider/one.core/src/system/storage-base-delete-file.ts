/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The delete function is in its own module to underline the exceptional nature of removing
 * files from ONE.
 * @module
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type {StorageDirTypes} from '../storage-base-common.js';
import {STORAGE} from '../storage-base-common.js';
import {ensurePlatformLoaded} from './platform.js';

type SbdfBrowser = typeof import('./browser/storage-base-delete-file.js');
type SbdfNode = typeof import('./nodejs/storage-base-delete-file.js');

let SBDF: SbdfBrowser | SbdfNode;

export function setPlatformForSbdf(exports: SbdfBrowser | SbdfNode): void {
    SBDF = exports;
}

/**
 * This method removes an entry from storage. If the key does not exist, nothing happens, no
 * error is thrown.
 *
 * **Note:** There will be no error if the file to be deleted does not exist to begin with.
 * @static
 * @async
 * @param {string} filename - The filename to be deleted
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<undefined>} Returns a promise that resolves with `undefined`.
 * @throws {Error} Throws an `Error` if no filename is given
 */
export function deleteFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<void> {
    ensurePlatformLoaded();
    return SBDF.deleteFile(filename, type);
}
