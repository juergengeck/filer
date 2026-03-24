/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */

/**
 * @module
 */

import {createError} from '../errors.js';
import type {AnyFunction} from './function.js';
import type {AnyObject} from './object.js';
import {getObjTypeName, isFunction, isObject, isString, isSymbol} from './type-checks-basic.js';

/**
 * Internal JSON string build function for (pure) objects and for Error objects (common code
 * except for the way to find the object keys, Object.keys() vs. Reflect.ownKeys())
 * @private
 * @param {object} obj
 * @param {string[]} keys - MUTATED (sorted in place)
 * @param {Map<*,null|string>} seenObjects - Here it is never `null` because this function only is
 * called for objects, and when the thing to stringify is an object there always is a `Set` on
 * this parameter in the parent function `actualStringify`
 * @param {boolean} convertUnconvertible - When `true` circles, promises, functions and symbols
 * are meta-encoded instead of reported with an error
 * @param {string} property - When called for a nested sub-object this is the property name of
 * the parent object. It is `null` when called for the root object.
 * @returns {string}
 */
function buildObjString(
    obj: Readonly<AnyObject>,
    keys: string[],
    seenObjects: Map<unknown, null | string>,
    convertUnconvertible: boolean,
    property: null | string
): string {
    // Leads to predictable insertion-order independent iteration sequence
    keys.sort();

    let jsonStr = '{';

    for (const key of keys) {
        // Compatibility with JSON.stringify: object properties that are undefined or point to a
        // symbol are excluded
        if (obj[key] !== undefined && (!isSymbol(obj[key]) || convertUnconvertible)) {
            // If a property is undefined it is skipped, so checking what we added to the JSON
            // string thus far is a better option than the others that I thought of, including
            // building an array and then calling join(',') on it (wasted memory allocation).
            if (!jsonStr.endsWith('{') && !jsonStr.endsWith(',')) {
                jsonStr += ',';
            }

            jsonStr +=
                '"' +
                key +
                '":' +
                actualStringify(
                    obj[key],
                    convertUnconvertible,
                    // BRANCHING: Each item creates a different branch and therefore needs a
                    // copy, otherwise the branches would detect objects in another branch which
                    // are not a circle.
                    // Optimization: The (expensive) clone operation is only needed for objects.
                    isObject(obj[key]) ? new Map(seenObjects) : null,
                    property === null ? key : `${property}.${key}`
                );
        }
    }

    jsonStr += '}';

    return jsonStr;
}

// Alternative typing:
// function actualStringify<T extends unknown> (
//     obj: T,
//     seenObjects: T extends AnyObject ? Map<unknown,null|string> : null
// ): string {

/**
 * Inner stringify function: The "seenObjects" parameter is not visible in the public function.
 * @private
 * @param {*} obj - A value or an object.
 * @param {boolean} convertUnconvertible - When `true` circles, promises, functions and symbols
 * are meta-encoded instead of reported with an error
 * @param {Map<*,null|string>|null} seenObjects - This is set to `null` when the `obj` parameter
 * is not an object, otherwise it is a Set
 * @param {null|string} property - When called for a nested sub-object this is the property name of
 * the parent object. It is `null` when called for the root object.
 * @param {boolean} [unorderedArray=false] - This parameter is used during recursion for Set and
 * Map objects: Those objects are turned into arrays, for which the function is then called
 * recursively. Since Set and Map objects are unordered but are iterated over in insertion order
 * we could end up with differently ordered arrays and therefore with different JSON strings.
 * That is why if we get an array from such a recursive call we need to order it. The best way
 * to do this is to order the JSON strings of the elements. That is why the array cannot be
 * pre-ordered after converting Set and Map to their respective array presentations - it would
 * not work for most object elements. We can only reliably order all kinds of Set and Map array
 * representations if we order the JSON strings of their elements. *Regular arrays* in the
 * object itself must of course not be ordered.
 * @returns {string} Returns a JSON string
 */
