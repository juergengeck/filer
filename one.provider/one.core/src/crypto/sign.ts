/**
 * This file provides a collection of low level functions for signing.
 *
 * Usually you won't use those directly, because you don't have access to the private keys.
 *
 * Everything is build on-top of tweetnacl. So you need to be familiar with how tweetnacl works in
 * order to use this safely.
 *
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import tweetnacl from 'tweetnacl';

import {createError} from '../errors.js';
import {getUint8Array} from '../util/buffer.js';

export type PublicSignKey = Uint8Array & {_: 'signPublicKey'};
export type SecretSignKey = Uint8Array & {_: 'signSecretKey'};
export interface SignKeyPair {
    publicKey: PublicSignKey;
    secretKey: SecretSignKey;
}

/**
 * Create a new public/secret keypair for signing.
 *
 * @returns {SignKeyPair}
 */
export function createSignKeyPair(): SignKeyPair {
    const keyPair = tweetnacl.sign.keyPair();
    return {
        publicKey: keyPair.publicKey as PublicSignKey,
        secretKey: keyPair.secretKey as SecretSignKey
    };
}

/**
 * Ensure that it is a secret sign key by comparing the length of the data.
 *
 * Note that we cannot really check that it is a secret key, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the secret key in it.
 * @returns {SecretSignKey}
 */
export function ensureSecretSignKey(data: Uint8Array | ArrayBufferLike): SecretSignKey {
    if (data.byteLength !== tweetnacl.sign.secretKeyLength) {
        throw createError('CYSIG-ENSSEC');
    }

    return data as SecretSignKey;
}

/**
 * Ensure that it is a public sign key by comparing the length of the data.
 *
 * Note that we cannot really check that it is a public key, we can just check that the single
 * requirement is met - the length. If the length is right we cast it to the right type.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The Uint8Array with the public key in it.
 * @returns {PublicSignKey}
 */
export function ensurePublicSignKey(data: Uint8Array | ArrayBufferLike): PublicSignKey {
    if (data.byteLength !== tweetnacl.sign.publicKeyLength) {
        throw createError('CYENC-ENSPUB');
    }

    return data as PublicSignKey;
}

/**
 * Sign data.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data to sign
 * @param {SecretSignKey} mySecretKey - The secret key used to sign the data
 * @returns {Uint8Array}
 */
export function sign(data: Uint8Array | ArrayBufferLike, mySecretKey: SecretSignKey): Uint8Array {
    return tweetnacl.sign.detached(getUint8Array(data), mySecretKey);
}

/**
 * Verify a signature.
 *
 * @param {Uint8Array | ArrayBufferLike} data - The data on which the signature was created.
 * @param {Uint8Array | ArrayBufferLike} signature - The signature that was created with the sign function
 * @param {PublicSignKey} otherPublicKey - The public key corresponding to the private key used to
 *     create the signature
 * @returns {boolean}
 */
export function signatureVerify(
    data: Uint8Array | ArrayBufferLike,
    signature: Uint8Array | ArrayBufferLike,
    otherPublicKey: PublicSignKey
): boolean {
    return tweetnacl.sign.detached.verify(
        getUint8Array(data),
        getUint8Array(signature),
        otherPublicKey
    );
}
