import tweetnacl from 'tweetnacl';
import {addPadding, removePadding} from './padding.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    hexToUint8Array,
    isHexString,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

const secretBoxZeroNonce = new Uint8Array(tweetnacl.secretbox.nonceLength);
const boxZeroNonce = new Uint8Array(tweetnacl.box.nonceLength);

/**
 * This recovery information is shared encrypted with the recovery service.
 *
 * Only the recovery service can unpack this with his key.
 */
export type RecoveryInformation = {
    identity: string;
    symmetricKey: HexString;
};

/**
 * Check if data is of type RecoveryInformation
 *
 * @param data
 */
export function isRecoveryInformation(data: any): data is RecoveryInformation {
    return (
        typeof data.identity === 'string' &&
        typeof data.symmetricKey === 'string' &&
        isHexString(data.symmetricKey)
    );
}

/**
 * This is the wrapper used to transmit the encrypted recovery information and the public key
 * used to derive the symmetric key that was used for the encryption.
 */
export type BundledEncryptedRecoveryInformation = {
    encryptedRecoveryInformation: HexString;
    encryptionPublicKey: HexString;
};

/**
 * Check if data is of type BundledEncryptedRecoveryInformation
 *
 * @param data
 */
export function isBundledEncryptedRecoveryInformation(
    data: any
): data is BundledEncryptedRecoveryInformation {
    return (
        typeof data.encryptedRecoveryInformation === 'string' &&
        isHexString(data.encryptedRecoveryInformation) &&
        typeof data.encryptionPublicKey === 'string' &&
        isHexString(data.encryptionPublicKey)
    );
}

/**
 * Create the recovery Information.
 *
 * This encrypts the secret with a newly generated symmetric key. This key is then encrypted
 * along with identifying properties so that only the owner of the secret part matching the
 * recoveryServicePublicKey can decrypt it.
 *
 * @param recoveryServicePublicKey - The public key used to encrypt the key that can be used to
 * decrypt the original secret.
 * @param secret - The secret to encrypt.
 * @param identity - The identity string that is bundled with the key, so that the recovery
 * service know which person should be allowed to receive the decryption key for the original
 * secret.
 * @param encryptedSecretSize - The final size of the encrypted secret. This limits the length
 * of the secret to (encryptedSecretSize - 1). This is needed, so that you cannot retrieve the
 * length of the original secret from the length of the encrypted payload.
 * @param bundledEncryptedRecoveryInformationSize - The final size of the encrypted recovery
 * information. This limits the length of identity to approx
 * (bundledEncryptedRecoveryInformationSize - 50). This is needed, so that you cannot retrieve
 * the length of the identity field from the length of the encrypted payload.
 * @returns An encrypted secret that should be stored locally. The bundled recovery information
 * that should be sent to the recovery server when the secret was forgotten.
 */
export function createRecoveryInformation(
    recoveryServicePublicKey: Uint8Array,
    secret: Uint8Array | string,
    identity: string,
    encryptedSecretSize = 1024,
    bundledEncryptedRecoveryInformationSize = 1024
): {
    encryptedSecret: HexString;
    bundledEncryptedRecoveryInformation: BundledEncryptedRecoveryInformation;
} {
    if (typeof secret === 'string') {
        secret = new TextEncoder().encode(secret);
    }

    // Step 1: Encrypt secret with random symmetric key.
    const symmetricKey = tweetnacl.randomBytes(tweetnacl.box.sharedKeyLength);
    const encryptedRecoverySecret = tweetnacl.secretbox(
        addPadding(secret, encryptedSecretSize),
        secretBoxZeroNonce,
        symmetricKey
    );

    // Step 2: Encrypt random symmetric key + identity with derived symmetric key
    // Key is derived from random secret key and public recovery service key
    const tempKeys = tweetnacl.box.keyPair();
    const recoveryInformation: RecoveryInformation = {
        identity: identity,
        symmetricKey: uint8arrayToHexString(symmetricKey)
    };
    const encryptedRecoveryInformation = tweetnacl.box(
        addPadding(
            new TextEncoder().encode(JSON.stringify(recoveryInformation)),
            bundledEncryptedRecoveryInformationSize
        ),
        boxZeroNonce,
        recoveryServicePublicKey,
        tempKeys.secretKey
    );

    // Step 3: Bundle random public key with encrypted payload
    const bundledRecoveryInformation: BundledEncryptedRecoveryInformation = {
        encryptedRecoveryInformation: uint8arrayToHexString(encryptedRecoveryInformation),
        encryptionPublicKey: uint8arrayToHexString(tempKeys.publicKey)
    };

    // Return the
    // - encrypted secret that stays on the local machine
    // - the bundled recovery recovery information that can only be decrypted by the recovery
    // service
    return {
        encryptedSecret: uint8arrayToHexString(encryptedRecoverySecret),
        bundledEncryptedRecoveryInformation: bundledRecoveryInformation
    };
}

/**
 * Unpack the recovery information by decrypting it.
 *
 * This can only be done when you have the secret key matching the public key that was used in
 * createRecoveryInformation call.
 *
 * @param recoveryServiceSecretKey - The corresponding secret key to the
 * recoveryServicePublicKey used in createRecoveryInformation.
 * @param bundledEncryptedRecoveryInformation - The recovery information.
 */
export function unpackRecoveryInformation(
    recoveryServiceSecretKey: Uint8Array,
    bundledEncryptedRecoveryInformation: BundledEncryptedRecoveryInformation
): RecoveryInformation {
    const decryptedRecoveryInformation = tweetnacl.box.open(
        hexToUint8Array(bundledEncryptedRecoveryInformation.encryptedRecoveryInformation),
        boxZeroNonce,
        hexToUint8Array(bundledEncryptedRecoveryInformation.encryptionPublicKey),
        recoveryServiceSecretKey
    );

    if (decryptedRecoveryInformation === null) {
        throw new Error('Decryption of recovery information failed.');
    }

    const recoveryInformation = JSON.parse(
        new TextDecoder().decode(removePadding(decryptedRecoveryInformation))
    );

    if (!isRecoveryInformation(recoveryInformation)) {
        throw new Error('The recovery information has the wrong data format.');
    }
    return recoveryInformation;
}

/**
 * Restores the secret with the help of the symmetric key that was received by the recovery service.
 *
 * @param encryptedSecret - The encrypted secret that was returned by the
 * createRecoveryInformation function and stored locally.
 * @param symmetricKey - The symmetric key you received from the recovery service.
 */
export function recoverSecret(encryptedSecret: HexString, symmetricKey: HexString): Uint8Array {
    const decrypted = tweetnacl.secretbox.open(
        hexToUint8Array(encryptedSecret),
        secretBoxZeroNonce,
        hexToUint8Array(symmetricKey)
    );

    if (decrypted === null) {
        throw new Error('Decryption of secret failed.');
    }

    return removePadding(decrypted);
}

/**
 * Convenience function for restoreSecret that returns the secret as string.
 *
 * You may use this information when you passed the secret as string in the
 * createRecoveryinformation function.
 * @param encryptedSecret - The encrypted secret that was returned by the
 * createRecoveryInformation function and stored locally.
 * @param symmetricKey - The symmetric key you received from the recovery service.
 */
export function recoverSecretAsString(encryptedSecret: HexString, symmetricKey: HexString): string {
    return new TextDecoder().decode(recoverSecret(encryptedSecret, symmetricKey));
}
