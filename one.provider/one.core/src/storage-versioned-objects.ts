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
 * The type returned by *write* operation(s) for *versioned* ONE objects as well as by
 * {@link getObjectByIdHash} and {@link getObjectByIdObject}. This is similar to
 * {@link UnversionedObjectResult} except that it also includes the `idHash` property which
 * identifies all versions of a versioned object as well as the timestamp written into the
 * version map.
 *
 * @global
 * @typedef {object} VersionedObjectResult
 * @property {OneVersionedObjectTypes} obj - The versioned ONE object that was stored. This is only
 * set for ONE objects representable as Javascript objects.
 * @property {SHA256Hash} hash - The crypto hash of the microdata representation of the object
 * and also the filename.
 * @property {SHA256IdHash} idHash - The crypto hash of the ID-object of the ONE object.
 * @property {number} [timestamp] - Creation date-time of the for the object according to the
 * version tree entry. This is not necessarily the creation date-time of the object! Entries can
 * be made repeatedly for already existing objects to make an already existing object the most
 * current version without creating it (since it already exists...)
 * @property {FileCreationStatus} status - A string constant showing whether the file
 * already existed or if it had to be created or if a new version was added.
 */
export interface VersionedObjectResult<
    T extends OneVersionedObjectTypes = OneVersionedObjectTypes
> {
    readonly obj: T;
    hash: SHA256Hash<T>;
    idHash: SHA256IdHash<T>;
    status: FileCreationStatus;
    timestamp: undefined | number;
}

/**
 * Return result object of creating ID objects with function
 * `storeIdObject(obj: OneVersionedObjectTypes | OneIdObjectTypes)`.
 * @global
 * @typedef {object} IdFileCreation
 * @property {SHA256IdHash} idHash - The SHA-256 hash of the ID ONE object
 * @property {FileCreationStatus} status - A string constant showing whether the file
 * already existed or if it had to be created.
 */
export interface IdFileCreation<
    T extends OneVersionedObjectTypes | OneIdObjectTypes =
        | OneVersionedObjectTypes
        | OneIdObjectTypes
> {
    idHash: SHA256IdHash<T>;
    status: FileCreationStatus;
}

import type {OneIdObjectInterfaces, OneVersionedObjectInterfaces} from '@OneObjectInterfaces';
import {createError} from './errors.js';
import {extractIdObject} from './microdata-to-id-hash.js';
import {convertIdMicrodataToObject} from './microdata-to-object.js';
import {isVersionedObject} from './object-recipes.js';
import {convertObjToIdMicrodata, convertObjToMicrodata} from './object-to-microdata.js';
import type {
    VersionNode,
    VersionNodeChange,
    VersionNodeEdge
} from './recipes.js';
import type {OneIdObjectTypes, OneVersionedObjectTypes} from './recipes.js';
import {reverseMapUpdater, reverseMapUpdaterForIdObject} from './reverse-map-updater.js';
import {CREATION_STATUS, type FileCreationStatus, STORAGE} from './storage-base-common.js';
import {setIdHash} from './storage-id-hash-cache.js';
import {
    getObject,
    getObjectWithType,
    storeUnversionedObject,
    type UnversionedObjectResult
} from './storage-unversioned-objects.js';
import {createCryptoHash} from './system/crypto-helpers.js';
import {
    exists,
    readUTF8TextFile,
    writeUTF8SystemMapFile,
    writeUTF8TextFile
} from './system/storage-base.js';
import {cloneOneObject} from './util/clone-one-object.js';
import {logCall} from './util/object-io-statistics.js';
import {calculateHashOfObj, calculateIdHashOfObj} from './util/object.js';
import {createEventSource} from './util/one-event-source.js';
import {serializeWithType} from './util/promise.js';
import {ensureHash, isHash, isUnversionedObjectResult, isVersionNode, type SHA256Hash, type SHA256IdHash} from './util/type-checks.js';
import {mergeObjects} from './crdts/merge-objects.js';
import type {ChangeGraphNode, RootGraphNode} from './crdts/VersionTree.js';

const versionedObjEvent = createEventSource<VersionedObjectResult>();

export const onVersionedObj = versionedObjEvent.consumer;

/** @internal */
export const idObjEvent = createEventSource<IdFileCreation>();

export const onIdObj = idObjEvent.consumer;

/**
 * @async
 * @param {OneIdObjectTypes} obj - An ID object of a versioned object type, i.e. it has only
 * ID properties (`isId` is `true` for the property in the recipe)
 * @returns {Promise<IdFileCreation>} Returns an {@link IdFileCreation} object
 */
export async function storeIdObject<T extends OneVersionedObjectTypes | OneIdObjectTypes>(
    obj: T
): Promise<IdFileCreation<T>> {
    logCall('storeIdObject', obj.$type$);

    const idObjMicrodata = convertObjToIdMicrodata(obj);
    const idHash = (await createCryptoHash(idObjMicrodata)) as unknown as SHA256IdHash<T>;
    const result = {idHash, status: await writeUTF8TextFile(idObjMicrodata, idHash)};

    await reverseMapUpdaterForIdObject(obj, result);

    idObjEvent.dispatch(result);

    return result;
}

/**
 * Returns the ID object for the given ID hash. Those are stored under the idHash as filename
 * in the 'objects' storage space. There can be "empty" versioned objects for which only an ID
 * object exists but no concrete versions yet, so that it is possible to ID-hash-link to ID
 * objects without existing versions and still be able to find out the concrete ID properties
 * which lead to the given ID hash.
 *
 * @async
 * @param {SHA256IdHash} idHash - Hash of a ONE ID object
 * @returns {Promise<OneIdObjectTypes>} The promise is rejected with an Error whose name
 * property is set to "FileNotFoundError" if the object does not exist.
 */
