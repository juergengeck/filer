/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {CryptoApi} from '../crypto/CryptoApi.js';
import type {KeyPair} from '../crypto/encryption.js';
import type {SignKeyPair} from '../crypto/sign.js';
import type {Instance, Keys, Person} from '../recipes.js';
import type {UnversionedObjectResult} from '../storage-unversioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';
import {getPublicKeys, storePublicKeys} from './key-storage-public.js';
import {getSecretKeys, storeSecretKeys} from './key-storage-secret.js';
import type {MasterKeyManager} from './master-key-manager.js';

/**
 * Store the passed key pairs in the key storage.
 *
 * The public keys will be stores as 'Keys' object, the secret keys will be stored in the
 * 'private' section of the OneDB.
 *
 * @param {SHA256IdHash<Person>} owner
 * @param {KeyPair} encryptionKeyPair
 * @param {KeyPair} signKeyPair
 * @param {MasterKeyManager} masterKeyManager
 * @returns {Promise<void>}
 */
export async function storeKeys(
    owner: SHA256IdHash<Person | Instance>,
    encryptionKeyPair: KeyPair,
    signKeyPair: SignKeyPair,
    masterKeyManager: MasterKeyManager
): Promise<UnversionedObjectResult<Keys>> {
    const keysObjectResult = await storePublicKeys(
        owner,
        encryptionKeyPair.publicKey,
        signKeyPair.publicKey
    );

    await storeSecretKeys(
        keysObjectResult.hash,
        encryptionKeyPair.secretKey,
        signKeyPair.secretKey,
        masterKeyManager
    );

    return keysObjectResult;
}

// /**
//  * Create a new random set of keys for the specified owner.
//  *
//  * @param {SHA256IdHash<Person | Instance>} owner
//  * @param {MasterKeyManager} masterKeyManager
//  * @returns {Promise<UnversionedObjectResult<Keys>>}
//  */
// export async function storeNewRandomKeys(
//     owner: SHA256IdHash<Person | Instance>,
//     masterKeyManager: MasterKeyManager
// ): Promise<UnversionedObjectResult<Keys>> {
//     return storeKeys(owner, createKeyPair(), createSignKeyPair(), masterKeyManager);
// }

/**
 * Get the person encryption and sign key-pairs.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @param {MasterKeyManager} masterKeyManager
 * @returns {Promise<{encryptionKeyPair: KeyPair, signKeyPair: SignKeyPair}>}
 */
export async function getKeyPairs(
    keysObjHash: SHA256Hash<Keys>,
    masterKeyManager: MasterKeyManager
): Promise<{
    encryptionKeyPair: KeyPair;
    signKeyPair: SignKeyPair;
}> {
    const secretKeys = await getSecretKeys(keysObjHash, masterKeyManager);
    const publicKeys = await getPublicKeys(keysObjHash);
    return {
        encryptionKeyPair: {
            publicKey: publicKeys.publicEncryptionKey,
            secretKey: secretKeys.secretEncryptionKey
        },
        signKeyPair: {
            publicKey: publicKeys.publicSignKey,
            secretKey: secretKeys.secretSignKey
        }
    };
}

/**
 * @param {SHA256Hash<Keys>} keys
 * @param {MasterKeyManager} masterKeyManager
 * @returns {Promise<CryptoApi>}
 */
export async function createCryptoApi(
    keys: SHA256Hash<Keys>,
    masterKeyManager: MasterKeyManager
): Promise<CryptoApi> {
    const keyPairs = await getKeyPairs(keys, masterKeyManager);
    return new CryptoApi(keyPairs.encryptionKeyPair, keyPairs.signKeyPair);
}
