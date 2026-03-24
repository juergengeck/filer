/**
 * This file provides a collection of low level functions for encryption.
 *
 * Usually you won't use those directly, because you don't have access to the private keys.
 *
 * Everything is build on-top of tweetnacl. So you need to be familiar with how tweetnacl works in
 * order to use this safely. Symmetric encryption is done with tweetnacl.secretbox and asymmetric
 * encryption (attention: not asymmetric in the RSA sense) with tweetnacl.box.
 *
 * At the time of writing this, the 'tweetnacl.box' encryption had two steps:
 * 1) Derive symmetric key from asymmetric keys
 * 2) Use the symmetric key for encryption with 'tweetnacl.secretbox'
 *
 * Therefore, the nonce generation, nonce lengths are the same for symmetric and asymmetric
 * functions.
 *
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import tweetnacl from 'tweetnacl';
import {createError} from '../errors.js';
import {deriveBinaryKey} from '../system/crypto-scrypt.js';
import {getUint8Array} from '../util/buffer.js';

export type Nonce = Uint8Array & {_: 'nonce'};
export type Salt = Uint8Array & {_: 'salt'};
export type SymmetricKey = Uint8Array & {_: 'symmetricKey'};
export type PublicKey = Uint8Array & {_: 'publicKey'};
export type SecretKey = Uint8Array & {_: 'secretKey'};
export interface KeyPair {
    publicKey: PublicKey;
    secretKey: SecretKey;
}

const MINIMUM_SAFE_SALT_LENGTH_IN_BYTES = 16;

// ######## create* functions ########

/**
 * Create a random nonce that can be used for all functions in this file.
 *
 * @returns {Nonce}
 */
export function createRandomNonce(): Nonce {
    return tweetnacl.randomBytes(tweetnacl.secretbox.nonceLength) as Nonce;
}

/**
 * Create a random symmetric key.
 *
 * @returns {SymmetricKey}
 */
export function createSymmetricKey(): SymmetricKey {
    return tweetnacl.randomBytes(tweetnacl.secretbox.keyLength) as SymmetricKey;
}

/**
 * Create a new public/secret keypair.
 *
 * @returns {KeyPair}
 */
export function createKeyPair(): KeyPair {
    const keyPair = tweetnacl.box.keyPair();
    return {
        publicKey: keyPair.publicKey as PublicKey,
        secretKey: keyPair.secretKey as SecretKey
    };
}

/**
 * Create a suitable salt for the key derivation function in deriveSymmetricKeyFromSecret.
 *
 * @param {number} n - Length of salt in bytes. The requirement of the salt is to be unique over all
 * usages to prevent certain attacks that rely on precomputed values. The current consensus seems
 * to be that 16 bytes (128 bit) should be enough. Some sources say it shouldn't be less than
 * this value, so as default we use 16 bytes.
 * @returns {Salt}
 */
export function createRandomSalt(n: number = 16): Salt {
    return ensureSalt(tweetnacl.randomBytes(n));
}

// ######## ensure* functions ########

/**
 * Ensure that it is a public key by comparing the length of the data.
 *
 * Note that we cannot really check that it is a public key, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the public key in it.
 * @returns {SymmetricKey}
 */
export function ensureSymmetricKey(data: Uint8Array | ArrayBufferLike): SymmetricKey {
    if (data.byteLength !== tweetnacl.secretbox.keyLength) {
        throw createError('CYENC-ENSSYM');
    }

    return data as SymmetricKey;
}

/**
 * Ensure that it is a secret key by comparing the length of the data.
 *
 * Note that we cannot really check that it is a secret key, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the secret key in it.
 * @returns {SecretKey}
 */
export function ensureSecretKey(data: Uint8Array | ArrayBufferLike): SecretKey {
    if (data.byteLength !== tweetnacl.box.secretKeyLength) {
        throw createError('CYENC-ENSSEC');
    }

    return data as SecretKey;
}

/**
 * Ensure that it is a public key by comparing the length of the data.
 *
 * Note that we cannot really check that it is a public key, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the public key in it.
 * @returns {PublicKey}
 */
export function ensurePublicKey(data: Uint8Array | ArrayBufferLike): PublicKey {
    if (data.byteLength !== tweetnacl.box.publicKeyLength) {
        throw createError('CYENC-ENSPUB');
    }

    return data as PublicKey;
}

/**
 * Ensure that it is a nonce by comparing the length of the data.
 *
 * Note that we cannot really check that it is a nonce, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the nonce in it.
 * @returns {Nonce}
 */
