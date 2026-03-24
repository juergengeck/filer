/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Helper functions for (ONE) objects. Most of them are only useful for ONE objects, except for
 * `createReadonlyTrackingObj()` which works for any Javascript object.
 * @module
 */

import type {OneVersionedObjectInterfaces} from '@OneObjectInterfaces';

import {createError} from '../errors.js';
import {UTF8} from '../object-recipes.js';
import {convertObjToIdMicrodata, convertObjToMicrodata} from '../object-to-microdata.js';
import type {OneIdObjectTypes, OneObjectTypes, OneVersionedObjectTypes} from '../recipes.js';
import {createCryptoHash} from '../system/crypto-helpers.js';
import {substrForceMemCopy} from './string.js';
import {isSymbol} from './type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';

/**
 * The generic type "Object" was deprecated, but having a simple word is much more readable than
 * the complex syntax that is supposed to be used instead. That is why we create our own
 * alias name.
 * @private
 * @typedef {object} AnyObject
 */
export type AnyObject = Record<string, any>;

/**
 * A string constant containing the string any ONE microdata object would start with.
 * @static
 * @type {'<div itemscope itemtype="//refin.io/'}
 */
export const MICRODATA_START = '<div itemscope itemtype="//refin.io/';

/**
 * ID objects have an attribute data-id-object="true" in their outer span tag. This replaces
 * the beginning of the outer span tag to make ONE ID object microdata from mere ONE object
 * data. The purpose of the (never written, purely virtual!) attribute is to make ID objects
 * and ID hashes different from the hash of an ordinary ONE object that happens to have only
 * the properties that also are ID properties, so that no (concrete) ONE object's SHA-256 is
 * the same as its ID hash.
 *
 * A normal object:
 *
 *   `<span itemScope itemType="//refin.io/MyType">...</span>`
 *
 * An ID object (purely virtual):
 *
 *   `<div data-id-object="true" itemScope itemType="//refin.io/MyType">...</span>`
 *
 * @static
 * @type {'data-id-object="true"'}
 */
export const ID_OBJECT_ATTR = 'data-id-object="true"';

/**
 * A string constant containing the string any ONE microdata object would start with.
 * @static
 * @type {'<div itemscope itemtype="//refin.io/'}
 */
export const ID_OBJ_MICRODATA_START = `<div ${ID_OBJECT_ATTR} itemscope itemtype="//refin.io/`;

// "<div ".length
const ID_ATTR_POS = 5;

/**
 * A helper function that takes a ONE object microdata string and returns `true` if the
 * microdata represents an ID object, `false` otherwise.
 * @static
 * @param {string} html
 * @returns {boolean}
 */
export function isIdObjMicrodata(html: string): boolean {
    return html.slice(ID_ATTR_POS, ID_ATTR_POS + ID_OBJECT_ATTR.length) === ID_OBJECT_ATTR;
}

/**
 * Given a ONE object in JS object notation, this function converts the object to microdata
 * format and then calculates and returns the crypto-hash over that string.
 * @static
 * @async
 * @param {OneObjectTypes} obj - A ONE object in Javascript object format (if it was microdata
 * format one could calculate the hash directly).
 * @returns {Promise<SHA256Hash>} Returns a promise that resolves with the SHA-256 hash
 */
export async function calculateHashOfObj<T extends OneObjectTypes>(obj: T): Promise<SHA256Hash<T>> {
    // This function will do the Error throwing for us if the object is not a valid ONE object
    const microdata = convertObjToMicrodata(obj);
    return await createCryptoHash<T>(microdata);
}

/**
 * This function takes a ONE object in Javascript object representation, converts it into an
 * ID object (i.e. it only has fields defined as ID fields in object-recipes.js for the given
 * type of ONE object), converts that into a microdata string, and then calculates the
 * crypto-hash of that string.
 * @static
 * @async
 * @param {(OneVersionedObjectTypes|OneIdObjectTypes)} obj - A versioned ONE object or an ID
 * object for such an object
 * @returns {Promise<SHA256IdHash>} ID hash of the given versioned ONE object
 */
