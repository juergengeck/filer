/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import type {AnyObject} from './object.js';
import {isObject} from './type-checks-basic.js';

/**
 * A recursive version of `Object.freeze`
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze}
 * @param {AnyObject} obj - The object to be frozen
 * @returns {undefined} Returns `undefined` - the given object itself is frozen
 */
export function deepFreeze(obj: AnyObject): void {
    for (const name of Reflect.ownKeys(obj)) {
        const v = obj[name as keyof typeof obj];

        if (isObject(v)) {
            deepFreeze(v);
        }
    }

    Object.freeze(obj);
}