export function ensureNonce(data: Uint8Array | ArrayBufferLike): Nonce {
    if (data.byteLength !== tweetnacl.secretbox.nonceLength) {
        throw createError('CYENC-ENSNCE');
    }

    return data as Nonce;
}

/**
 * Ensure that it is a suitable salt by ensuring that it is longer than a safe threshold.
 *
 * Note that we cannot really check that it is a salt, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the nonce in it.
 * @returns {Salt}
 */
export function ensureSalt(data: Uint8Array | ArrayBufferLike): Salt {
    if (data.byteLength < MINIMUM_SAFE_SALT_LENGTH_IN_BYTES) {
        throw createError('CYENC-ENSSLT');
    }

    return data as Salt;
}

// ######## symmetric key derivation functions ########

/**
 * Derive a symmetric key pair from the public key of somebody else and your own private key.
 *
 * @param {SecretKey} mySecretKey - My own secret key
 * @param {PublicKey} otherPublicKey - The others public key
 * @returns {SymmetricKey}
 */
export function deriveSymmetricKeyFromKeypair(
    mySecretKey: SecretKey,
    otherPublicKey: PublicKey
): SymmetricKey {
    return tweetnacl.box.before(otherPublicKey, mySecretKey) as SymmetricKey;
}

/**
 * Derive a symmetric key from a password.
 *
 * @param {string} secret
 * @param {Salt} salt
 * @returns {Promise<SymmetricKey>}
 */
export async function deriveSymmetricKeyFromSecret(
    secret: string,
    salt: Salt
): Promise<SymmetricKey> {
    return (await deriveBinaryKey(secret, salt, tweetnacl.secretbox.keyLength)) as SymmetricKey;
}

// ######## symmetric encryption functions (tweetnacl.secretbox) ########

/**
 * Encrypt data with a symmetric key.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data to encrypt
 * @param {SymmetricKey} symmetricKey - The key used for encryption
 * @param {Nonce} nonce - The nonce to use for encryption
 * @returns {Uint8Array} - Encrypted data
 */
export function symmetricEncrypt(
    data: Uint8Array | ArrayBufferLike,
    symmetricKey: SymmetricKey,
    nonce: Nonce
): Uint8Array {
    return tweetnacl.secretbox(getUint8Array(data), nonce, symmetricKey);
}

/**
 * Encrypt data and store the nonce along the cypher in the result.
 *
 * Storing the nonce along the cypher has the advantage, that you don't have to remember the
 * nonce for decryption later.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data to encrypt
 * @param {SymmetricKey} symmetricKey - The key used for encryption
 * @param {Nonce} nonce - The nonce to use for encryption and embedding. If not specified, then
 * create a random nonce.
 * @returns {Uint8Array} - Nonce concatenated with the cypher
 */
export function symmetricEncryptAndEmbedNonce(
    data: Uint8Array | ArrayBufferLike,
    symmetricKey: SymmetricKey,
    nonce: Nonce = createRandomNonce()
): Uint8Array {
    const cypher = symmetricEncrypt(data, symmetricKey, nonce);

    // Write the nonce and key into a single array
    const nonceAndCypher = new Uint8Array(tweetnacl.box.nonceLength + cypher.byteLength);
    nonceAndCypher.set(nonce, 0);
    nonceAndCypher.set(cypher, nonce.byteLength);

    return nonceAndCypher;
}

/**
 * Decrypt encrypted data.
 *
 * @param {Uint8Array | ArrayBufferLike} cypher - The encrypted data
 * @param {SymmetricKey} symmetricKey - The key used for decryption (must be the same that was
 * used for decryption)
 * @param {Nonce} nonce - The same nonce for decryption (must be the same that was used for
 * decryption)
 * @returns {Uint8Array} - Decrypted data
 */
export function symmetricDecrypt(
    cypher: Uint8Array | ArrayBufferLike,
    symmetricKey: SymmetricKey,
    nonce: Nonce
): Uint8Array {
    const data = tweetnacl.secretbox.open(getUint8Array(cypher), nonce, symmetricKey);

    if (data === null) {
        throw createError('CYENC-SYMDEC');
    }

    return data;
}

/**
 * Decrypt encrypted data.
 *
 * Since the nonce is embedded in the cypher there is no need to specify it.
 *
 * @param {Uint8Array | ArrayBufferLike} cypherAndNonce - cypher with embedded nonce that was generated by using
 * '[symmetric]EncryptAndEmbedNonce'
 * @param {SymmetricKey} symmetricKey - The key used for decryption (must be the same that was
 * used for decryption)
 * @returns {Uint8Array} - Decrypted data
 */
