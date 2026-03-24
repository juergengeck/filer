/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import type {PublicKey} from '../crypto/encryption.js';
import {ensurePublicKey} from '../crypto/encryption.js';
import type {PublicSignKey} from '../crypto/sign.js';
import {ensurePublicSignKey} from '../crypto/sign.js';
import type {Instance, Keys, Person} from '../recipes.js';
import type {UnversionedObjectResult} from '../storage-unversioned-objects.js';
import {getObject, storeUnversionedObject} from '../storage-unversioned-objects.js';
import {
    hexToUint8Array,
    uint8arrayToHexString
} from '../util/arraybuffer-to-and-from-hex-string.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';

/**
 * Stores the public part of the keys.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @param {PublicKey} publicEncryptionKey
 * @param {PublicSignKey} publicSignKey
 * @returns {Promise<UnversionedObjectResult<Keys>>}
 */
export async function storePublicKeys(
    owner: SHA256IdHash<Person | Instance>,
    publicEncryptionKey: PublicKey,
    publicSignKey: PublicSignKey
): Promise<UnversionedObjectResult<Keys>> {
    return storeUnversionedObject({
        $type$: 'Keys',
        owner: owner,
        publicKey: uint8arrayToHexString(publicEncryptionKey),
        publicSignKey: uint8arrayToHexString(publicSignKey)
    });
}

/**
 * Get the public keys from the Keys object.
 *
 * @param {SHA256Hash<Keys>} keysObjHash
 * @returns {Promise<{publicEncryptionKey: PublicKey, publicSignKey: PublicSignKey}>}
 */
export async function getPublicKeys(
    keysObjHash: SHA256Hash<Keys>
): Promise<{publicEncryptionKey: PublicKey; publicSignKey: PublicSignKey}> {
    const keysObj = await getObject(keysObjHash);

    return {
        publicEncryptionKey: ensurePublicKey(hexToUint8Array(keysObj.publicKey)),
        publicSignKey: ensurePublicSignKey(hexToUint8Array(keysObj.publicSignKey))
    };
}
