/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The delete function is in its own module to underline the exceptional nature of removing
 * files from ONE.
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
 * 2. We also need to throw a createError(err) to get the stack trace. The one we get from node.js
 *    does not have it. Our createError() method always creates a createError.
 */

import {unlink} from 'fs/promises';
import {join} from 'path';

import {createError} from '../../errors.js';
import type {StorageDirTypes} from '../../storage-base-common.js';
import {STORAGE} from '../../storage-base-common.js';
import {getStorageDirForFileType} from './storage-base.js';

/**
 * This method removes a file from storage. If the file does not exist, nothing happens, no error
 * is thrown.
 * @internal
 * @static
 * @param {string} filename - The name of the file to be deleted
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<undefined>} Returns a promise that resolves with `undefined`.
 * @throws {Error} Throws an `Error` if no filename is given
 */
export async function deleteFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<void> {
    if (filename === undefined) {
        throw createError('SBD-DEL1', {type});
    }

    const fileWithPath = join(getStorageDirForFileType(type), filename);

    await unlink(fileWithPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
            throw createError('SBD-DEL2', err);
        }
    });
}