export async function getIdObject<T extends OneVersionedObjectTypes | OneIdObjectTypes>(
    idHash: SHA256IdHash<T>
): Promise<OneIdObjectInterfaces[T['$type$']]> {
    const idObjMicrodata = await readUTF8TextFile(idHash);
    const obj = convertIdMicrodataToObject<T['$type$']>(idObjMicrodata);
    logCall('getIdObject', obj.$type$);
    return obj;
}

/**
 * Object writing policy:
 * a) If the exact same object already exists do nothing, just return the hash of the object.
 * b) If a version of the object exists (based on ID-object) but not exactly the same, create
 *    a new Object. Update the version map.
 * c) If there is no such object yet (based on ID-object), create a new object and its
 *    accompanying Object-map.
 * In any case, always return both hashes for the object and the id-object.
 *
 * 1 Calculate object-ID (hash) from the object (obj => objID)
 *   The object's id hash also is the name of the version map hash
 * 2 Store object (obj => hash)
 * 3 Attempt to update the version map. Its filename is fixed based on the empty version map and
 * the
 *   respective ID-object hash. If this succeeds we know the map and therefore previous
 *   version(s) of the object exist. The promise rejects when the version map does not exist.
 * IF version map does NOT exist:
 *   4 Create a new version map.
 * END
 *
 * @internal
 * @async
 * @param {OneVersionedObjectTypes} obj - A versioned ONE object.
 * @param {string} microdata - When the microdata for the object is already known it can be
 * provided as another parameter, which saves the object-to-microdata conversion otherwise necessary
 * @param {SHA256Hash} hash - When the hash for the microdata is already known it can be
 * provided as another parameter, which saves the object-to-microdata conversion otherwise necessary
 * @returns {Promise<VersionedObjectResult>} Resolves with the crypto hashes of the object
 * and of the accompanying (virtual) ID- and (real) object. The "status" is CREATION_STATUS.NEW
 * if this particular object is new, CREATION_STATUS.EXISTS if it already exists.
 */
export async function storeVersionedObjectWithMicrodataNoMerge<T extends OneVersionedObjectTypes>(
    obj: T,
    microdata: string,
    hash: SHA256Hash<T>
): Promise<VersionedObjectResult<T> & {timestamp: number}> {
    if (!isVersionedObject(obj)) {
        throw createError('SVO-SO2', {obj});
    }

    // This is the ID hash of the object, not the hash of the object. The version map that
    // stores the hashes of all versions of this object is stored using this hash as map name.
    const objId = (await createCryptoHash(
        // This is a string: We know we have a versioned object, so we will not get undefined
        extractIdObject(microdata) as string
    )) as unknown as SHA256IdHash<T>;

    async function serializedStore(): Promise<VersionedObjectResult<T> & {timestamp: number}> {
        await storeIdObject(obj);

        // THE MAIN STEP. If this object already exists the promise will be *rejected* with an
        // error, so subsequent "then()" steps chained to this one below are not executed. We don't
        // check for existence of the object because we subscribe to the node.js philosophy of not
        // adding a useless I/O call when we get the exact same information when we try to write to
        // it anyway. We don't tell storeUTF8Clob() to ignore EEXIST errors because when an object
        // already exists we don't want to update the version map, but we simply do nothing.
        const status = await writeUTF8TextFile(microdata, hash);

        // Optional, an optimization. If we don't put it into the cache, and it is queried, it would
        // have to be loaded from storage and calculated. We assume that there is a significant
        // probability that when we store a versioned object its ID hash will be needed very soon,
        // for example to write reverse maps when shortly hereafter another object is written
        // referencing this one.
        setIdHash(hash, objId);

        // The reverse and version map updates are independent and can be run in parallel.
        await reverseMapUpdater(obj, {hash, status});

        // We need to copy the object in order to prevent that modifications on the
        // returned value will modifiy the original
        return {
            obj: cloneOneObject(obj),
            hash,
            idHash: objId,
            status,
            timestamp: Date.now()
        };
    }

    return serializeWithType(`ID ${objId}`, serializedStore);
}

/**
 * Store a versioned object without version tree management or merging.
 * 
 * This function stores the object data and creates the necessary version nodes but does not
 * perform any merging with existing versions. It's primarily used internally by other storage
 * functions when you want to bypass the merge logic.
 * 
 * **Important**: This function does not handle version conflicts or merging. If you need
 * conflict resolution, use `storeVersionedObject` with appropriate `storeAs` parameter instead.
 * 
 * @example
 * ```typescript
 * // Store an object without merge logic
 * const result = await storeVersionedObjectNoMerge({
 *     $type$: 'Person',
 *     name: 'John Doe',
 *     email: 'john@example.com'
 * });
 * 
 * // The result includes a timestamp
 * console.log('Stored at:', new Date(result.timestamp));
 * ```
 * 
 * @example
 * ```typescript
 * // When storing the same object twice, it returns the existing one
 * const obj = { $type$: 'Group', name: 'Developers' };
 * const first = await storeVersionedObjectNoMerge(obj);
 * const second = await storeVersionedObjectNoMerge(obj);
 * 
 * // Both results have the same hash
 * console.log(first.hash === second.hash); // true
 * ```
 * 
 * @async
 * @param {OneVersionedObjectTypes} obj - A complete versioned ONE object to store.
 * @returns {Promise<VersionedObjectResult & {timestamp: number}>} Resolves with the crypto 
 * hashes, metadata, and a guaranteed timestamp. If the exact same object already exists, 
 * returns the existing result with a timestamp.
 */
export async function storeVersionedObjectNoMerge<
    T extends OneVersionedObjectTypes
