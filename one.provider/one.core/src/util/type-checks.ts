/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A module with functions that perform runtime type checks. There are very simple checks such
 * as `isString()`, there also are complex checks.
 * @module
 */

/**
 * (Simulated) opaque type name alias for strings that are SHA-256 hashes _pointing to
 * concrete objects_.
 *
 * This type has a generic parameter: A member or a union of {@link OneObjectTypes} as well
 * as the virtual types {@link BLOB} and {@link CLOB}.
 *
 * This generic parameter is used by and passed through all major one.core functions' type
 * definitions. For example, after storing an object the hashes in the object creation
 * result object will be tagged with the typed of the object.
 * @global
 * @typedef {string} SHA256Hash
 */
export type SHA256Hash<T extends HashTypes = OneObjectTypes> = string & {
    _: 'SHA256Hash';
    type: T;
};

/**
 * (Simulated) opaque type name alias for strings that are SHA-256 hashes _pointing to ID
 * objects, i.e. to all past, present and future versions of a versioned object_.
 *
 * This type has a generic parameter: A member or a union of {@link OneObjectTypes} as well
 * as the virtual types {@link BLOB} and {@link CLOB}.
 * @global
 * @typedef {string} SHA256IdHash
 */
export type SHA256IdHash<
    T extends OneVersionedObjectTypes | OneIdObjectTypes = OneVersionedObjectTypes
> = string & {
    _: 'SHA256IdHash';
    type: T;
};

/**
 * This is a TypeScript helper type that extracts the type of the elements of certain container
 * types. If the container is read-only and its elements are known this results in a union type
 * of those elements.
 *
 * Examples:
 * ```
 * const set = new Set(['a', 'b', 'c'] as const);
 * // "a" | "b" | "c"
 * type SSS = ElementType<typeof set>;
 *
 * const arr = ['aa', 'bb', 'cc'] as const;
 * // // "aa" | "bb" | "cc"
 * type AAA = ElementType<typeof arr>;
 *
 * const map = new Map([['a', 1], ['b', 2], ['c', 42]] as const);
 * // 1 | 2 | 42
 * type MMM = ElementType<typeof map>;
 * ```
 * @global
 * @template T
 * @typedef {*} ElementType<T>
 */
export type ElementType<T> =
    T extends Array<infer U>
        ? U
        : T extends Readonly<Array<infer U>>
          ? U
          : T extends Set<infer U>
            ? U
            : T extends Readonly<Set<infer U>>
              ? U
              : T extends Map<any, infer U>
                ? U
                : T extends Readonly<Map<any, infer U>>
                  ? U
                  : T extends Promise<infer U>
                    ? U
                    : T;

import {createError} from '../errors.js';
import type {
    ArrayValue,
    BagValue,
    HashTypes,
    OneIdObjectTypes,
    OneObjectTypes,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypes,
    RecipeRule,
    SetValue,
    ValueType,
    VersionNode
} from '../recipes.js';
import {
    versionNodeTypes
} from '../recipes.js';
import type {FileCreation, SimpleReadStream} from '../storage-base-common.js';
import {CREATION_STATUS} from '../storage-base-common.js';
import type { UnversionedObjectResult } from '../storage-unversioned-objects.js';
import type {AnyObject} from './object.js';
import type {OneEventSource, OneEventSourceConsumer} from './one-event-source.js';
import {isFunction, isObject, isString} from './type-checks-basic.js';

/**
 * A regular expression that can be used to verify that a given string looks like a
 * cryptographic hash string used to represent ONE objects. For SHA-256 it tests if there
 * are 64 characters and that each one of them is between 0-9 or a-f.
 * @private
 * @type {RegExp}
 */
const CRYPTO_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Used to check request results. Values "new" and "exists".
 * @private
 * @type {Set<string>}
 */
const FILE_CREATION_STATUS_VALUES = new Set(Object.values(CREATION_STATUS));

/**
 * An alternative to `Object.keys(o).length` that is more efficient. Running a test loop
 * comparing the two showed less than half the time for the for-loop option. Also, `Object.keys`
 * creates a temporary array.
 * @static
 * @param {object} o
 * @returns {number}
 */
export function countEnumerableProperties(o: AnyObject): number {
    let count = 0;

    for (const prop in o) {
        if (Object.prototype.hasOwnProperty.call(o, prop)) {
            count += 1;
        }
    }

    return count;
}

/**
 * Valid encodings for file streams are binary (undefined or null), "base64" and "utf8".
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isEncoding(thing: unknown): thing is undefined | 'base64' | 'utf8' {
    return thing === undefined || thing === 'base64' || thing === 'utf8';
}

/**
 * ONE uses SHA-256 hashes in hexadecimal lowercase format to represent the contents of files.
 * This functions tests a given "thing" of any type if it is such a string.
 *
 * For the curious: Why a function?
 *
 * While one might simply test against a regular expression using myRegEx.test(thing) this
 * method has one more or less theoretical problem: If the thing is an object with a toString()
 * method that returns a matching string the test will return "true" even though the thing is an
 * object and not a string. For example,
 * ```javascript
 * /^s+$/.test( {toString: () => 'sss'} );
 * ```
 * will return true.
 * @static
 * @param {*} thing - An argument that can be of any type
 * @returns {boolean} True if the argument is a SHA-256 lowercase hexadecimal string, false if not
 */
export function isHash<T extends HashTypes>(
    thing: unknown
): thing is SHA256Hash<T> | SHA256IdHash<T extends OneVersionedObjectTypes ? T : never> {
    return isString(thing) && CRYPTO_HASH_RE.test(thing);
}