export function symmetricDecryptWithEmbeddedNonce(
    cypherAndNonce: Uint8Array | ArrayBufferLike,
    symmetricKey: SymmetricKey
): Uint8Array {
    const nonce = cypherAndNonce.slice(0, tweetnacl.secretbox.nonceLength) as Nonce;
    const cypher = cypherAndNonce.slice(tweetnacl.secretbox.nonceLength);
    return symmetricDecrypt(cypher, symmetricKey, nonce);
}

// ######## encryption functions (tweetnacl.box) ########

/**
 * Encrypt data with a symmetric key derived from a public key of someone else and my own secret
 * key.
 *
 * When you have two key pairs 'myKeypair' and 'otherKeypair', then the symmetric key used for
 * encryption will be the same for (myKeypair.secretKey, otherKeyPair.publicKey) and
 * (myKeypair.publicKey, otherKeyPair.secretKey). That's how two communication partners can
 * encrypt / decrypt the same steam, because they can derive the same symmetric key, without
 * having the same secret key.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data to encrypt
 * @param {SecretKey} mySecretKey - My own secret key
 * @param {PublicKey} otherPublicKey - The others public key
 * @param {Nonce} nonce - The nonce to use for encryption
 * @returns {Uint8Array} - Encrypted data
 */
export function encrypt(
    data: Uint8Array | ArrayBufferLike,
    mySecretKey: SecretKey,
    otherPublicKey: PublicKey,
    nonce: Nonce
): Uint8Array {
    const symmetricKey = deriveSymmetricKeyFromKeypair(mySecretKey, otherPublicKey);
    return symmetricEncrypt(data, symmetricKey, nonce);
}

/**
 * Encrypt data and store the nonce along the cypher in the result.
 *
 * Storing the nonce along the cypher has the advantage, that you don't have to remember the
 * nonce for decryption later.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data to encrypt
 * @param {SecretKey} mySecretKey - My own secret key
 * @param {PublicKey} otherPublicKey - The others public key
 * @param {Nonce} nonce - The nonce to use for encryption and embedding. If not specified, then
 * create a random nonce.
 * @returns {Uint8Array} - Nonce concatenated with the cypher
 */
export function encryptAndEmbedNonce(
    data: Uint8Array | ArrayBufferLike,
    mySecretKey: SecretKey,
    otherPublicKey: PublicKey,
    nonce?: Nonce
): Uint8Array {
    const symmetricKey = deriveSymmetricKeyFromKeypair(mySecretKey, otherPublicKey);
    return symmetricEncryptAndEmbedNonce(data, symmetricKey, nonce);
}

/**
 * Decrypt encrypted data.
 *
 * @param {Uint8Array | ArrayBufferLike} cypher - The encrypted data
 * @param {SecretKey} mySecretKey - My own secret key
 * @param {PublicKey} otherPublicKey - The others public key
 * @param {Nonce} nonce - The same nonce for decryption (must be the same that was used for
 * decryption)
 * @returns {Uint8Array} - Decrypted data
 */
export function decrypt(
    cypher: Uint8Array | ArrayBufferLike,
    mySecretKey: SecretKey,
    otherPublicKey: PublicKey,
    nonce: Nonce
): Uint8Array {
    const symmetricKey = deriveSymmetricKeyFromKeypair(mySecretKey, otherPublicKey);
    return symmetricDecrypt(cypher, symmetricKey, nonce);
}

/**
 * Decrypt encrypted data.
 *
 * Since the nonce is embedded in the cypher there is no need to specify it.
 *
 * @param {Uint8Array | ArrayBufferLike} cypherAndNonce - cypher with embedded nonce that was generated by using
 * '[symmetric]EncryptAndEmbedNonce'
 * @param {SecretKey} mySecretKey - My own secret key
 * @param {PublicKey} otherPublicKey - The others public key
 * @returns {Uint8Array} - Decrypted data
 */
export function decryptWithEmbeddedNonce(
    cypherAndNonce: Uint8Array | ArrayBufferLike,
    mySecretKey: SecretKey,
    otherPublicKey: PublicKey
): Uint8Array {
    const symmetricKey = deriveSymmetricKeyFromKeypair(mySecretKey, otherPublicKey);
    return symmetricDecryptWithEmbeddedNonce(cypherAndNonce, symmetricKey);
}
