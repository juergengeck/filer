/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2020
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Helper function(s) for strings.
 * @module
 */

import {createError} from '../errors.js';
import {isInteger} from './type-checks-basic.js';

/**
 * **JS RUNTIME OPTIMIZATION PREVENTION HACK**
 *
 * Workaround for {@link https://bugs.chromium.org/p/v8/issues/detail?id=2869}
 *
 * This is the same as the standard string function `substr`, but it forces the JS runtime to
 * allocate new memory.
 *
 * Modern runtimes internally don't always allocate new memory, instead they keep a reference to
 * the original string as well as start and end within that string if the runtime sees a
 * read-only use of the sub string.
 * @static
 * @param {string} s - A string
 * @param {number} start - A non-negative integer start position
 * @param {number} [length=s.length-start] - A non-negative length. If omitted, it is calculated
 * as `s.length - start`
 * @returns {string}
 */
export function substrForceMemCopy(
    s: string,
    start: number,
    length: number = s.length - start
): string {
    // Because of the charAt() this case would not work and needs to be handled separately now.
    // This must happen BEFORE the error-throwing parameter checks in order to work like the
    // original substr() for these cases!
    if (start > s.length || length === 0) {
        return '';
    }

    // We don't recreate the exact same behavior of the original substr() function, so we must
    // exclude negative values
    if (!isInteger(start) || !isInteger(length) || start < 0 || length < 0) {
        throw createError('US-SSFMC1', {s, start, length});
    }

    // Adding the last character in a string concatenation operation *should* work around any
    // current string operation optimizations and force the runtime to allocate new memory for the
    // resulting string.
    return s.slice(start, start + length - 1) + s.charAt(start + length - 1);
}