>(
    obj: T
): Promise<VersionedObjectResult<T> & {timestamp: number}> {
    if (!isVersionedObject(obj)) {
        throw createError('SVO-SO2', {obj});
    }

    const microdata = convertObjToMicrodata(obj);
    const hash = await createCryptoHash<T>(microdata);
    const idHash = await calculateIdHashOfObj(obj) as unknown as SHA256IdHash<T>;

    // Check if current version is the same as the object being stored
    try {
        const currentVersionHash = await getCurrentVersionHash(idHash);
        if (currentVersionHash === hash) {
            // Return existing object if it's the same
            const existingResult = await getObjectByIdHash(idHash);
            return {
                ...existingResult,
                timestamp: existingResult.timestamp ?? Date.now()
            } as unknown as VersionedObjectResult<T> & {timestamp: number};
        }
    } catch (e) {
        // If no current version exists, continue with normal storage
        if (e.name !== 'FileNotFoundError') {
            throw e;
        }
    }

    return storeVersionedObjectWithMicrodataNoMerge(obj, microdata, hash);
}

/**
 * Store a change versioned object that represents a sequential change from the current version.
 * 
 * **Version Tree Behavior:**
 * - If a current version exists: Creates a `VersionNodeChange` pointing to the current version
 * - If no current version exists: Creates a `VersionNodeEdge` as the initial version
 * 
 * This function is typically used for local modifications that build upon the current version
 * of an object. It automatically handles version tree updates and merges the change with the
 * current state using CRDT algorithms when necessary.
 *
 * @example
 * ```typescript
 * // Store a local change to an existing object
 * const result = await storeVersionObjectAsChange({
 *     $type$: 'Person',
 *     name: 'John Doe',
 *     email: 'john.doe@example.com'
 * });
 * 
 * // The result contains the merged state if conflicts were resolved
 * console.log('Updated person:', result.obj.name);
 * ```
 * This will result in a VersionNodeChange being created, pointing to the current version
 * or a VersionNodeEdge if no current version is available.
 * 
 * @example
 * ```typescript
 * // Creating the first version of an object
 * const firstVersion = await storeVersionObjectAsChange({
 *     $type$: 'Group',
 *     name: 'Development Team'
 * });
 * // This creates a VersionNodeEdge since no current version exists
 * 
 * // Adding a change to the existing object
 * const updatedVersion = await storeVersionObjectAsChange({
 *     $type$: 'Group',
 *     name: 'Senior Development Team'
 * });
 * // This creates a VersionNodeChange pointing to the previous version
 * ```
 * 
 * @async
 * @param {OneVersionedObjectTypes} obj - A versioned ONE object representing a local change.
 * @returns {Promise<VersionedObjectResult>} Resolves with the crypto hashes and metadata.
 * The result may contain a merged version if conflicts were resolved during storage.
 */
export async function storeVersionObjectAsChange<
    T extends OneVersionedObjectTypes
>(
    obj: T
): Promise<VersionedObjectResult<T>> {
    if (!isVersionedObject(obj)) {
        throw createError('SVO-SO2', {obj});
    }

    const microdata = convertObjToMicrodata(obj);
    const hash = await createCryptoHash<T>(microdata);
    const idHash = await calculateIdHashOfObj(obj) as unknown as SHA256IdHash<T>;

    // Check if current version is the same as the object being stored
    try {
        const currentVersionHash = await getCurrentVersionHash(idHash);
        if (currentVersionHash === hash) {
            // Return existing object if it's the same
            return await getObjectByIdHash(idHash);
        }
    } catch (e) {
        // If no current version exists, continue with normal storage
        if (e.name !== 'FileNotFoundError') {
            throw e;
        }
    }

    const dataResult = await storeVersionedObjectWithMicrodataNoMerge(obj, microdata, hash);

    return mergeVersionAsChangeWithCurrent(dataResult);
}

/**
 * Store a merge versioned object that represents a new version tree to be merged.
 * 
 * **Version Tree Behavior:**
 * - If a current version exists: Creates a `VersionNodeEdge` for the new object, then a 
 *   `VersionNodeMerge` pointing to both the current version and the newly created edge
 * - If no current version exists: Creates a `VersionNodeEdge` as the initial version
 * 
 * This function is typically used for objects received from remote sources (like sync operations)
 * that need to be merged with the current state. It handles the complexity of merging different
 * version trees and resolving conflicts using CRDT algorithms.
 *
 * @example
 * ```typescript
 * // Store a remote object that needs to be merged
 * const result = await storeVersionObjectAsMerge({
 *     $type$: 'Person',
 *     name: 'Jane Smith',
 *     email: 'jane.smith@example.com'
 * });
 * 
 * // The result contains the merged state
 * console.log('Merged person:', result.obj.name);
 * ```
 * 
 * @example
 * ```typescript
 * // Typical sync scenario - merging remote changes
 * const localVersion = await storeVersionObjectAsChange({
 *     $type$: 'Document',
 *     title: 'Local Changes',
 *     content: 'Local content'
 * });
 * 
 * // Later, a remote version comes in that needs to be merged
 * const mergedResult = await storeVersionObjectAsMerge({
 *     $type$: 'Document', 
 *     title: 'Remote Changes',
 *     content: 'Remote content'
 * });
 * 
 * // The result contains the merged state of both local and remote changes
 * console.log('Final merged document:', mergedResult.obj);
 * ```
 * 
 * @async
 * @param {OneVersionedObjectTypes} obj - A versioned ONE object from a remote source.
 * @returns {Promise<VersionedObjectResult>} Resolves with the crypto hashes and metadata.
 * The result contains the final merged state after conflict resolution.
 */
export async function storeVersionObjectAsMerge<
    T extends OneVersionedObjectTypes