/**
 * Non-regex version of the "isHash" function in an attempt to save a tiny bit of CPU because we
 * don't need a full regex check here. "Premature optimization" vs. "it's cheap and easy", and
 * according to reported real world runtime experience these hash checks can add up and become
 * significant.
 * @param {*} s
 * @returns {boolean}
 */
export function looksLikeHash(s: unknown): boolean {
    return typeof s === 'string' && s.length === 64;
}

/**
 * The function returns the given value after making sure it is a SHA-256 hexadecimal string. It
 * throws an Error if this is not the case.
 * @static
 * @param {*} thing
 * @returns {SHA256Hash}
 * @throws {Error}
 */
export function ensureHash<T extends HashTypes>(thing: unknown): SHA256Hash<T> {
    if (isHash<T>(thing)) {
        return thing as SHA256Hash<T>;
    }

    throw createError('UTC-EHASH', {thing});
}

/**
 * The function returns the given value after making sure it is a SHA-256 hexadecimal string. It
 * throws an Error if this is not the case.
 * @static
 * @param {*} thing
 * @returns {SHA256Hash}
 * @throws {Error}
 */
export function ensureIdHash<T extends OneVersionedObjectTypes = any>(
    thing: unknown
): SHA256IdHash<T> {
    if (isHash<T>(thing)) {
        return thing as SHA256IdHash<T>;
    }

    throw createError('UTC-EIDHASH', {thing});
}

/**
 * Checks if a given object is a ONE.core {@link OneEventSourceConsumer} object by testing the
 * properties (duck typing).
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isEventSourceConsumer(thing: unknown): thing is OneEventSourceConsumer<unknown> {
    return isObject(thing) && isFunction(thing.addListener) && isFunction(thing.removeListener);
}

/**
 * Checks if a given object is a ONE.core {@link OneEventSource} object by testing the properties
 * (duck typing).
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isEventSource(thing: unknown): thing is OneEventSource<unknown> {
    return isObject(thing) && isEventSourceConsumer(thing.consumer);
}

/**
 * Checks if a given object is a ONE.core {@link SimpleReadStream} object by testing the
 * properties (duck typing).
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isSimpleReadStream(thing: unknown): thing is SimpleReadStream {
    return (
        isObject(thing) &&
        isFunction(thing.pause) &&
        isFunction(thing.resume) &&
        isFunction(thing.cancel) &&
        thing.promise instanceof Promise &&
        isEncoding(thing.thing) &&
        isEventSourceConsumer(thing.onData)
    );
}

/**
 * Checks for {@link FileCreation} objects. They are used to return the result of saving BLOBs
 * and CLOBs to storage.
 * @static
 * @param {*} thing
 * @returns {boolean}
 */
export function isFileCreationResult(thing: unknown): thing is FileCreation<any> {
    return (
        isObject(thing) &&
        countEnumerableProperties(thing) === 2 &&
        isHash(thing.hash) &&
        FILE_CREATION_STATUS_VALUES.has(thing.status)
    );
}

/**
 * @static
 * @param {*} thing - Data e.g. from a network connection expected to be of format SHA256Hash[]
 * @returns {SHA256Hash[]} Returns the data now confirmed to be of type Array of SHA256Hash
 * @throws {Error} Throws an Error when the given data is not an array of (only) SHA-256
 * hashes
 */
export function ensureArrayOfSHA256Hash(thing: unknown): Array<SHA256Hash<HashTypes>> {
    if (Array.isArray(thing) && thing.every(item => isHash(item))) {
        return thing as Array<SHA256Hash<HashTypes>>;
    }

    throw createError('UTC-AHASH', {thing});
}

/**
 * @static
 * @param {RecipeRule} obj
 * @returns {RecipeRule}
 */
export function ruleHasItemType(obj: RecipeRule): obj is RecipeRule & {itemtype: ValueType} {
    return Object.prototype.hasOwnProperty.call(obj, 'itemtype');
}

/**
 * Check if the valueType is a list type: array, bag, or set.
 * @static
 * @param {ValueType} arg
 * @returns {boolean}
 */
export function isListItemType(arg: ValueType): arg is BagValue | ArrayValue | SetValue {
    return arg.type === 'array' || arg.type === 'bag' || arg.type === 'set';
}

/**
 * Check if the valueType is a list type: array, bag, or set.
 * @static
 * @param {unknown} thing
 * @returns {boolean} Returns true if the thing is an UnversionedObjectResult, false otherwise
 */
export function isUnversionedObjectResult<T extends OneUnversionedObjectTypes>(thing: unknown): thing is UnversionedObjectResult<T> {
    return isObject(thing) && !('$type$' in thing) && isString(thing.$type$) && 'obj' in thing && 'hash' in thing && isHash(thing.hash) && 'status' in thing && isUnversionedObject(thing.obj);
}

/**
 * Check if the thing is an unversioned object
 * @static
 * @param {unknown} thing
 * @returns {boolean} Returns true if the thing is an unversioned object, false otherwise
 */
export function isUnversionedObject(thing: unknown): thing is OneUnversionedObjectTypes {
    return isObject(thing) && '$type$' in thing && isString(thing.$type$);
}

/**
 * Check if the thing is a version node
 * @static
 * @param {unknown} thing
 * @returns {boolean} Returns true if the thing is a version node, false otherwise
 */
export function isVersionNode<T extends OneVersionedObjectTypes>(thing: unknown): thing is VersionNode<T> {
    return isObject(thing) && '$type$' in thing && isString(thing.$type$) && versionNodeTypes.includes(thing.$type$);
}