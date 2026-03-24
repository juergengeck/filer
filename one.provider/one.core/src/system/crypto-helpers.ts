/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/* eslint-disable @typescript-eslint/no-unused-vars, jsdoc/require-returns-check */

/**
 * @module
 */

import type {CLOB, OneObjectTypes} from '../recipes.js';
import type {SHA256Hash} from '../util/type-checks.js';
import {ensurePlatformLoaded} from './platform.js';

type ChBrowser = typeof import('./browser/crypto-helpers.js');
type ChNode = typeof import('./nodejs/crypto-helpers.js');

let CH: ChBrowser | ChNode;

export function setPlatformForCh(exports: ChBrowser | ChNode): void {
    CH = exports;
}

/**
 * Helper function to have one place where the crypto hash of a UTF-8 string is calculated. The
 * implementation depends on the platform. This function is asynchronous because the hash
 * function of the crypto API implemented in browsers is asynchronous.
 * @static
 * @async
 * @param {string} s - The input string
 * @returns {Promise<SHA256Hash>} Returns a promise that resolves with the SHA-256 hash over the
 * input string
 */
export function createCryptoHash<T extends OneObjectTypes | CLOB>(
    s: string
): Promise<SHA256Hash<T>> {
    ensurePlatformLoaded();
    return CH.createCryptoHash(s);
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
 * @static
 * @param {number} [length=64] - Desired length of the random string. The maximum allowed is
 * 65,536 (platform limit in browsers, enforced on all our platforms for portability).
 * @param {boolean} [hex=false] - If true the random string will only contain characters
 * `0123456789abcdef` (hexadecimal, lowercase). If false the string will contain characters from
 * the set `0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-`
 * @returns {Promise<string>} A random string
 */
export function createRandomString(length: number = 64, hex: boolean = false): Promise<string> {
    ensurePlatformLoaded();
    return CH.createRandomString(length, hex);
}

/**
 * This function is a frontend for `createRandomString` to correctly type-annotate the special case
 * when a random hex string of exactly 64 characters is created: The result will then be a hash.
 * @returns {Promise<SHA256Hash>}
 */
export function createRandomSHA256Hash(): Promise<SHA256Hash<any>> {
    ensurePlatformLoaded();
    return CH.createRandomSHA256Hash();
}