>(
    obj: T
): Promise<VersionedObjectResult<T>> {
    if (!isVersionedObject(obj)) {
        throw createError('SVO-SO2', {obj});
    }

    const microdata = convertObjToMicrodata(obj);
    const hash = await createCryptoHash<T>(microdata);
    const idHash = await calculateIdHashOfObj(obj);

    // Check if current version is the same as the object being stored
    try {
        const currentVersionHash = await getCurrentVersionHash(idHash);
        if (String(currentVersionHash) === String(hash)) {
            // Return existing object if it's the same
            return (await getObjectByIdHash(idHash)) as unknown as VersionedObjectResult<T>;
        }
    } catch (e) {
        // If no current version exists, continue with normal storage
        if (e.name !== 'FileNotFoundError') {
            throw e;
        }
    }

    const dataResult = await storeVersionedObjectWithMicrodataNoMerge(obj, microdata, hash);

    return mergeVersionAsEdgeWithCurrent(dataResult);
}

/**
 * Constants for specifying how to store versioned objects.
 * 
 * @example
 * ```typescript
 * // Store as local change (default)
 * await storeVersionedObject(obj, STORE_AS.CHANGE);
 * 
 * // Store as remote merge
 * await storeVersionedObject(obj, STORE_AS.MERGE);
 * 
 * // Store without version tree management
 * await storeVersionedObject(obj, STORE_AS.NO_VERSION_MAP);
 * ```
 */
export const STORE_AS = {
    /** 
     * Store as a local sequential change. Creates a VersionNodeChange that represents
     * a local modification building upon the current version. This is the default behavior.
     */
    CHANGE: 'change',
    
    /** 
     * Store as a remote object to merge. Creates a VersionNodeEdge that represents
     * a version coming from a remote source that needs to be merged with the current state.
     */
    MERGE: 'merge',
    
    /** 
     * Store without version tree management. The object is stored but no version
     * nodes or version tree updates are performed.
     */
    NO_VERSION_MAP: 'no-version-map'
} as const;

/**
 * Store a versioned object with explicit source specification and advanced type inference.
 * 
 * This function provides two overloads for optimal TypeScript type inference:
 * 
 * **Overload 1: Type inference from $type$ property**
 * When you provide an object with a `$type$` property, TypeScript will automatically
 * infer the full interface type from `OneVersionedObjectInterfaces`, ensuring that
 * the returned object includes all properties (both required and optional) of the
 * target interface.
 * 
 * **Overload 2: Generic type parameter**
 * For backward compatibility, you can still use the function with explicit type
 * parameters or when TypeScript can infer the type from the provided object.
 * 
 * @example
 * ```typescript
 * // Example 1: Type inference from $type$ property
 * // TypeScript infers the full Test$Optional interface
 * const result = await storeVersionedObject({
 *     $type$: 'Test$Optional',
 *     id: 'user-123'
 *     // Optional properties like 'value' and 'x' are available in result.obj
 * });
 * 
 * // result.obj has type Test$Optional with all properties:
 * // - id: string (required)
 * // - value?: string (optional)
 * // - x?: Set<{a: string}> (optional)
 * const optionalValue: string | undefined = result.obj.value;
 * const optionalX: Set<{a: string}> | undefined = result.obj.x;
 * ```
 * 
 * @example
 * ```typescript
 * // Example 2: Storing as a local change (default behavior)
 * const localChange = await storeVersionedObject({
 *     $type$: 'Person',
 *     name: 'John Doe',
 *     email: 'john@example.com'
 * }, STORE_AS.CHANGE);
 * ```
 * This will result in a VersionNodeChange being created, pointing to the current version
 * or a VersionNodeEdge if no current version is available.
 * 
 * @example
 * ```typescript
 * // Example 3: Storing as a remote merge
 * const mergeResult = await storeVersionedObject({
 *     $type$: 'Person',
 *     name: 'Jane Smith',
 *     email: 'jane@example.com'
 * }, STORE_AS.MERGE);
 * ```
 * This will result in a VersionNodeEdge being created for the current object,
 * than a VersionNodeMerge, pointing to the current version and the newly created edge
 * or a VersionNodeEdge if no current version is available.
 * 
 * @example
 * ```typescript
 * // Example 4: Storing without version map management
 * const noVersionResult = await storeVersionedObject({
 *     $type$: 'Group',
 *     name: 'Developers'
 * }, STORE_AS.NO_VERSION_MAP);
 * ```
 * This will result in a Stored object, without any version tree management (no nodes are created).
 * 
 * @async
 * @param {object} obj - A versioned ONE object with $type$ property.
 * @param {'change' | 'merge' | 'no-version-map'} [storeAs='change'] - How to store the object:
 * - `'change'`: Store as a local sequential change (creates VersionNodeChange or VersionNodeEdge)
 * - `'merge'`: Store as a remote object to merge (creates VersionNodeEdge and then VersionNodeMerge with current version or VersionNodeEdge if no current version is available)
 * - `'no-version-map'`: Store without version tree management (no nodes are created)
 * @returns {Promise<VersionedObjectResult>} Resolves with the crypto hashes and metadata.
 * The `obj` property in the result contains the full interface type with all properties.
 */
export async function storeVersionedObject<K extends keyof OneVersionedObjectInterfaces>(
    obj: {$type$: K} & Omit<OneVersionedObjectInterfaces[K], '$type$'>,
    storeAs?: typeof STORE_AS[keyof typeof STORE_AS]
): Promise<VersionedObjectResult<OneVersionedObjectInterfaces[K]>>;

