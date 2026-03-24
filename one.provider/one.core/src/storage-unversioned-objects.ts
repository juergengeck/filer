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

/**
 * The type returned by SET operation(s) for ONE objects written without version history
 * mechanism. Exactly one file is created. This type is only used for write operations because
 * read operations of objects directly return the object.
 * @global
 * @typedef {object} UnversionedObjectResult
 * @property {OneObjectTypes} [obj] - The ONE object that was stored. This is only set for ONE
 * objects representable as Javascript objects. It is undefined for CLOBs and BLOBs. This link
 * to the original object is included for easier chaining of promises when the next one in the
 * chain also needs access to the object and not just the result of storing it.
 * @property {SHA256Hash} hash - The crypto hash of the microdata representation of the object
 * and also the filename.
 * @property {FileCreationStatus} status - A string constant showing whether the file
 * already existed or if it had to be created.
 */
export interface UnversionedObjectResult<
    T extends OneUnversionedObjectTypes = OneUnversionedObjectTypes
> {
    readonly obj: T;
    hash: SHA256Hash<T>;
    idHash?: void;
    status: FileCreationStatus;
    timestamp?: void;
}

import {createError} from './errors.js';
import {convertMicrodataToObject} from './microdata-to-object.js';
import {isVersionedObject} from './object-recipes.js';
import {convertObjToMicrodata} from './object-to-microdata.js';
import type {
    OneObjectInterfaces,
    OneObjectTypeNames,
    OneObjectTypes,
    OneUnversionedObjectTypes
} from './recipes.js';
import {reverseMapUpdater} from './reverse-map-updater.js';
import type {FileCreationStatus} from './storage-base-common.js';
import {setIdHash} from './storage-id-hash-cache.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {readUTF8TextFile, writeUTF8TextFile} from './system/storage-base.js';
import {logCall} from './util/object-io-statistics.js';
import {createEventSource} from './util/one-event-source.js';
import type {SHA256Hash} from './util/type-checks.js';

/**
 * Exported for plan-existing-result.js to be able to send events about previously created
 * objects. Depending on the version map update policy those may still lead to actual storage
 * state changes, and depending on the application's use of those events even no storage state
 * change, just the fact that the object was to be created (even if it already exists), may lead
 * to state application changes.
 * @private
 * @type {OneEventSource<UnversionedObjectResult>}
 */
export const unversionedObjEvent = createEventSource<UnversionedObjectResult>();

export const onUnversionedObj = unversionedObjEvent.consumer;

/**
 * Converts the input object to microdata (string) and then calls storeUTF8Clob()
 * @see {@link storage-base-common.module:ts.storeUTF8Clob|storage-base-common.storeUTF8Clob}
 * @static
 * @async
 * @param {OneObjectTypes} obj - An unversioned ONE object **which is cloned** to not be affected if
 * @param {string} microdata - When the microdata for the object is already known it can be
 * provided as another parameter, which saves the object-to-microdata conversion otherwise necessary
 * @param {SHA256Hash} hash - When the hash for the microdata is already known it can be
 * provided as another parameter, which saves the object-to-microdata conversion otherwise necessary
 * @returns {Promise<UnversionedObjectResult>} A promise with the result of the object
 * creation.
 */
export async function storeUnversionedObjectWithMicrodata<T extends OneUnversionedObjectTypes>(
    obj: T,
    microdata: string,
    hash: SHA256Hash<T>
): Promise<UnversionedObjectResult<T>> {
    if (isVersionedObject(obj)) {
        throw createError('SUO-SO1', {obj});
    }

    const status = await writeUTF8TextFile(microdata, hash);

    // Optional, an optimization. Useful when the object written is referenced by another one
    // and the reverseMapUpdater then attempts to find the ID hash because it does not
    // know whether it is looking at a "Reference" to a versioned or to an unversioned object
    // and would have to look at the object to find out.
    setIdHash(hash, null);

    // NOT ATOMIC: We update the *referenced* objects, not the one we just wrote. It is possible
    // for a reverse map read to occur between the writing of the current object here and
    // updates of the reverse maps, so the read would not include the link back to the object
    // just written. We would need to lock all referenced objects before writing the current
    // object here, at this point that seems unnecessary. TODO Is it?
    await reverseMapUpdater(obj, {hash, status});

    const objCreationResult: UnversionedObjectResult<T> = {
        obj,
        hash,
        status
    };

    unversionedObjEvent.dispatch(objCreationResult);

    return objCreationResult;
}

