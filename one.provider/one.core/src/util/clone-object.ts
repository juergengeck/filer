/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */

/**
 * An implementation of a clone function for Javascript objects.
 * This utility module can be used by anyone, there is nothing specific to ONE in it apart from
 * putting in support for the kinds of objects we may need (which is quite exhaustive though,
 * albeit incomplete).
 * @module
 */

import type {AnyObject} from './object.js';
import {isObject} from './type-checks-basic.js';

/**
 * The inner clone function.
 * @private
 * @param {object} obj
 * @param {Map<any, object>} seenObjects
 * @returns {object} Returns a new object which is a clone of the given object's enumerable
 * properties
 */
function cloneFunc<O extends any>(obj: O, seenObjects: Map<any, O>): O {
    if (!isObject(obj)) {
        return obj;
    }

    // Don't create a new object, instead simple use the one we created when we first
    // encountered the original object. Stops recursion when encountering a cycle.
    const o = seenObjects.get(obj);

    if (o !== undefined) {
        // Just to say this explicitly: We need to return the new copy, not "obj"
        return o;
    }

    let objectClone;

    // Since we got past the recursion stopping "if" statements above we must have an object.
    const Constructor = obj.constructor;

    switch (Constructor) {
        // Implement other special objects here.
        case Array:
            // We cannot simply do Array.from(obj) because we need to look at each item in
            // the array in case it is an object, for deep cloning
            objectClone = new (Constructor as any)(obj.length);
            break;

        case Date:
            objectClone = new (Constructor as any)(obj.getTime());
            break;

        // Add any objects that can be cloned using "new Constructor" on themselves. This
        // only produces SHALLOW COPIES of Map and Set objects!
        case Map:
        case Set:
        case RegExp:
            objectClone = new (Constructor as any)(obj);
            break;

        default:
            // Object
            objectClone = new (Constructor as any)();
            break;
    }

    // For cycle detection: When we detect one, recreate it in the new object by using the
    // object previously created as clone for the given original.
    seenObjects.set(obj, objectClone);

    for (const prop of Reflect.ownKeys(obj as unknown as AnyObject)) {
        // TS issue: Symbols cannot be used as index type
        // https://github.com/microsoft/TypeScript/issues/1863
        objectClone[prop] = isObject(obj[prop as string])
            ? cloneFunc(obj[prop as string], seenObjects)
            : obj[prop as string];
    }

    return objectClone;
}

/**
 * Method for deep-cloning a Javascript object
 *
 * The use case this was designed to deal with is Javascript objects that are used to hold
 * *data*, without functions, symbols and non-standard property descriptors.
 *
 * - Handles cycles
 * - Non-enumerable properties and Symbols are ignored
 * - Inheritance, enumerability, getters/setters and function properties were not even
 *   considered (the structure returned by Object.getOwnPropertyDescriptors())
 * - Handles Arrays and Date objects
 * - Handles Map and Set objects but *only produces shallow copies of them*
 * - Handles special values such as NaN, undefined or Infinity
 * - Can easily be extended to others (like RegEx)
 *
 * ## Alternatives
 *
 * These alternatives work for simple data-only objects without cycles:
 *
 * ### Shallow clones (**fastest option!**)
 * <code>const clone = Object.assign({}, obj);</code>
 *
 * ### Deep clones
 * <code>const clone = JSON.parse(JSON.stringify(obj));</code>
 *
 * JSON.stringify does not work for special values such as Infinity, sparse arrays, NaN, undefined
 * and any built-in objects such as Date and does not deal with cycles and built-in object types
 * such as Date, Map, Set.
 *
 * ## Resources
 *
 * - &nbsp;
 * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#Examples|MDN Object.assign}
 * - &nbsp;
 * {@link https://stackoverflow.com/a/5344074/544779|SO: What is the most efficient way to deep clone an object in JavaScript?}
 * - &nbsp;
 * {@link https://stackoverflow.com/q/728360/544779|SO: How do I correctly clone a JavaScript object?}
 *
 * @static
 * @param {object} objectToBeCloned - The object to be cloned is not changed by this function
 * @returns {object} Returns a new object which is a clone of the given object's enumerable
 * properties
 */
export function clone<O extends any>(objectToBeCloned: O): O {
    // 2nd param for cycle detection: map of objects already seen -> first clone, to avoid creating
    // another clone. Creating - and hiding! - this Map is the reason why we have an inner and
    // this outer clone function.
    return cloneFunc(objectToBeCloned, new Map());
}
