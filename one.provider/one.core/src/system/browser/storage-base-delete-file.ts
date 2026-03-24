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

import {createError} from '../../errors.js';
import type {StorageDirTypes} from '../../storage-base-common.js';
import {STORAGE} from '../../storage-base-common.js';
import {getDbInstance, shouldBeEncrypted} from './storage-base.js';
import {encryptKey} from './storage-crypto.js';

/**
 * This method removes an entry from the IndexedDB database. If the key does not exist, nothing
 * happens, no error is thrown.
 *
 * **Note:** There will be no error if the file to be deleted does not exist to begin with.
 * @internal
 * @static
 * @param {string} filename - The key to be deleted from the database
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<undefined>} Returns a promise that resolves with `undefined`.
 * @throws {Error} Throws an `Error` if no filename is given of the IndexedDB database
 * has not yet been initialized
 */
export function deleteFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<void> {
    return new Promise((resolve, reject) => {
        if (filename === undefined) {
            throw createError('SBD-DEL1', {type});
        }

        const transaction = getDbInstance().transaction(type, 'readwrite');

        // Note: IndexedDB transactions are not safe, i.e. when we get this event the contents
        // may not be on the disk yet. At this point the browser told the OS to write the data
        // but there is no guarantee it actually happened.
        transaction.oncomplete = () => resolve();

        const objectStore = transaction.objectStore(type);

        // According to https://stackoverflow.com/a/14636293/544779 there will be no error if
        // the key does not exist - which is what we want.
        const request = objectStore.delete(
            shouldBeEncrypted(type) ? encryptKey(filename) : filename
        );

        request.onerror = () => reject(createError('SBD-DEL2', request.error));

        // Unused, because the delete-operation is not final yet, only  transaction completion is
        // the sign of completion.
        // request.onsuccess = event => {};
    });
}