/**
 * Store a versioned object with explicit source specification (generic overload).
 * 
 * This overload provides backward compatibility and can be used when you have
 * a complete object or when you want to explicitly specify the type parameter.
 * 
 * @async
 * @param {OneVersionedObjectTypes} obj - A complete versioned ONE object.
 * @param {'change' | 'merge' | 'no-version-map'} [storeAs='change'] - How to store the object.
 * @returns {Promise<VersionedObjectResult>} Resolves with the crypto hashes and metadata.
 */
export async function storeVersionedObject<T extends OneVersionedObjectTypes>(
    obj: T,
    storeAs?: typeof STORE_AS[keyof typeof STORE_AS]
): Promise<VersionedObjectResult<T>>;

export async function storeVersionedObject<T extends OneVersionedObjectTypes>(
    obj: T,
    storeAs: typeof STORE_AS[keyof typeof STORE_AS] = STORE_AS.CHANGE
): Promise<VersionedObjectResult<T>> {
    if (storeAs === STORE_AS.CHANGE) {
        return storeVersionObjectAsChange(obj);
    } else if (storeAs === STORE_AS.MERGE) {
        return storeVersionObjectAsMerge(obj);
    } else {
        return storeVersionedObjectNoMerge(obj);
    }
}

/**
 * Returns the latest version of the object specified by the ID hash
 * or a rejected promise if there is no such object.
 *
 * @async
 * @param {SHA256IdHash} idHash - Hash of a ONE ID object
 * @returns {Promise<VersionedObjectResult>} The promise is rejected with an Error whose name
 * property is set to "FileNotFoundError" if the object does not exist, or with an Error if it
 * is of the wrong type.
 */
export async function getObjectByIdHash<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>
): Promise<VersionedObjectResult<T>> {
    const versionNode = await getCurrentVersionNode(idHash);
    const data = await getObject(versionNode.obj.data);
    const dataMicrodata = convertObjToMicrodata(data);
    const dataHash = await createCryptoHash<T>(dataMicrodata);


    return {
        obj: data,
        hash: dataHash,
        idHash,
        status: CREATION_STATUS.EXISTS,
        timestamp: versionNode.obj.creationTime
    };
}

/**
 * Frontend for getObjectByIdHash() that accepts an ID object and calculates its crypto hash
 * before calling that function. Returns the latest version of the object specified by the
 * ID hash, or a rejected promise if there is no such object.
 *
 * @async
 * @param {(OneVersionedObjectTypes)} obj - A versioned ONE object of type
 * `<T>` which is used to create its ID hash. Note that it does not have to be an ID object,
 * i.e. it can have more properties than just ID properties, they will be ignored.
 * @returns {Promise<VersionedObjectResult<OneVersionedObjectTypes>>} The promise is rejected with an Error whose name
 * property is set to "FileNotFoundError" if the object does not exist.
 */
export async function getObjectByIdObj<T extends OneVersionedObjectTypes | OneIdObjectTypes>(
    obj: T
): Promise<VersionedObjectResult<OneVersionedObjectInterfaces[T['$type$']]>> {
    const idHash = await calculateIdHashOfObj<T>(obj);
    return getObjectByIdHash(idHash);
}

export const MERGE_AS = {
    REMOTE: 'edge',
    LOCAL: 'change'
} as const;

/**
 * Merge a version with the current storage
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} mergeDataResult - Data to merge
 * @param {'edge' | 'change'} as - If 'edge', creates VersionNodeEdge; if 'change', creates VersionNodeChange
 * @returns {Promise<VersionedObjectResult<T>>}
 */
