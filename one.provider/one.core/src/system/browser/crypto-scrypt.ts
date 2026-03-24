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

import {scrypt as scryptJs} from 'scrypt-js';
import {getUint8Array} from '../../util/buffer.js';

/**
 * Uses https://github.com/ricmoo/scrypt-js
 * @internal
 * @static
 * @param {Uint8Array | ArrayBufferLike} password
 * @param {Uint8Array | ArrayBufferLike} salt
 * @param {number} [N=1024]
 * @param {number} [r=8]
 * @param {number} [p=1]
 * @param {number} [dkLen=32]
 * @param {Function} [progressCb] - Reports progress as a number between 0 and 1. It always
 * starts with 0, and it always ends with 1, the latter being reported just one JS instruction
 * before resolving the function's promise. **This parameter is specific to the browser
 * implementation of this function.**
 * @returns {Promise<Uint8Array>}
 */
export async function scrypt(
    password: Uint8Array | ArrayBufferLike,
    salt: Uint8Array | ArrayBufferLike,
    N: number = 1024,
    r: number = 8,
    p: number = 1,
    dkLen: number = 32,
    progressCb?: (progress: number) => void
): Promise<Uint8Array> {
    return scryptJs(getUint8Array(password), getUint8Array(salt), N, r, p, dkLen, progressCb);
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
    return scrypt(encoder.encode(secret.normalize('NFKC')), getUint8Array(salt), 1024, 8, 1, len);
}
