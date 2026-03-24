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

/*
 * NOTE ABOUT ERRORS AND PROMISE STYLE (promise.catch instead of try/catch)
 *
 * We cannot use "new Promise" and reject or throw in there - in our experiments this did not
 * result in an async. stack trace. The node.js function must already be the promisified version
 * to begin with.
 *
 * Unlike "fs" methods the error thrown e.g. from randomBytes (promisified version!) did indeed
 * include a stack trace in our tests.
 * Follow https://bugs.chromium.org/p/v8/issues/detail?id=9443
 */

import {createHash, randomBytes} from 'crypto';
import {promisify} from 'util';

import {createError} from '../../errors.js';
import type {CLOB, OneObjectTypes} from '../../recipes.js';
import type {SHA256Hash} from '../../util/type-checks.js';

const randomBytesPromisified = promisify(randomBytes);

/**
 * Helper function to have one place where the crypto hash of a UTF-8 string is calculated. The
 * implementation depends on the platform. This function is asynchronous because the hash
 * function of the crypto API implemented in browsers is asynchronous.
 * @internal
 * @static
 * @param {string} s - The input string
 * @returns {Promise<SHA256Hash>} Returns a promise that resolves with the SHA-256 hash over the
 * input string
 */
export function createCryptoHash<T extends OneObjectTypes | CLOB>(
    s: string
): Promise<SHA256Hash<T>> {
    return Promise.resolve(createHash('sha256').update(s, 'utf8').digest('hex') as SHA256Hash<T>);
}

/**
 * Helper function that creates a *secure* random string characters.
 *
 * It uses crypto-functions of the respective platform to create a *secure* random string.
 *
 * node.js: crypto.randomBytes()
 * low.js: crypto.randomBytes() (low.js implementation)
 * moddable: NOT SECURE: There is no native method, so we use Math.random()
 * browser: crypto.getRandomValues()
 * rn: package LinusU/react-native-get-random-values, i.e.
 *     - iOS: secrandomcopybytes()
 *       https://developer.apple.com/documentation/security/1399291-secrandomcopybytes
 *     - Android: class SecureRandom
 *       https://developer.android.com/reference/java/security/SecureRandom
 *
 * Different platforms set different limits for our implementation, which, for portability, we
 * enforce on all platforms:
 *
 * - Maximum string length of 65,536 characters
 * - Returns a promise because on node.js the (preferred way to call the native) method is
 *   asynchronous
 *
 * @internal
 * @static
 * @param {number} [length=64] - Desired length of the random string. The maximum allowed is
 * 65,536 (platform limit in browsers, enforced on all our platforms for portability).
 * @param {boolean} [hex=false] - If true the random string will only contain characters
 * `0123456789abcdef` (hexadecimal, lowercase). If false the string will contain characters from
 * the set `0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-`
 * @returns {Promise<string>} A random string
 */
export async function createRandomString(
    length: number = 64,
    hex: boolean = false
): Promise<string> {
    // The size limitation exists on some supported platforms, so we enforce it on all.
    if (length > 65536) {
        throw createError('CR-RS1', {length});
    }

    return await randomBytesPromisified(length).then(buf => {
        // Chars needs to contain 2^n elements with n <= 8 to get an even distribution
        // of characters.
        // THESE ARE 64 CHARACTERS ("magic number" constant used as index below)
        // THE FIRST 16 ARE HEX CHARACTERS
        const CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-';

        // For a hexadecimal string all we have to do is to only use the first 16 characters.
        const n = hex ? 16 : 64;

        for (const [i, v] of buf.entries()) {
            buf[i] = CHARS.charCodeAt(v % n);
        }

        return buf.toString('utf8');
    });
}

/**
 * This function is a frontend for `createRandomString` to correctly type-annotate the special case
 * when a random hex string of exactly 64 characters is created: The result will then be a
 * SHA-256 hash.
 * @internal
 * @returns {Promise<SHA256Hash>}
 */
export function createRandomSHA256Hash(): Promise<SHA256Hash<any>> {
    return createRandomString(64, true) as Promise<SHA256Hash<any>>;
}