/**
 * Converts the input object to microdata (string) and then calls storeUTF8Clob()
 * @see {@link storage-base-common.module:ts.storeUTF8Clob|storage-base-common.storeUTF8Clob}
 * @static
 * @async
 * @param {OneObjectTypes} obj - An unversioned ONE object **which is cloned** to not be affected if
 * @returns {Promise<UnversionedObjectResult>} A promise with the result of the object
 * creation.
 */
export async function storeUnversionedObject<T extends OneUnversionedObjectTypes>(
    obj: T
): Promise<UnversionedObjectResult<T>> {
    if (isVersionedObject(obj)) {
        throw createError('SUO-SO1', {obj});
    }

    logCall('storeUnversionedObject', obj.$type$);

    const microdata = convertObjToMicrodata(obj);
    const hash = await createCryptoHash<T>(microdata);
    return storeUnversionedObjectWithMicrodata(obj, microdata, hash);
}

/**
 * Reads the microdata string of a ONE object from storage and converts it to a Javascript
 * representation.
 * @static
 * @async
 * @param {SHA256Hash} hash - A filename
 * @returns {Promise<OneObjectTypes>} Resolves with a ONE object created from the contents of the
 * file referenced by "hash" - if possible. The promise is rejected with an Error whose name
 * property is set to "FileNotFoundError" if the object does not exist.
 */
export async function getObject<T extends OneObjectTypes>(hash: SHA256Hash<T>): Promise<T> {
    // Only the asynchronous function is inside the try block, convertObjToMicrodata() is
    // not because it is synchronous and if function throws it already produces a full stack
    // trace that we don't want to add anything to.
    const microdata = await readUTF8TextFile(hash);

    // NO TYPE GUARANTEE: During runtime hashes have no type-tag, so we cannot check if the type
    // given through the type annotation is correct. Only an additional parameter available at
    // runtime can achieve type safety: see getObjectWithType
    const obj = convertMicrodataToObject(microdata) as T;
    logCall('getObject', obj.$type$);
    return obj;
}

// OVERLOADED DEFINITIONS for this function's different parameter options
export function getObjectWithType<T extends OneObjectTypes>(hash: SHA256Hash<T>): Promise<T>;
export function getObjectWithType<T extends OneObjectTypes>(
    hash: SHA256Hash<T>,
    type: '*'
): Promise<OneObjectTypes>;
export function getObjectWithType<T extends OneObjectTypeNames>(
    hash: SHA256Hash,
    type: T
): Promise<OneObjectInterfaces[T]>;
export function getObjectWithType<T extends OneObjectTypeNames>(
    hash: SHA256Hash,
    type: T[]
): Promise<OneObjectInterfaces[T]>;

/**
 * Same as {@link storage-unversioned-objects.module:ts.getObject|getObject}, but during loading
 * the microdata-to-object converter checks the type. This is especially useful when
 * programming with a type checker. Unlike not statically checking types or using type-casts and
 * assuming the loaded object has the correct type using this function provides both static
 * development-time type checks (if the type checker "TypeScript" is used) and runtime type
 * checks, which catches errors when the code is wrong about what kind of ONE object it expects
 * from a given hash.
 * @see {@link storage-unversioned-objects.module:ts.getObject|getObject}
 * @static
 * @async
 * @param {SHA256Hash} hash - A filename
 * @param {(OneObjectTypeNames|OneObjectTypeNames[])} type - Any one of the type string
 * constant from ONE object recipes for any ONE object, or an array of those names.
 * @returns {Promise<OneObjectTypes>} Resolves with a ONE object created from the contents of the
 * file referenced by "hash" - if possible. The promise is rejected with an Error whose name
 * property is set to "FileNotFoundError" if the object does not exist, or with an Error if it
 * is of the wrong type.
 */
export async function getObjectWithType<T extends OneObjectTypeNames>(
    hash: SHA256Hash<OneObjectInterfaces[T]>,
    type: T | T[] | '*' = '*'
): Promise<OneObjectTypes> {
    // Only the asynchronous function is inside the try block, microdata-to-object.js
    // convertMicrodataToObject() is not because it is synchronous and if function throws it
    // already produces a full stack trace that we don't want to add anything to.
    const microdata = await readUTF8TextFile(hash);

    // UNDOCUMENTED in the interface: "type" can also be '*' for any "type". This is a trick so
    // that this function can be called by getObjectByIdHash, where the "type" parameter is
    // optional, but where we want to benefit from the type checks if one is given. This
    // does not affect the JS behavior, this function was made extra in addition to getObject
    // instead of just having an optional "type" parameter there solely to benefit from type
    // checks, and this still works, when a type is given.
    const obj = convertMicrodataToObject(microdata, type);
    logCall('getObjectWithType', obj.$type$);
    return obj;
}
