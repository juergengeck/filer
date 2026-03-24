/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * System-internal reverse maps are used to search backwards (upwards) in the ONE object tree.
 * It is easy to follow the links in objects to find a leaf node, but to go the other way and
 * find which higher level objects link to a (given) lower-level one is made possible by these
 * maps. Each time a ONE object is written that links to another object the reverse map
 * belonging to the linked (targeted) object is updated.
 *
 * There is a reverse map
 * 1) for each unversioned object, or for each ID object of a versioned object, and
 * 2) for each type of object that links to the object.
 *
 * The second point leads to having a variable number of reverse maps for each object, it is an
 * optimization that assumes that there may be quite a lot of entries and that the most common
 * use case probably is to look for links to a given object only from a certain type of object,
 * so that having to sift through all links from all types of objects each time is unnecessary
 * effort.
 *
 * For example, if we have an app that stores the contents of a user's IMAP folder in ONE we may
 * have ONE objects for Email and Mailbox. It is easy to find which Emails are in any given
 * Mailbox object because the Email objects are directly linked from there. However, when given
 * an Email object, to find out which Mailbox objects link to it - after all, any email is found
 * in several IMAP mailboxes - we need to consult the reverse map for the given Email object
 * *which contains the map of Mailbox objects linking to it*. It was updated each time a(ny)
 * Mailbox object was written that contained a link to this Email object. There will be other
 * reverse map files for other types of objects linking to the Email object.
 *
 * Map name pattern:
 *
 *     ${id-hash}.${type}
 *
 * The "H" (for "Hash") indicates that this is a map for an unversioned (single) object, the "I"
 * (for "ID hash") shows it is for a versioned object (with many objects).
 *
 * We could of course find out if a given hash is the hash of a concrete object (unversioned) or
 * of an ID-object (versioned object), but this requires additional effort (both I/O and CPU).
 * By having this one letter as part of the name, and at a fixed position, we can use that
 * information much more easily if we need it.
 *
 * Similar for the type string at the end of the filename. We could read the hash we found in
 * the map and find the type, but this comes at a cost. By having it in the name we can select
 * the appropriate reverse map using this simple naming pattern without any effort.
 *
 * Format:
 *
 * ```
 * targetObjHash,referencingObjIdHash,referencingObjHash
 * targetObjHash,referencingObjIdHash,referencingObjHash
 * targetObjHash,referencingObjIdHash,referencingObjHash
 * ...
 * @module
 */

/**
 * A concrete version hash of a versioned object identified by an ID hash, and the timestamp of
 * version map entry creation for that concrete hash.
 * @typedef {object} HashAndIdHashAndTimestamp
 * @property {SHA256Hash} hash
 * @property {SHA256IdHash} idHash
 * @property {number} timestamp
 */
export interface HashAndIdHashAndTimestamp<
    T extends OneVersionedObjectTypes = OneVersionedObjectTypes
> {
    // NOTE: Typescript does NOT check or enforce the two "T" to be equal - usually it is a
    // UNION TYPE and only those unions are equal. The actual name used can be any from the
    // union for either hash. We would have to "infer" a second type param by extracting the "T"
    // from one of the hashes and use the inferred name for the second hash. Now they are the
    // same but this interface becomes too complex.
    hash: SHA256Hash<T>;
    idHash: SHA256IdHash<T>;
    timestamp: number;
}

import type {
    OneUnversionedObjectInterfaces,
    OneVersionedObjectInterfaces
} from '@OneObjectInterfaces';

import {createError} from './errors.js';
import {hasRecipe, isVersionedObjectType} from './object-recipes.js';
import type {
    HashTypes,
    OneObjectInterfaces,
    OneObjectTypeNames,
    OneObjectTypes,
    OneUnversionedObjectTypeNames,
    OneVersionedObjectTypeNames,
    OneVersionedObjectTypes
} from './recipes.js';
import {STORAGE} from './storage-base-common.js';
import {getIdHash} from './storage-id-hash-cache.js';
import {readUTF8TextFile} from './system/storage-base.js';
import type {LruMapObj} from './util/lru-map.js';
import {createLruMap} from './util/lru-map.js';
import {serializeWithType} from './util/promise.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {looksLikeHash} from './util/type-checks.js';
import {getCurrentVersionNode} from './storage-versioned-objects.js';

interface VersionMapEntry<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> {
    timestamp: number;
    hash: SHA256Hash<T>;
}

async function _getOnlyLatestReferencingObjs<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T,
    createdAfter: number,
    justHash: true
): Promise<Array<SHA256Hash<OneVersionedObjectInterfaces[T]>>>;
async function _getOnlyLatestReferencingObjs<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T,
    createdAfter: number,
    justHash: false
): Promise<Array<HashAndIdHashAndTimestamp<OneVersionedObjectInterfaces[T]>>>;

/**
 * Backend function for {@link getOnlyLatestReferencingObjsHashAndId} and
 * {@link getOnlyLatestReferencingObjsHash}.
 *
 * It produces different return types depending on the boolean parameter.
 *
 * Cleaner code would have been to always return the complex type, and have a second frontend
 * function select just the hash for the simple hash return type case. However, that would
 * needlessly create a lot of objects, so I chose to use this ternary-operator approach that uses
 * an extra function and an extra parameter, even though especially the latter usually is
 * something to be avoided and replaced by having different functions instead of one parameter
 * that switches the return type.
 * @private
 * @param {SHA256Hash<HashTypes> | SHA256IdHash} targetHash
 * @param {T} typeOfReferencingObj
 * @param {number} createdAfter
 * @param {boolean} [justHash=true]
 * @returns {Promise<Array<SHA256Hash|HashAndIdHashAndTimestamp>>}
 */
async function _getOnlyLatestReferencingObjs<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T,
    createdAfter: number = 0,
    justHash: boolean = true
): Promise<
    Array<
        | SHA256Hash<OneVersionedObjectInterfaces[T]>
        | HashAndIdHashAndTimestamp<OneVersionedObjectInterfaces[T]>
    >
> {
    if (!isVersionedObjectType(typeOfReferencingObj)) {
        throw createError('RMQ-AVMC1', {targetHash, typeOfReferencingObj});
    }

    const entries = await getAllEntries<T>(targetHash, typeOfReferencingObj);

    const acc = [] as Array<
        | SHA256Hash<OneVersionedObjectInterfaces[T]>
        | HashAndIdHashAndTimestamp<OneVersionedObjectInterfaces[T]>
    >;
    const vMapLookupCache: LruMapObj<SHA256IdHash, VersionMapEntry | undefined> = createLruMap(50);

    while (entries.length > 0) {
        // SERIAL EXECUTION in constant small steps - no use issuing too much I/O
        await Promise.all(
            entries.splice(-4).map(async hashOfReferencingObj => {
                const idHash = await getIdHash(hashOfReferencingObj);
                let entry = vMapLookupCache.get(idHash);

                if (entry === undefined) {
                    const node = await getCurrentVersionNode(idHash);
                    entry = {
                        hash: node.obj.data,
                        timestamp: node.timestamp ?? node.obj.creationTime
                    };
                }

                vMapLookupCache.set(idHash, entry);

                if (entry.timestamp > createdAfter && hashOfReferencingObj === entry.hash) {
                    acc.push(
                        justHash
                            ? hashOfReferencingObj
                            : {
                                  hash: hashOfReferencingObj,
                                  idHash,
                                  timestamp: entry.timestamp
                              }
                    );
                }
            })
        );
    }

    return acc;
}

/**
 * Frontend to {@link reverse-map-query.module:ts.getAllEntries|getAllEntries} which only returns
 * entries that point to the most current version of a referencing object.
 *
 * This function is only useful if the reverse map is for referencing objects that are
 * *versioned*. If it is called for an unversioned referencing object type, where the
 * reverse map has no entries for ID hashes (the 2nd hash is empty), it throws an `Error`.
 *
 * The function takes the results returned by
 * {@link reverse-map-query.module:ts.getAllEntries|reverse-map-query.getAllEntries} and uses the
 * referencing object ID hashes (2nd reverse map column) to load the version maps for those
 * objects. It then checks if any of the concrete version hashes for each ID hash is the most
 * current version of that object. It returns only those concrete object hashes for which this
 * is the case.
 *
 * The original use case for this function is checking access rights: Both {@link Access} and
 * {@link Group} objects are versioned, and both only grant access through the latest version.
 * If a {@link Person} once was member of a group but is not a member in the latest version of
 * the group they should not get access. Similar for Access objects which revoke previously
 * granted access to a ONE object.
 * @static
 * @async
 * @param {SHA256Hash|SHA256IdHash} targetHash - Object owning the reverse map to query. **For
 * versioned objects this must be an ID hash.**
 * @param {OneVersionedObjectTypeNames} typeOfReferencingObj - The specific reverse map from
 * `fromHash` back to any object of this type with a hash link to `idHash` or one of the
 * concrete versions
 * @param {number} [createdAfter] - Optional timestamp: The most current object is included
 * into the final result only if it has a version map timestamp *after* this time
 * @returns {Promise<HashAndIdHashAndTimestamp[]>} Returns an array of triples of hash, ID hash
 * and timestamp of the latest version of versioned objects referencing the object the reverse
 * map is for. **Note** that this function guarantees that there always are ID hashes, since it
 * throws an `Error` if invoked for unversioned object type reverse maps.
 * @throws {Error} Throws an error if the given 2nd parameter `toType` is not a versioned object
 * type (only versioned objects can have a "most current" version)
 */
export async function getOnlyLatestReferencingObjsHashAndId<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T,
    createdAfter: number = 0
): Promise<Array<HashAndIdHashAndTimestamp<OneVersionedObjectInterfaces[T]>>> {
    return await _getOnlyLatestReferencingObjs(
        targetHash,
        typeOfReferencingObj,
        createdAfter,
        false
    );
}

/**
 * Same as {@link getOnlyLatestReferencingObjsHashAndId} but only returns the hashes and not the
 * ID hashes and timestamps.
 * @static
 * @async
 * @param {SHA256Hash|SHA256IdHash} targetHash - Object owning the reverse map to query. **For
 * versioned objects this must be an ID hash.**
 * @param {OneVersionedObjectTypeNames} typeOfReferencingObj - The specific reverse map from
 * `fromHash` back to any object of this type with a hash link to `idHash` or one of the
 * concrete versions
 * @param {number} [createdAfter] - Optional timestamp: The most current object is included
 * into the final result only if it has a version map timestamp *after* this time
 * @returns {Promise<SHA256Hash[]>} Returns an array of triples of hash, ID hash
 * and timestamp of the latest version of versioned objects referencing the object the reverse
 * map is for. **Note** that this function guarantees that there always are ID hashes, since it
 * throws an `Error` if invoked for unversioned object type reverse maps.
 * @throws {Error} Throws an error if the given 2nd parameter `toType` is not a versioned object
 * type (only versioned objects can have a "most current" version)
 */
export async function getOnlyLatestReferencingObjsHash<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T,
    createdAfter: number = 0
): Promise<Array<SHA256Hash<OneVersionedObjectInterfaces[T]>>> {
    return await _getOnlyLatestReferencingObjs(
        targetHash,
        typeOfReferencingObj,
        createdAfter,
        true
    );
}

/**
 * Backend function for {@link getAllEntries}.
 * @private
 * @param {string} mapName
 * @returns {Promise<SHA256Hash[]>}
 */
async function _getAllEntries(mapName: string): Promise<Array<SHA256Hash<OneObjectTypes>>> {
    const isHash = looksLikeHash(mapName.slice(0, 64));
    const hasObject = mapName.slice(64, 72) === '.Object.';
    const isValidType = hasRecipe(mapName.slice(72));

    if (!isHash || !hasObject || !isValidType) {
        throw createError('RMQ-AE1', {
            mapName,
            isHash,
            hasObject,
            isValidType,
            type: mapName.slice(72)
        });
    }

    let mapData;

    try {
        mapData = await readUTF8TextFile(mapName, STORAGE.RMAPS);
    } catch (err) {
        if (err.name === 'FileNotFoundError') {
            return [];
        }

        throw err;
    }

    // slice() removes the final newline character
    return mapData.slice(0, -1).split('\n') as Array<SHA256Hash<OneObjectTypes>>;
}

/**
 * Backend function for {@link getAllIdObjectEntries}.
 * @private
 * @param {string} mapName
 * @returns {Promise<SHA256Hash[]>}
 */
async function _getAllIdObjectEntries(
    mapName: string
): Promise<Array<SHA256IdHash<OneVersionedObjectTypes>>> {
    const isHash = looksLikeHash(mapName.slice(0, 64));
    const hasIdObject = mapName.slice(64, 74) === '.IdObject.';
    const isValidType = hasRecipe(mapName.slice(74));

    if (!isHash || !hasIdObject || !isValidType) {
        throw createError('RMQ-AE2', {
            mapName,
            isHash,
            hasIdObject,
            isValidType,
            type: mapName.slice(74)
        });
    }

    let mapData;

    try {
        mapData = await readUTF8TextFile(mapName, STORAGE.RMAPS);
    } catch (err) {
        if (err.name === 'FileNotFoundError') {
            return [];
        }

        throw err;
    }

    // slice() removes the final newline character
    return mapData.slice(0, -1).split('\n') as Array<SHA256IdHash<OneVersionedObjectTypes>>;
}

export function getAllEntries<T extends OneUnversionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T
): Promise<Array<SHA256Hash<OneUnversionedObjectInterfaces[T]>>>;
export function getAllEntries<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T
): Promise<Array<SHA256Hash<OneVersionedObjectInterfaces[T]>>>;
export function getAllEntries<T extends OneObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T
): Promise<Array<SHA256Hash<OneObjectInterfaces[T]>>>;

/**
 * Reads the given reverse map and returns the data in a 1:N hash => hashes form.
 *
 * A non-existent map file is not an error, it simply means no object references the one the
 * given reverse map is for.
 *
 * The given reverse map filename is checked against the expected pattern for these files, which is
 * Hash-of-object-the-map-is-for.Object.ReferencingOneObjectTypeName
 * and an `Error` is thrown if the pattern does not fit.
 * @static
 * @async
 * @param {SHA256Hash|SHA256IdHash} targetHash - Object owning the reverse map to query. **For
 * versioned objects this must be an ID hash.**
 * @param {OneVersionedObjectTypeNames} typeOfReferencingObj - The specific reverse map from
 * `idHash` back to any object of this type with a hash link to `idHash` or one of the concrete
 * versions
 * @returns {Promise<ReverseMapEntry[]>}
 */
export function getAllEntries(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: OneObjectTypeNames
): Promise<Array<SHA256Hash<OneObjectTypes>>> {
    const mapName = targetHash + '.Object.' + typeOfReferencingObj;
    return serializeWithType('ReverseMap ' + mapName, () => _getAllEntries(mapName));
}

/**
 * Obtains the hashes of all IdObjects that reference the targetHash.
 *
 *
 *
 * A non-existent map file is not an error, it simply means no object references the one the
 * given reverse map is for.
 *
 * The given reverse map filename is checked against the expected pattern for these files, which is
 * Hash-of-object-the-map-is-for.IdObject.ReferencingOneObjectTypeName
 * and an `Error` is thrown if the pattern does not fit.
 * @static
 * @async
 * @param {SHA256Hash|SHA256IdHash} targetHash - Object owning the reverse map to query. **For
 * versioned objects this must be an ID hash.**
 * @param {OneVersionedObjectTypeNames} typeOfReferencingObj - The specific reverse map from
 * `idHash` back to any object of this type with a hash link to `idHash` or one of the concrete
 * versions
 * @returns {Promise<ReverseMapEntry[]>}
 */
export function getAllIdObjectEntries<T extends OneVersionedObjectTypeNames>(
    targetHash: SHA256Hash<HashTypes> | SHA256IdHash,
    typeOfReferencingObj: T
): Promise<Array<SHA256IdHash<OneVersionedObjectInterfaces[T]>>> {
    const mapName = targetHash + '.IdObject.' + typeOfReferencingObj;
    return serializeWithType('ReverseMapId ' + mapName, () =>
        _getAllIdObjectEntries(mapName)
    ) as Promise<Array<SHA256IdHash<OneVersionedObjectInterfaces[T]>>>;
}
