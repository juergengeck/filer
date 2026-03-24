/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import type {AnyFunction} from './function.js';

/**
 * A module with functions that perform runtime type checks. There are very simple checks such
 * as `isString()`, there also are complex checks.
 * @module
 */

/**
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isObject(thing: unknown): thing is Record<string, any> {
    return typeof thing === 'object' && thing !== null;
}

/**
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isString(thing: unknown): thing is string {
    return typeof thing === 'string';
}

/**
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isSymbol(thing: unknown): thing is symbol {
    return typeof thing === 'symbol';
}

/**
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isNumber(thing: unknown): thing is number {
    return typeof thing === 'number' && !Number.isNaN(thing);
}

/**
 * Type-safety adding front end for `Number.isInteger`.
 *
 * The reason for not simply using `Number.isInteger` as-is is that this function adds the type
 * safety. When we only use `Number.isInteger` directly we still got "can be undefined" errors
 * from the tested value in an `&&` chain conditional expression.
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isInteger(thing: unknown): thing is number {
    return Number.isInteger(thing);
}

/**
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isFunction(thing: unknown): thing is AnyFunction {
    return typeof thing === 'function';
}

/**
 * Returns the value of an object's `Symbol.toStringTag`
 * {@link http://2ality.com/2015/09/well-known-symbols-es6.html#symboltostringtag-string}
 * @static
 * @param {*} o - Any object or value
 * @returns {string}
 */
export function getObjTypeName(o: unknown): string {
    // "[object TypeName]" ==> "[object ".length === 8
    return Object.prototype.toString.call(o).slice(8, -1);
}

export function isArray(thing: unknown): thing is any[] {
    return Array.isArray(thing);
}