export async function mergeVersionWithCurrent<T extends OneVersionedObjectTypes>(
    mergeDataResult: VersionedObjectResult<T>,
    mergeAs: typeof MERGE_AS[keyof typeof MERGE_AS]
): Promise<VersionedObjectResult<T>> {
    let currentNode: UnversionedObjectResult<VersionNode<T>>;

    const results = await serializeWithType(
        `VersionMerge${mergeDataResult.idHash}`,
        async (): Promise<{dataResult: VersionedObjectResult<T>; new: boolean}> => {
            try {
                currentNode = await getCurrentVersionNode(mergeDataResult.idHash);
            } catch (e) {
                if (e.name !== 'FileNotFoundError') {
                    throw e;
                }

                // EXIT CONDITION 1: If no current version exists => Set the current version as edge
                const versionNode = await storeVersionNode(mergeDataResult, true);
                await writeUTF8SystemMapFile(
                    versionNode.hash,
                    mergeDataResult.idHash,
                    STORAGE.VHEADS
                );

                return {dataResult: mergeDataResult as VersionedObjectResult<T>, new: true};
            }

            // Create version node based on as parameter
            const mergeNode = await storeVersionNode(mergeDataResult, mergeAs === MERGE_AS.REMOTE);

            if (currentNode.hash === mergeNode.hash) {
                // EXIT CONDITION 2: to-merge and current version are the same => just return
                return {dataResult: mergeDataResult as VersionedObjectResult<T>, new: false};
            }

            const mergeResult = await mergeObjects(
                currentNode.hash,
                mergeNode.hash,
                mergeDataResult.obj.$type$
            );

            if (mergeResult.alreadyMerged) {
                if (mergeResult.newNodeHash === currentNode.hash) {
                    // EXIT CONDITION 3: The current version already contained the to-merge
                    // version => do nothing
                    return {
                        dataResult: mergeResult.result as VersionedObjectResult<T>,
                        new: false
                    };
                }
                // EXIT CONDITION 4: The to-merge version already contained the current
                // version => set the to-merge version as current version
                mergeResult.result.status = 'new';
                await writeUTF8SystemMapFile(
                    mergeResult.newNodeHash,
                    mergeDataResult.idHash,
                    STORAGE.VHEADS
                );

                return {
                    dataResult: mergeResult.result as VersionedObjectResult<T>,
                    new: true
                };
            }

            // If we are here, a real merge happened and we need to calculate the new node. This can
            // either be a new merge node, or probably one of the existing change nodes

            // Compute the new node children
            const nodes = new Set([
                ...(currentNode.obj.$type$ === 'VersionNodeEdge'
                    ? [currentNode.hash as SHA256Hash<VersionNodeEdge<T>>]
                    : [currentNode.hash as SHA256Hash<VersionNodeChange<T>>]),
                ...(mergeNode.obj.$type$ === 'VersionNodeEdge'
                    ? [mergeNode.hash as SHA256Hash<VersionNodeEdge<T>>]
                    : [mergeNode.hash as SHA256Hash<VersionNodeChange<T>>])
            ]);

            // Filter the new node children that are also covered by another node children
            // be being a predecessor to another one. This prevents redundant edges in the graph.
            // Sort them, so that all instances will get the same result.
            let remainingNodeHashes;
            let depth;
            let creationTime;

            {
                const tree = mergeResult.tree;

                const treeNodes = [...nodes].map(
                    n => tree.nodeByHash(n) as ChangeGraphNode<T> | RootGraphNode<T>
                );

                const remainingNodes = treeNodes.filter(
                    node =>
                        tree.findSucceedingNodesChangeOrRootOnly(node, n =>
                            n.hash === node.hash ? false : nodes.has(n.hash as SHA256Hash<VersionNodeEdge<T>> | SHA256Hash<VersionNodeChange<T>>)
                        ).length === 0
                );

                remainingNodeHashes = remainingNodes.map(n => n.hash);
                depth = Math.max(...remainingNodes.map(n => n.depth)) + 1;
                creationTime = Math.max(...remainingNodes.map(n => n.obj.creationTime));
                remainingNodeHashes.sort();
            }

            // Write / compute new node
            let newNodeHash: SHA256Hash<VersionNode<T>>;

            if (remainingNodeHashes.length > 1) {
                newNodeHash = (
                    await storeUnversionedObject({
                        $type$: 'VersionNodeMerge',
                        depth,
                        creationTime,
                        data: mergeResult.result.hash,
                        nodes: new Set(remainingNodeHashes)
                    })
                ).hash as SHA256Hash<VersionNode<T>>;
                await writeUTF8SystemMapFile(
                    newNodeHash,
                    mergeResult.result.idHash,
                    STORAGE.VHEADS
                );
            } else {
                newNodeHash = remainingNodeHashes[0] as SHA256Hash<VersionNode<T>>;
            }

            // EXIT CONDITION 5: A proper merge was done
            await writeUTF8TextFile(newNodeHash, mergeDataResult.idHash, STORAGE.VHEADS);
            return {dataResult: mergeResult.result as VersionedObjectResult<T>, new: true};
        }
    );

    // We need to do this outside of the serializeWithType!
    if (results.new) {
        results.dataResult.status = 'new';
        versionedObjEvent.dispatch(results.dataResult);
    }

    return results.dataResult;
}

/**
 * Merge a local change version with the current storage (creates VersionNodeChange)
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} mergeDataResult - Data to merge as a local change
 * @returns {Promise<VersionedObjectResult<T>>}
 */
export async function mergeVersionAsChangeWithCurrent<T extends OneVersionedObjectTypes>(
    mergeDataResult: VersionedObjectResult<T>
): Promise<VersionedObjectResult<T>> {
    return mergeVersionWithCurrent(mergeDataResult, MERGE_AS.LOCAL);
}

/**
 * Merge a remote version with the current storage (creates VersionNodeEdge)
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} mergeDataResult - Data to merge as a remote object
 * @returns {Promise<VersionedObjectResult<T>>}
 */
export async function mergeVersionAsEdgeWithCurrent<T extends OneVersionedObjectTypes>(
    mergeDataResult: VersionedObjectResult<T>
): Promise<VersionedObjectResult<T>> {
    return mergeVersionWithCurrent(mergeDataResult, MERGE_AS.REMOTE);
}

/**
 * Get the current VersionNode
 *
 * @async
 * @param {SHA256IdHash<T>} idHash
 * @returns {Promise<VersionNode<T>>}
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file cannot be found
 */
export async function getCurrentVersionNode<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>
): Promise<UnversionedObjectResult<VersionNode<T>>> {
    const versionHeadNodeHash = await readUTF8TextFile(idHash, STORAGE.VHEADS);
    const versionHeadNodeObj = await getObject(ensureHash<VersionNode<T>>(versionHeadNodeHash));

    const objMicrodata = convertObjToMicrodata(versionHeadNodeObj);
    const objHash = await createCryptoHash<VersionNode<T>>(objMicrodata);

    return {
        obj: versionHeadNodeObj,
        hash: objHash,
        status: CREATION_STATUS.EXISTS
    };
}

/**
 * Get the version of the object
 *
 * @async
 * @param {SHA256Hash<VersionNode<T>> | SHA256Hash<T> | VersionNode<T> | UnversionedObjectResult<VersionNode<T>>} hashOrNode - The hash of the version node or the version node itself
 * @returns {Promise<T>}
 */
export async function getVersion<T extends OneVersionedObjectTypes>(
    hashOrNode: SHA256Hash<VersionNode<T>> | SHA256Hash<T> | VersionNode<T> | UnversionedObjectResult<VersionNode<T>>
): Promise<T> {
    if (isHash(hashOrNode)) {
        const obj = await getObject(hashOrNode as SHA256Hash<any>);
        if(!isVersionNode(obj)) {
            return obj as T;
        }
        // is version node
        const versionNode = obj as VersionNode<T>;
        return await getObject(versionNode.data);
    }

    if (isUnversionedObjectResult(hashOrNode)) {
        return await getObject(hashOrNode.obj.data);
    }

    return await getObject(hashOrNode.data);
}

