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

import {scrypt as nativeScrypt} from 'crypto';
import {TextEncoder} from 'util';

import {createError} from '../../errors.js';
import {getUint8Array} from '../../util/buffer.js';

/**
 * On node.js this is the promisified version of that platforms crypto module's asynchronous
 * "scrypt" key derivation function (KDF).
 * @internal
 * @static
 * @param {Uint8Array | ArrayBufferLike} password
 * @param {Uint8Array | ArrayBufferLike} salt
 * @param {number} N
 * @param {number} r
 * @param {number} p
 * @param {number} [dkLen=32]
 * @returns {Promise<Uint8Array>}
 */
export function scrypt(
    password: Uint8Array | ArrayBufferLike,
    salt: Uint8Array | ArrayBufferLike,
    N: number = 1024,
    r: number = 8,
    p: number = 1,
    dkLen: number = 32
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        nativeScrypt(
            getUint8Array(password),
            getUint8Array(salt),
            dkLen,
            {N, r, p},
            (err, derivedKey) => {
                if (err) {
                    return reject(createError('CRS-SCR1', err));
                }

                resolve(
                    new Uint8Array(
                        // Copy to be on the safe side: Because this is small it comes from a much
                        // larger shared buffer. That is why offset and length are necessary too!
                        derivedKey.buffer.slice(
                            derivedKey.byteOffset,
                            derivedKey.byteOffset + derivedKey.byteLength
                        )
                    )
                );
            }
        );
    });
}

/**
 * @internal
 * @static
 * @param {string} secret - The string will be
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize|normalized}.
 * @param {Uint8Array | ArrayBufferLike} salt
 * @param {number} [len=32]
 * @returns {Promise<Uint8Array>}
 */
export async function deriveBinaryKey(
    secret: string,
    salt: Uint8Array | ArrayBufferLike,
    len = 32
): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    return await scrypt(
        encoder.encode(secret.normalize('NFKC')),
        getUint8Array(salt),
        1024,
        8,
        1,
        len
    );
}
