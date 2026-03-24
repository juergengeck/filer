/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {createError} from '../errors.js';
import {getUint8Array} from '../util/buffer.js';
import type {KeyPair, Nonce, PublicKey} from './encryption.js';
import {
    decrypt,
    decryptWithEmbeddedNonce,
    deriveSymmetricKeyFromKeypair,
    encrypt,
    encryptAndEmbedNonce
} from './encryption.js';
import type {PublicSignKey, SignKeyPair} from './sign.js';
import {sign} from './sign.js';
import {SymmetricCryptoApi, SymmetricCryptoApiWithKeys} from './SymmetricCryptoApi.js';

/**
 * This api is a wrapper for crypto functions that operate on secret keys.
 *
 * Through this wrapper you can expose crypto functionality without exposing the private key. This
 * is exactly what the keychain implementation does. It will never give you direct access to
 * private keys, only the functions needed to work with those keys.
 */
export class CryptoApi {
    readonly #encryptionKeyPair: KeyPair;
    readonly #signKeyPair?: SignKeyPair;

    get publicEncryptionKey(): PublicKey {
        return this.#encryptionKeyPair.publicKey;
    }

    get publicSignKey(): PublicSignKey {
        if (this.#signKeyPair === undefined) {
            throw createError('CYAPI-PUBSK');
        }

        return this.#signKeyPair.publicKey;
    }

    /**
     * Construct a new crypt api wrapper.
     *
     * @param {KeyPair} encryptionKeyPair - keypair for encryption
     * @param {SignKeyPair} signKeyPair - keypair for signing
     */
    constructor(encryptionKeyPair: KeyPair, signKeyPair?: SignKeyPair) {
        this.#encryptionKeyPair = encryptionKeyPair;
        this.#signKeyPair = signKeyPair;
    }

    /**
     * Same as encryption.ts:encrypt
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @param {PublicKey} otherPublicKey
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    encrypt(
        data: Uint8Array | ArrayBufferLike,
        otherPublicKey: PublicKey,
        nonce: Nonce
    ): Uint8Array {
        return encrypt(
            getUint8Array(data),
            this.#encryptionKeyPair.secretKey,
            otherPublicKey,
            nonce
        );
    }

    /**
     * Same as encryption.ts:encryptAndEmbedNonce
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @param {PublicKey} otherPublicKey
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    encryptAndEmbedNonce(
        data: Uint8Array | ArrayBufferLike,
        otherPublicKey: PublicKey,
        nonce?: Nonce
    ): Uint8Array {
        return encryptAndEmbedNonce(
            getUint8Array(data),
            this.#encryptionKeyPair.secretKey,
            otherPublicKey,
            nonce
        );
    }

    /**
     * Same as encryption.ts:decrypt
     *
     * @param {Uint8Array | ArrayBufferLike} cypher
     * @param {PublicKey} otherPublicKey
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    decrypt(
        cypher: Uint8Array | ArrayBufferLike,
        otherPublicKey: PublicKey,
        nonce: Nonce
    ): Uint8Array {
        return decrypt(
            getUint8Array(cypher),
            this.#encryptionKeyPair.secretKey,
            otherPublicKey,
            nonce
        );
    }

    /**
     * Same as encryption.ts:decryptWithEmbeddedNonce
     *
     * @param {Uint8Array | ArrayBufferLike} cypherAndNonce
     * @param {PublicKey} otherPublicKey
     * @returns {Uint8Array}
     */
    decryptWithEmbeddedNonce(
        cypherAndNonce: Uint8Array | ArrayBufferLike,
        otherPublicKey: PublicKey
    ): Uint8Array {
        return decryptWithEmbeddedNonce(
            getUint8Array(cypherAndNonce),
            this.#encryptionKeyPair.secretKey,
            otherPublicKey
        );
    }

    /**
     * Construct an encryption/decryption api based on the public key of someone else.
     *
     * All encryption & decryption calls from this crypto API, require the public key of
     * somebody else. By using the api returned by this function, you do not have to specify the
     * key of the other side each time. This is also slightly faster if multiple functions are
     * called, because this call derives the symmetric key only once.
     *
     * @param {PublicKey} otherPublicKey
     * @returns {EncryptionApi}
     */
    createEncryptionApiWithPerson(otherPublicKey: PublicKey): SymmetricCryptoApi {
        const symmetricKey = deriveSymmetricKeyFromKeypair(
            this.#encryptionKeyPair.secretKey,
            otherPublicKey
        );
        return new SymmetricCryptoApi(symmetricKey);
    }

    /**
     * Same as createCryptoApiWith, but we also store the public keys of the participants.
     *
     * @param {PublicKey} otherPublicKey
     * @returns {SymmetricCryptoApi}
     */
    createEncryptionApiWithKeysAndPerson(otherPublicKey: PublicKey): SymmetricCryptoApiWithKeys {
        const symmetricKey = deriveSymmetricKeyFromKeypair(
            this.#encryptionKeyPair.secretKey,
            otherPublicKey
        );
        return new SymmetricCryptoApiWithKeys(
            symmetricKey,
            this.publicEncryptionKey,
            otherPublicKey
        );
    }

    /**
     * Sign the passed data.
     *
     * This only returns the signature, not a complete signed message.
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @returns {Uint8Array}
     */
    sign(data: Uint8Array | ArrayBufferLike): Uint8Array {
        if (this.#signKeyPair === undefined) {
            throw createError('CYAPI-SIGN');
        }

        return sign(getUint8Array(data), this.#signKeyPair.secretKey);
    }
}