/**
 * Get the current version hash of the object
 *
 * @async
 * @param {SHA256IdHash<T>} idHash - The hash of the id-object
 * @returns {Promise<SHA256Hash<T>>}
 */
export async function getCurrentVersionHash<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>
): Promise<SHA256Hash<T>> {
    const versionNode = await getCurrentVersionNode(idHash);
    return versionNode.obj.data;
}

/**
 * Get the version hash of the object
 *
 * @async
 * @param {SHA256Hash<VersionNode<T>> | VersionNode<T> | UnversionedObjectResult<VersionNode<T>>} hashOrNode - The hash of the version node or the version node itself
 * @returns {Promise<SHA256Hash<T>>}
 */
export async function getVersionHash<T extends OneVersionedObjectTypes>(
    hashOrNode: SHA256Hash<VersionNode<T>> | VersionNode<T> | UnversionedObjectResult<VersionNode<T>>
): Promise<SHA256Hash<T>> {
    return calculateHashOfObj(await getVersion(hashOrNode));
}

/**
 * Get the current version of the object
 *
 * @async
 * @param {SHA256IdHash<T>} idHash - The hash of the id-object
 * @returns {Promise<T>}
 */
export async function getCurrentVersion<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>
): Promise<T> {
    const versionNode = await getCurrentVersionNode(idHash);
    const obj = await getObject<T>(versionNode.obj.data as SHA256Hash<T>);
    return obj;
}

/**
 * Get a VersionNode
 *
 * @async
 * @param {SHA256Hash<VersionNode<T>>} hash
 * @returns {Promise<VersionNode<T>>}
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file cannot be found
 */
export async function getVersionNodeByNodeHash<T extends OneVersionedObjectTypes>(
    hash: SHA256Hash<VersionNode<T>>
): Promise<UnversionedObjectResult<VersionNode<T>>> {
    const obj = await getObject(hash);
    const objMicrodata = convertObjToMicrodata(obj);
    const objHash = await createCryptoHash<VersionNode<T>>(objMicrodata);

    return {
        obj,
        hash: objHash,
        status: CREATION_STATUS.EXISTS
    };
}

/**
 * Get a VersionNode
 *
 * @async
 * @param {SHA256Hash<T>} hash
 * @returns {Promise<VersionNode<T>>}
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file cannot be found
 */
export async function getVersionNodeByDataHash<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>,
    hash: SHA256Hash<T>
): Promise<UnversionedObjectResult<VersionNode<T>> | undefined> {

    const versionNode = await getCurrentVersionNode(idHash);
    if(versionNode.obj.data === hash) {
        return versionNode;
    }

    const versionNodeHash = await _getVersionNodeHashForDataHash(versionNode.hash, hash);
    if(versionNodeHash === undefined) {
        return undefined;
    }

    return await getVersionNodeByNodeHash(versionNodeHash);
}

/**
 * Save the version object as VersionNodeChange
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} version - the last version of the object
 * @param {boolean} [edge=false] - Optional. Default: false. skips the previous VersionNode check and saves the object as edge of the version tree
 * @returns {Promise<UnversionedObjectResult<VersionNodeChange<T>>>}
 */
async function storeVersionNode<T extends OneVersionedObjectTypes>(
    version: VersionedObjectResult<T>,
    edge: boolean = false
): Promise<UnversionedObjectResult<VersionNodeChange<T> | VersionNodeEdge<T>>> {
    if (edge) {
        return await storeVersionNodeEdge(version);
    }

    try {
        const previousVersionNode = await getCurrentVersionNode(version.idHash);
        return storeVersionNodeChange(version, previousVersionNode);
    } catch (e) {
        if (e.name !== 'FileNotFoundError') {
            throw e;
        }

        return await storeVersionNodeEdge(version);
    }
}

/**
 * Save the version object as VersionNodeChange
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} version - the last version of the object
 * @param {UnversionedObjectResult<VersionNode<T>>} previousVersionNode - the previous version node
 * @returns {Promise<UnversionedObjectResult<VersionNodeChange<T>>>}
 */
export async function storeVersionNodeChange<T extends OneVersionedObjectTypes>(
    version: VersionedObjectResult<T>,
    previousVersionNode: UnversionedObjectResult<VersionNode<T>>
): Promise<UnversionedObjectResult<VersionNodeChange<T>>> {
    return await storeUnversionedObject({
        $type$: 'VersionNodeChange',
        depth: previousVersionNode.obj.depth + 1,
        data: version.hash,
        prev: previousVersionNode.hash,
        creationTime: version.timestamp ?? Date.now()
    });
}

/**
 * Save the version object as VersionNodeEdge
 *
 * @internal
 * @async
 * @param {VersionedObjectResult<T>} version - the last version of the object
 * @returns {Promise<UnversionedObjectResult<VersionNodeEdge<T>>>}
 */
export async function storeVersionNodeEdge<T extends OneVersionedObjectTypes>(
    version: VersionedObjectResult<T>
): Promise<UnversionedObjectResult<VersionNodeEdge<T>>> {
    return await storeUnversionedObject({
        $type$: 'VersionNodeEdge',
        depth: 0,
        data: version.hash,
        creationTime: version.timestamp ?? Date.now()
    });
}

/**
 * Get the last node from an array of nodes
 *
 * @param {Array<VersionNode<T>>} nodes - The array of nodes
 * @returns {VersionNode<T>} The last node
 */
export function getLastNodeFromArray<T extends OneVersionedObjectTypes>(nodes: VersionNode<T>[]): VersionNode<T> {
    return nodes.reduce(
        (maxDepthNode, node) => (node.depth > maxDepthNode.depth ? node : maxDepthNode),
        nodes[0]
    );
}