export async function calculateIdHashOfObj<T extends OneVersionedObjectTypes | OneIdObjectTypes>(
    obj: T
): Promise<SHA256IdHash<OneVersionedObjectInterfaces[T['$type$']]>> {
    // This function will do the Error throwing for us if the object is not a valid ONE object
    const microdata = convertObjToIdMicrodata(obj);
    // NOTE: The type is so complex because this function needs to accept ID objects, but we
    // don't want SHA256IdHash to use ID objects, since those objects never really exist apart
    // from right here and their interface declarations would mess with the real ones and cause
    // problems.
    return (await createCryptoHash(microdata)) as unknown as SHA256IdHash<
        // Using OneVersionedObjectInterfaces[T['$type$']] because if we used T directly it would
        // include ID object interfaces, using this construct we always get the non-ID interface of
        // the object type
        OneVersionedObjectInterfaces[T['$type$']]
    >;
}

/**
 * This function extracts the ONE object type name string from the "itemtype" attribute of the
 * span tag surrounding ONE object data in its microdata HTML string representation.
 * The function does <i>not</i> check if the type has a known recipe in the current runtime! That
 * is why the return type only is `string` and not the much stronger `OneObjectTypeNames`.
 * @static
 * @param {string} microdata - A ONE microdata object, or the part of it at the beginning. Only
 * the full opening <span> tag up to and including its ">" closing character are needed and used.
 * @returns {string} The type string of the given microdata object, the type string
 * plus " [ID]" if it is an ID object, or 'CLOB' if the given string does not look like ONE
 * object microdata
 */
export function getTypeFromMicrodata(microdata: string): string {
    const isIdObj = isIdObjMicrodata(microdata);
    const MatchStr = isIdObj ? ID_OBJ_MICRODATA_START : MICRODATA_START;

    if (!microdata.startsWith(MatchStr)) {
        return UTF8;
    }

    // Extracts the TYPE string from the opening span tag:
    // <div itemscope itemtype="//refin.io/TYPE">
    const type = substrForceMemCopy(
        microdata,
        MatchStr.length,
        microdata.indexOf('">', MatchStr.length) - MatchStr.length
    );

    // This is not a core responsibility of this function, but if this happens then something is
    // wrong with this microdata, and we report it anyway even if it isn't our job.
    if (type === '') {
        throw createError('UO-TFM1', {microdata});
    }

    return isIdObj ? type + ' [ID]' : type;
}

/**
 * A Set object containing the strings 'boolean', 'number', 'string', 'symbol'.
 *
 * These are pure value types, i.e. unlike a reference value pointing to an object guarding just
 * those values is sufficient to protect them from being mutated.
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures}
 * @private
 * @typedef {Set<string>} BASIC_TYPES
 */
const BASIC_TYPES = new Set(['boolean', 'number', 'string', 'symbol']);

/**
 * Creates a read-only object tracking the top-level properties of another object. The use case
 * is if you need an object that is read-write in one context but read-only in another. This is
 * not possible, but we can create an object with no setters and with getters that deliver the
 * values of the respective property of the original object, as a real-time and read-only copy
 * of the object.
 * @static
 * @param {object} obj - An object whose top-level enumerable properties will be made available
 * through a new read-only object
 * @param {boolean} [includeMutableReferences=false] - Only the basic types `number`, `boolean` and
 * `string` can be tracked read-only, because objects are reference values. By default, we leave
 * them out of the tracking object because we cannot guarantee the read-only status.
 * @returns {object} A read-only object whose top-level properties track the values of the
 * top-level properties of the given object
 */
