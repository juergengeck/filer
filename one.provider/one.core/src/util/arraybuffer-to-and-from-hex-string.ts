/**
 * @author Erik Haßlmeyer <erik@refinio.net>
 * @copyright REFINIO GmbH 2021
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {getUint8Array} from './buffer.js';

/**
 * @module
 */

/**
 * This type represents a hexadecimal string.
 *
 * This hexadecimal string is expected to have an even number of elements, so that it can be
 * converted to binary representation: Two hexadecimal bytes result in one byte in binary
 * representation.
 *
 * Note that this is a type that cannot be constructed, just cast to. This is a Typescript trick
 * to have a special kind of string.
 * @global
 * @typedef {string} HexString
 */
export type HexString = string & {
    _: 'HexString';
};

/**
 * Regular expression for testing HexString string.
 */
export const HexStringRegex = /^([0-9a-fA-F]{2})*$/;

/**
 * Check if the passed input string is a hexadecimal string.
 * @param {string} input - the string to test.
 * @returns {boolean}
 */
export function isHexString(input: string): input is HexString {
    return HexStringRegex.test(input);
}

/**
 * Ensure that the passed string is a hexadecimal string.
 * @param {string} input - the string to test.
 * @returns {HexString}
 */
export function ensureHexString(input: string): HexString {
    if (!isHexString(input)) {
        throw new Error(`Not a hex string: ${input}`);
    }

    return input;
}

/**
 * Converts contents of Uint8Array to a hexadecimal string.
 * @param {Uint8Array | ArrayBufferLike} buffer - The Uint8Array to convert to a hex string.
 * @returns {HexString}
 */
export function uint8arrayToHexString(buffer: Uint8Array | ArrayBufferLike): HexString {
    let hex = '';

    for (const x of getUint8Array(buffer)) {
        hex += x.toString(16).padStart(2, '0');
    }

    return hex as HexString;
}

/**
 * Converts a hexadecimal string to an Uint8Array.
 * @param {HexString} input - The string that shall be converted. It must consist of an even
 * number of the characters 0-9, a-f, A-F.
 * @returns {Uint8Array}
 */
export function hexToUint8Array(input: HexString): Uint8Array {
    if (input.length % 2 !== 0) {
        throw new RangeError('Expected string to be an even number of characters');
    }

    const view = new Uint8Array(input.length / 2);

    for (let i = 0; i < input.length; i += 2) {
        view[i / 2] = parseInt(input.substring(i, i + 2), 16);
    }

    return view;
}

/**
 * Converts a hexadecimal string to an Uint8Array with an additional regex test.
 * @param {string} input - The string that shall be converted. It must consist of an even number of
 * the characters 0-9, a-f, A-F.
 * @returns {Uint8Array}
 */
export function hexToUint8ArrayWithCheck(input: string): Uint8Array {
    return hexToUint8Array(ensureHexString(input));
}