/**
 * Get the versions nodes of the version node and all its predecessors
 *
 * @async
 * @param {SHA256IdHash<T>} idHash - The hash of the id-object
 * @returns {Promise<Array<VersionNode<T>>>}
 */
export async function getVersionsNodes<T extends OneVersionedObjectTypes>(idHash: SHA256IdHash<T>): Promise<Array<VersionNode<T>>> {
    const versionsNodeHashes = await getVersionsNodeHashes(idHash);

    if (versionsNodeHashes === undefined) {
        throw new Error('No versions node hashes found');
    }

    return Promise.all(
        versionsNodeHashes.map(async hash => {
            return (await getVersionNodeByNodeHash(hash)).obj;
        })
    );
}

/**
 * Get the versions hashes of the version node and all its predecessors
 *
 * @async
 * @param {SHA256IdHash<T>} idHash - The hash of the id-object
 * @param {T} type - The type of the object
 * @returns {Promise<Array<SHA256Hash<T>>>}
 */
export async function getVersionsHashes<T extends OneVersionedObjectTypes>(idHash: SHA256IdHash<T>): Promise<Array<SHA256Hash<T>>> {
    return (await getVersionsNodes(idHash)).map(node => node.data);
}

/**
 * Get the versions node hashes of the version node and all its predecessors
 *
 * @async
 * @param {SHA256IdHash<T>} idHash - The hash of the id-object
 * @param {SHA256Hash<VersionNode<T>>} [beforeVersionNodeHash] - Optional. The hash of the version node above which the version hashes should not be included
 * @returns {Promise<Array<SHA256Hash<VersionNode<T>>> | undefined>}
 */
export async function getVersionsNodeHashes<T extends OneVersionedObjectTypes>(
    idHash: SHA256IdHash<T>,
    beforeVersionNodeHash?: SHA256Hash<VersionNode<T>>
): Promise<Array<SHA256Hash<VersionNode<T>>> | undefined> {
    if (!(await exists(idHash, STORAGE.VHEADS))) {
        return undefined;
    }

    const versionNode = await getCurrentVersionNode(idHash);
    return (await _getVersionsNodeHashes(versionNode.hash as SHA256Hash<VersionNode<T>>, beforeVersionNodeHash)).reverse();
}

/**
 * Get the versions node hashes of the version node and all its predecessors
 *
 * @internal
 * @async
 * @param {SHA256Hash<VersionNode<T>>} versionNodeHash - The hash of the version node
 * @param {SHA256Hash<VersionNode<T>>} [beforeVersionNodeHash] - Optional. The hash of the version node above which the version hashes should not be included
 * @returns {Promise<Array<SHA256Hash<VersionNode<T>>>>}
 */
async function _getVersionsNodeHashes<T extends OneVersionedObjectTypes>(
    versionNodeHash: SHA256Hash<VersionNode<T>>,
    beforeVersionNodeHash?: SHA256Hash<VersionNode<T>>
): Promise<Array<SHA256Hash<VersionNode<T>>>> {
    if (versionNodeHash === beforeVersionNodeHash) {
        return [];
    }

    const node = await getObjectWithType(ensureHash<OneVersionedObjectTypes>(versionNodeHash), [
        'VersionNodeMerge',
        'VersionNodeChange',
        'VersionNodeEdge'
    ]);

    switch (node.$type$) {
        case 'VersionNodeEdge': {
            return [versionNodeHash];
        }
        case 'VersionNodeChange': {
            if (node.prev !== undefined) {
                return [
                    versionNodeHash,
                    ...(await _getVersionsNodeHashes(node.prev as SHA256Hash<VersionNode<T>>, beforeVersionNodeHash))
                ];
            }

            return [versionNodeHash];
        }
        case 'VersionNodeMerge': {
            const hashes: Array<SHA256Hash<VersionNode<T>>> = [];

            for (const nodeHash of node.nodes) {
                hashes.push(...(await _getVersionsNodeHashes(nodeHash as SHA256Hash<VersionNode<T>>, beforeVersionNodeHash)));
            }

            return hashes;
        }
        default: {
            throw new Error('Invalid version node type');
        }
    }
}


/**
 * Get the versions node hashes of the version node and all its predecessors
 *
 * @internal
 * @async
 * @param {SHA256Hash<VersionNode<T>>} versionNodeHash - The hash of the version node
 * @returns {Promise<Array<SHA256Hash<VersionNode<T>>>>}
 */
async function _getVersionNodeHashForDataHash<T extends OneVersionedObjectTypes>(
    versionNodeHash: SHA256Hash<VersionNode<T>>,
    dataHash: SHA256Hash<T>
): Promise<SHA256Hash<VersionNode<T>> | undefined> {

    const node = await getObjectWithType(ensureHash<OneVersionedObjectTypes>(versionNodeHash), [
        'VersionNodeMerge',
        'VersionNodeChange',
        'VersionNodeEdge'
    ]);

    switch (node.$type$) {
        case 'VersionNodeEdge': {
            if(node.data === dataHash) {
                return versionNodeHash;
            }
            return undefined;
        }
        case 'VersionNodeChange': {
            if (node.data === dataHash) {
                return versionNodeHash;
            }

            return await _getVersionNodeHashForDataHash(node.prev as SHA256Hash<VersionNode<T>>, dataHash);
        }
        case 'VersionNodeMerge': {
            for (const nodeHash of node.nodes) {
                const hash = await _getVersionNodeHashForDataHash(nodeHash as SHA256Hash<VersionNode<T>>, dataHash);
                if(hash !== undefined) {
                    return hash;
                }
            }

            return undefined;
        }
        default: {
            throw new Error('Invalid version node type');
        }
    }
}