export function createReadonlyTrackingObj<T extends AnyObject>(
    obj: Readonly<T>,
    includeMutableReferences: boolean = false
): Readonly<T> {
    return Object.create(
        Object.prototype,
        Object.keys(obj).reduce((conf, key) => {
            (conf as AnyObject)[key] = {
                enumerable: true,
                configurable: false,
                get: () => {
                    if (BASIC_TYPES.has(typeof obj[key]) || includeMutableReferences) {
                        return obj[key];
                    }

                    if (Array.isArray(obj[key] as any)) {
                        const a = obj[key] as any[];
                        const trackingA = {
                            [Symbol.iterator]: a[Symbol.iterator].bind(a),
                            [Symbol.unscopables]: a[Symbol.unscopables],
                            get [Symbol.toStringTag]() {
                                return 'ReadonlyArray';
                            },
                            toString: a.toString.bind(a),
                            entries: a.entries.bind(a),
                            keys: a.keys.bind(a),
                            values: a.values.bind(a),
                            // [n]: () => a[n];
                            length: a.length,
                            concat: a.concat.bind(a),
                            join: a.join.bind(a),
                            slice: a.slice.bind(a),
                            indexOf: a.indexOf.bind(a),
                            lastIndexOf: a.lastIndexOf.bind(a),
                            every: a.every.bind(a),
                            some: a.some.bind(a),
                            forEach: a.forEach.bind(a),
                            map: a.map.bind(a),
                            filter: a.filter.bind(a),
                            reduce: a.reduce.bind(a),
                            reduceRight: a.reduceRight.bind(a),
                            findLast: a.findLast.bind(a),
                            findLastIndex: a.findLastIndex.bind(a),
                            at: a.at.bind(a),
                            flat: a.flat.bind(a),
                            flatMap: a.flatMap.bind(a),
                            includes: a.includes.bind(a),
                            find: a.find.bind(a),
                            findIndex: a.findIndex.bind(a)
                        } as any;

                        // Add support for array-like numeric index access, and instead of
                        // silently doing nothing, throw an error when somebody attempts to
                        // write to an array item (e.g. arr[2] = 'value').
                        return new Proxy(trackingA, {
                            get(_target, prop, _receiver) {
                                if (isSymbol(prop)) {
                                    return a[prop as keyof typeof a];
                                }

                                if (Number.isInteger(+prop)) {
                                    return a[+prop];
                                }

                                return a[prop as keyof typeof a];
                            },
                            set(_target, prop, _value) {
                                throw createError('UO-TRACKP2', {key: `${key}[${String(prop)}]`});
                            }
                        });
                    }

                    if ((obj[key] as any) instanceof Map) {
                        const m = obj[key] as Map<any, any>;
                        return {
                            [Symbol.iterator]: m[Symbol.iterator].bind(m),
                            get [Symbol.toStringTag]() {
                                return 'ReadonlyMap';
                            },
                            toJSON: () => ({}),
                            toString: () => '[object ReadonlyMap]',
                            forEach: m.forEach.bind(m),
                            entries: m.entries.bind(m),
                            get: m.get.bind(m),
                            has: m.has.bind(m),
                            keys: m.keys.bind(m),
                            size: m.size,
                            values: m.values.bind(m)
                        } as ReadonlyMap<any, any>;
                    }

                    if ((obj[key] as any) instanceof Set) {
                        const s = obj[key] as Set<any>;
                        return {
                            [Symbol.iterator]: s[Symbol.iterator].bind(s),
                            get [Symbol.toStringTag]() {
                                return 'ReadonlySet';
                            },
                            toJSON: () => ({}),
                            toString: () => '[object ReadonlySet]',
                            forEach: s.forEach.bind(s),
                            entries: s.entries.bind(s),
                            has: s.has.bind(s),
                            keys: s.keys.bind(s),
                            size: s.size,
                            values: s.values.bind(s),
                            union: () => s,
                            intersection: () => s,
                            difference: () => s,
                            symmetricDifference: () => s,
                            isSubsetOf: () => false,
                            isSupersetOf: () => false,
                            isDisjointFrom: () => false
                        } as ReadonlySet<any>;
                    }

                    throw createError('UO-TRACKP1', {key});
                },
                set: () => {
                    throw createError('UO-TRACKP2', {key});
                }
            };

            return conf;
        }, {} as Readonly<T>)
    );
}