function actualStringify(
    obj: unknown,
    convertUnconvertible: boolean,
    seenObjects: null | Map<unknown, null | string>,
    property: null | string,
    unorderedArray: boolean = false
): string {
    // Circle detection - Like the native stringify function we do not handle circles, but we want
    // to detect them early and not through a stack overflow.
    // "null" is used as part of an optimization: When the value is an object (or array) we will
    // need to clone seenObjects for very sub-item (if it is an object). If it is a simple value it
    // is not used at all and cloning the Set would be useless. So if seenObjects is null there
    // already was an isObject check before the recursive call to this function.
    if (seenObjects !== null) {
        const seen = seenObjects.get(obj);

        // obj is an object and not a simple value, and it could lead to a circle through its
        // sub-items (array items or object properties can be objects we already encountered)
        if (seen !== undefined) {
            if (convertUnconvertible) {
                return `"$$CIRCLE:${seen === null ? '/' : seen}$$"`;
            } else {
                throw createError('USS-STR1', {property});
            }
        }

        seenObjects.set(obj, property);
    }

    const objName = getObjTypeName(obj);

    switch (objName) {
        case 'Array': {
            const stringifiedItems = [];

            // WE CANNOT USE Array.prototype.map: map() skips over undefined array items, but
            // JSON.stringify of an array with holes produces "null" for each hole. We MUST use
            // a loop that does not skip undefined array items.
            for (const item of obj as any[]) {
                // Each call needs an independent copy of "seenObjects"
                stringifiedItems.push(
                    actualStringify(
                        item,
                        convertUnconvertible,
                        // BRANCHING: Each item creates a different branch and therefore needs a
                        // copy, otherwise the branches would detect objects in another branch which
                        // are not a circle.
                        // Optimization: The (expensive) clone operation is only needed for objects.
                        isObject(item) ? new Map(seenObjects as Map<unknown, string>) : null,
                        property
                    )
                );
            }

            if (unorderedArray) {
                // The sort() method sorts the elements of an array IN PLACE and returns the
                // sorted array. The default sort order is ascending, built upon converting the
                // elements into strings, then comparing their sequences of UTF-16 code units
                // values.
                stringifiedItems.sort();
            }

            return '[' + stringifiedItems.join(',') + ']';
        }

        case 'Object':
            // 1. toJSON() does *not* have to return a string, so its return value still has to be
            // stringified. However, it can be anything, so we have to call the main stringifier
            // can can't call buildObjString in case toJSON() does not return an object.
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#toJSON()_behavior
            // 2. Note about circle detection: The object returned by toJSON() will probably be a
            // new (but identical) one each time so circle detection would fail, but it was already
            // done before we get here using the original object.
            return isFunction((obj as AnyObject).toJSON)
                ? actualStringify(
                      (obj as AnyObject).toJSON(),
                      convertUnconvertible,
                      seenObjects,
                      property
                  )
                : buildObjString(
                      obj as AnyObject,
                      Reflect.ownKeys(obj as AnyObject).filter(isString),
                      seenObjects as Map<unknown, null | string>,
                      convertUnconvertible,
                      property
                  );

        case 'Error':
            // About the "keys" (2nd parameter):
            // Make sure "name", "message" and "stack" are in the array because during testing
            // Firefox did not have "stack" and the name (e.g. "Error" was missing too; also
            // make sure they are in the array of properties only once, that's why we go through
            // a Set object conversion and back to an array
            return buildObjString(
                obj as AnyObject,
                [
                    // Guaranteed to be included on any platform:
                    'name',
                    'message',
                    'stack',
                    // Any additional Error object properties
                    ...Reflect.ownKeys(obj as Error).filter(isString)
                ].filter((item, index, arr) => arr.indexOf(item) === index),
                seenObjects as Map<unknown, null | string>,
                convertUnconvertible,
                property
            );

        case 'RegExp':
            return JSON.stringify(new RegExp(obj as RegExp).source);
        case 'Date':
            return '"' + (obj as Date).toJSON() + '"';

        case 'Set':
            // seenObjects always is a Set when obj is an object (null only for primitive types)
            return actualStringify(
                Array.from(obj as Set<any>),
                convertUnconvertible,
                seenObjects as Map<unknown, null | string>,
                property,
                true
            );

        case 'Map':
            return actualStringify(
                Array.from(obj as Map<any, any>),
                convertUnconvertible,
                seenObjects as Map<unknown, null | string>,
                property,
                true
            );

        case 'Null':
        case 'Undefined':
            // Same as JSON.stringify for compatibility. The special case when stringify() gets
            // "undefined" as input is handled in the exported parent function, the case where
            // object property values are undefined is handled in buildObjString()
            return 'null';

        case 'Function':
            return '[FUNCTION] ' + (obj as AnyFunction).toString();

        // case 'Function':
        case 'Promise':
            return '';

        case 'Symbol': {
            if (convertUnconvertible) {
                return `"$$$SYMBOL:${String(obj)}$$$"`;
            } else {
                // Error message parameter: We cannot pass the entire object - createError() will
                // call sortedStringify and cause a loop
                throw createError('USS-STR4', {obj: objName});
            }
        }

        default:
            // All simple types incl. special values such as NaN
            return JSON.stringify(obj);
    }
}

