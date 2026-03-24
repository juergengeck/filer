/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import type {Nonce, PublicKey, SymmetricKey} from './encryption.js';
import {
    symmetricDecrypt,
    symmetricDecryptWithEmbeddedNonce,
    symmetricEncrypt,
    symmetricEncryptAndEmbedNonce
} from './encryption.js';

/**
 * Class provides functions for symmetric encryption and decryption.
 */
export class SymmetricCryptoApi {
    readonly #symmetricKey: SymmetricKey;

    constructor(symmetricKey: SymmetricKey) {
        this.#symmetricKey = symmetricKey;
    }

    /**
     * Same as encryption.ts:symmetricEncrypt
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    encrypt(data: Uint8Array | ArrayBufferLike, nonce: Nonce): Uint8Array {
        return symmetricEncrypt(data, this.#symmetricKey, nonce);
    }

    /**
     * Same as encryption.ts:symmetricEncryptAndEmbedNonce
     *
     * @param {Uint8Array | ArrayBufferLike} data
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    encryptAndEmbedNonce(data: Uint8Array | ArrayBufferLike, nonce?: Nonce): Uint8Array {
        return symmetricEncryptAndEmbedNonce(data, this.#symmetricKey, nonce);
    }

    /**
     * Same as encryption.ts:symmetricDecrypt
     *
     * @param {Uint8Array | ArrayBufferLike} cypher
     * @param {Nonce} nonce
     * @returns {Uint8Array}
     */
    decrypt(cypher: Uint8Array | ArrayBufferLike, nonce: Nonce): Uint8Array {
        return symmetricDecrypt(cypher, this.#symmetricKey, nonce);
    }

    /**
     * Same as encryption.ts:symmetricDecryptAndRemoveNonce
     *
     * @param {Uint8Array | ArrayBufferLike} cypherAndNonce
     * @returns {Uint8Array}
     */
    decryptWithEmbeddedNonce(cypherAndNonce: Uint8Array | ArrayBufferLike): Uint8Array {
        return symmetricDecryptWithEmbeddedNonce(cypherAndNonce, this.#symmetricKey);
    }
}

/**
 * Stores the keys that were used to derive the symmetric crypto API within this object.
 *
 * This convenience wrapper makes many interfaces much easier, because they don't need to pass
 * around the keys all the time.
 */
export class SymmetricCryptoApiWithKeys extends SymmetricCryptoApi {
    readonly localPublicKey: PublicKey;
    readonly remotePublicKey: PublicKey;

    constructor(symmetricKey: SymmetricKey, localPublicKey: PublicKey, remotePublicKey: PublicKey) {
        super(symmetricKey);
        this.localPublicKey = localPublicKey;
        this.remotePublicKey = remotePublicKey;
    }
}
