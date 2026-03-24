/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This file implements a set of functions that store secret keys in a key/value store. The key
 * of this store is the hash of a 'Keys' object (that holds the public keys) plus a suffix that
 * indicates if the stored secret key is an encryption key or a sign key.
 *
 * <hash>.encrypt
 * <hash>.sign
 *
 * The values of the key/value store are the secret encryption key and the secret sign key
 * encrypted with a master key.
 * @private
 * @module
 */

import type {SecretKey} from '../crypto/encryption.js';
import {ensureSecretKey} from '../crypto/encryption.js';
import type {SecretSignKey} from '../crypto/sign.js';
import {ensureSecretSignKey} from '../crypto/sign.js';
import type {Keys} from '../recipes.js';
import {STORAGE} from '../storage-base-common.js';
import {exists, readPrivateBinaryRaw, writePrivateBinaryRaw} from '../system/storage-base.js';
import type {SHA256Hash} from '../util/type-checks.js';
import type {MasterKeyManager} from './master-key-manager.js';

/**
 * Filename for a secret encryption key of a person.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @returns {string}
 */
function filenameForEncryptionKey(keysObjHash: SHA256Hash<Keys>): string {
    return `${keysObjHash}.encrypt`;
}

/**
 * Filename for a secret sign key of a person.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @returns {string}
 */
function filenameForSignKey(keysObjHash: SHA256Hash<Keys>): string {
    return `${keysObjHash}.sign`;
}

/**
 * Stores the secret keys encrypted with the master key in the private section of the OneDB.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @param {SecretKey} secretEncryptionKey
 * @param {SecretSignKey} secretSignKey
 * @param {MasterKeyManager} masterKeyManager
 * @returns {Promise<void>}
 */
export async function storeSecretKeys(
    keysObjHash: SHA256Hash<Keys>,
    secretEncryptionKey: SecretKey,
    secretSignKey: SecretSignKey,
    masterKeyManager: MasterKeyManager
): Promise<void> {
    await Promise.all([
        writePrivateBinaryRaw(
            filenameForEncryptionKey(keysObjHash),
            masterKeyManager.encryptDataWithMasterKey(secretEncryptionKey).buffer
        ),
        writePrivateBinaryRaw(
            filenameForSignKey(keysObjHash),
            masterKeyManager.encryptDataWithMasterKey(secretSignKey).buffer
        )
    ]);
}

/**
 * Get the secret keys belonging to a Keys object.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @param {MasterKeyManager} masterKeyManager
 * @returns {Promise<{secretEncryptionKey: SecretKey, secretSignKey: SecretSignKey}>}
 */
export async function getSecretKeys(
    keysObjHash: SHA256Hash<Keys>,
    masterKeyManager: MasterKeyManager
): Promise<{secretEncryptionKey: SecretKey; secretSignKey: SecretSignKey}> {
    const [encKey, signKey] = await Promise.all([
        await readPrivateBinaryRaw(filenameForEncryptionKey(keysObjHash)),
        await readPrivateBinaryRaw(filenameForSignKey(keysObjHash))
    ]);

    return {
        secretEncryptionKey: ensureSecretKey(
            masterKeyManager.decryptDataWithMasterKey(new Uint8Array(encKey))
        ),
        secretSignKey: ensureSecretSignKey(
            masterKeyManager.decryptDataWithMasterKey(new Uint8Array(signKey))
        )
    };
}

/**
 * Check whether we have secret keys for the passed keys object.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @returns {Promise<boolean>}
 */
export async function hasSecretKeys(keysObjHash: SHA256Hash<Keys>): Promise<boolean> {
    const [hasEncryptionKeyFile, hasSignKeyFile] = await Promise.all([
        exists(filenameForEncryptionKey(keysObjHash), STORAGE.PRIVATE),
        exists(filenameForSignKey(keysObjHash), STORAGE.PRIVATE)
    ]);

    return hasEncryptionKeyFile && hasSignKeyFile;
}