/**
 * A deterministic version of `JSON.stringify` that always creates the exact same string for the
 * same data. It also handles Map and Set objects for which the native method returns an empty
 * object "{}" by converting them to arrays.
 *
 * ## Features
 *
 * - Circle detection: By default and if the 2nd parameter "`convertCircles`" is `false` a
 *   circular structure results in an error. However, if the parameter is set to `true` circles
 *   will be converted into meta-information inside the JSON string. This can be used either for
 *   debug or error output, where a circle should be reported rather than preventing all output,
 *   or it can be used by a recipient to recreate the circle when reviving an object from the
 *   JSON string.
 * - Determinism is achieved by sorting object keys instead of using the natural Javascript
 *   iteration sequence determined by property insertion order.
 * - Supports everything native `JSON.stringify` does, except that...
 * - Like `JSON.stringify`, ES 2015 symbols are not supported, but unlike the standard method ours
 *   will throw an error when encountering a symbol instead of quietly treating it as `undefined`.
 * - In addition stringifies functions (relying on function object's `toString()` method), `Map`
 *   and `Set` objects, `Error` objects. To recreate the original objects a _reviver_ function
 *   fill be needed for `JSON.parse` for these non-standard objects.
 * - `Map` and `Set` objects are simply represented as arrays, so the reviver function will have
 *   to know which properties are of those types. This stringifier does not add any meta
 *   information that a reviver could use to learn about such types. Since the main purpose of
 *   this function is to stringify values of ONE objects for microdata representation this is
 *   good enough. The reviver can (and does) use the type information in the ONE object recipes.
 * - **Insertion order is lost:** The array representation of `Map` and `Set` will be sorted (each
 *   array item's string representation is used for this). The keys of objects being stringified
 *   are sorted as well. This is to solve the problem that the array representation is
 *   insertion-order dependent even though Map and Set objects are unordered, because iteration
 *   order of objects in Javascript respects insertion order. **This means that any code relying
 *   on maintaining the original insertion order will fail!**
 * - Just like `JSON.stringify`, only enumerable properties are included.
 *
 * ## Performance
 *
 * Testing on node.js 7.10 showed this function takes about twice as long as the native method.
 * On IE Edge and on Firefox 53 it took 10 times as long or worse. For comparison:
 *
 * - Package {@link https://github.com/Kikobeats/json-stringify-deterministic} took over five
 *   times as long as this code.
 * - Package {@link https://github.com/substack/json-stable-stringify} took more than twice as
 *   long.
 *
 * See {@link https://abdulapopoola.com/2017/02/27/what-you-didnt-know-about-json-stringify/}
 * for information about some idiosyncrasies of JSON conversion in JavaScript.
 * @static
 * @param {*} obj - A value or an object.
 * @returns {string} Returns a JSON string
 * @throws {Error} Throws an error if a circle is detected or if a Function, Promise or Symbol
 * is detected.
 */
export function stringify<T extends unknown>(obj: unknown): T extends void ? void : string {
    // RETURN TYPE CASTS for the conditional function return type as recommended here:
    // https://github.com/Microsoft/TypeScript/issues/22735#issuecomment-374817151

    if (obj === undefined) {
        return undefined as T extends void ? void : string;
    }

    // Use an inner function to hide the internal circle detection array parameter and for the
    // special undefined value return that is only used for the parent value.
    return actualStringify(obj, false, isObject(obj) ? new Map() : null, null) as T extends void
        ? void
        : string;
}

/**
 * Same as {@link stringify}, but when a circle is detected it is meta-encoded in the JSON
 * string result instead of throwing an error. Recreating the original object from that JSON
 * string will require a special reviver that uses the metadata to recreate the circle.
 * The main use case though is when this stringifier is used to create readable string output
 * for errors messages or for debugging. In those cases knowing that there is a circle is
 * infinitely better than getting another error from inside the original error because some
 * object that was meant to be part of the error message could not be stringified because of a
 * circle.
 * @static
 * @param {*} obj - A value or an object.
 * @returns {string} Returns a JSON string
 */
export function stringifyWithCircles<T extends unknown>(
    obj: unknown
): T extends void ? void : string {
    // RETURN TYPE CASTS for the conditional function return type as recommended here:
    // https://github.com/Microsoft/TypeScript/issues/22735#issuecomment-374817151

    if (obj === undefined) {
        return undefined as T extends void ? void : string;
    }

    // Use an inner function to hide the internal circle detection array parameter and for the
    // special undefined value return that is only used for the parent value.
    return actualStringify(obj, true, isObject(obj) ? new Map() : null, null) as T extends void
        ? void
        : string;
}
