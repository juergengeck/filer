/* eslint-disable no-await-in-loop */
/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import {createError} from './errors.js';
import type {InstanceOptions} from './instance.js';
import {closeInstance, getInstanceIdHash, initInstance} from './instance.js';
import {changeKeyChainSecret} from './keychain/keychain.js';
import {changeStoragePassword} from './system/storage-base.js';
import {isString} from './util/type-checks-basic.js';

/**
 * For all secret key in hex string format stored encrypted with a key derived from a secret and
 * stored in the "private" storage area:
 * - Use the given old password to read and decrypt the secret keys
 * - Store a copy of the secret-key file with the same name and the extension .bak
 * - Encrypt the secret key with a key derived from the new secret
 * - Store the new encrypted secret-key in place of the old one
 * - When all keys are re-encrypted, remove all the .bak files that were created.
 * @static
 * @async
 * @param {InstanceOptions} instanceOptions - The same options that one would use to start the
 * instance for which the password will be changed.
 * @param {string} newSecret
 * @returns {Promise<void>}
 */
export async function changePassword(
    instanceOptions: InstanceOptions,
    newSecret: string
): Promise<void> {
    if (!isString(instanceOptions.secret) || instanceOptions.secret === null) {
        throw createError('IC-CPW1');
    }

    if (!isString(newSecret)) {
        throw createError('IC-CPW2');
    }

    // Either the instance for which the password needs to be changed is active or not. If it is
    // we can proceed, if not the instance needs to be started so that storage operations for
    // reverse map lookups and "private" storage space reads and writes for the encrypted key
    // files are usable.
    const temporarilyStartInstance = getInstanceIdHash() === undefined;

    if (temporarilyStartInstance) {
        await initInstance(instanceOptions);
    }

    const instanceIdHash = getInstanceIdHash();

    if (instanceIdHash === undefined) {
        throw createError('IC-CPW3');
    }

    await changeKeyChainSecret(instanceOptions.secret, newSecret);
    await changeStoragePassword(instanceOptions.secret, newSecret);

    if (temporarilyStartInstance) {
        closeInstance();
    }
}
