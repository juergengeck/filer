/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {getUint8Array} from '../util/buffer.js';
import {ensurePlatformLoaded} from './platform.js';

/**
 * @private
 * @module
 */

type CscrBrowser = typeof import('./browser/crypto-scrypt.js');
type CscrNode = typeof import('./nodejs/crypto-scrypt.js');

let CS: CscrBrowser | CscrNode;

export function setPlatformForCs(exports: CscrBrowser | CscrNode): void {
    CS = exports;
}

/**
 * @static
 * @param {Uint8Array | ArrayBufferLike} password
 * @param {Uint8Array | ArrayBufferLike} salt
 * @param {number} [N=1024]
 * @param {number} [r=8]
 * @param {number} [p=1]
 * @param {number} [dkLen=32]
 * @returns {Promise<Uint8Array>}
 */
export async function scrypt(
    password: Uint8Array | ArrayBufferLike,
    salt: Uint8Array | ArrayBufferLike,
    N: number = 1024,
    r: number = 8,
    p: number = 1,
    dkLen: number = 32
): Promise<Uint8Array> {
    ensurePlatformLoaded();
    return await CS.scrypt(getUint8Array(password), getUint8Array(salt), N, r, p, dkLen);
}

/**
 * @static
 * @param {string} secret
 * @param {Uint8Array | ArrayBufferLike} salt
 * @param {number} [len=32]
 * @returns {Promise<Uint8Array>}
 */
export async function deriveBinaryKey(
    secret: string,
    salt: Uint8Array | ArrayBufferLike,
    len = 32
): Promise<Uint8Array> {
    ensurePlatformLoaded();
    return await CS.deriveBinaryKey(secret, getUint8Array(salt), len);
}
