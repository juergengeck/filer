/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

/**
 * This type is for an object that lists the collected links of one or more ONE objects,
 * separated into ONE object references (versioned, unversioned or ID-references) and BLOB or
 * CLOB links (only a hash, links to files that are not ONE microdata objects).
 *
 * The way this type is used the lists may include all or only a subset of the links found in a ONE
 * object. All links are present in the lists returned by
 * {@link util/object-find-links.module:ts.findLinkedHashesInObject|`findLinkedHashesInObject`},
 * the
 * Chum-sync modules
 * using this type list only those links that had to be transferred from the remote instance.
 *
 * **Note** that if a hash is referenced more than once it will also be included in the array
 * for its type more than once. We decided not to filter duplicates because that would mean
 * hiding information (how many links to the same hash there are).
 * @global
 * @typedef {object} LinkedObjectsHashList
 * @property {Array<SHA256Hash<OneObjectTypeNames>>} references - Array of SHA-256 hashes collected
 * from {@link Reference} objects
 * @property {Array<SHA256IdHash<OneVersionedObjectTypeNames>>} idReferences - Array of SHA-256
 * hashes collected from ID hash links
 * @property {Array<SHA256Hash<'BLOB'>>} blobs - Array of SHA-256 hashes of binary files collected
 * from hash links to BLOB files
 * @property {Array<SHA256Hash<'CLOB'>>} clobs - Array of SHA-256 hashes of UTF-8 text files
 * collected from hash links to CLOB files
 */
export interface LinkedObjectsHashList {
    references: SHA256Hash[];
    idReferences: SHA256IdHash[];
    blobs: Array<SHA256Hash<BLOB>>;
    clobs: Array<SHA256Hash<CLOB>>;
}

/**
 * This type is for an object that lists the collected links of one or more ONE objects,
 * separated into ONE object references (versioned, unversioned or ID-references) and BLOB or
 * CLOB links (only a hash, links to files that are not ONE microdata objects).
 *
 * The way this type is used the lists may include all or only a subset of the links found in a ONE
 * object. All links are present in the lists returned by
 * {@link util/object-find-links.module:ts.findLinkedHashesInObject|`findLinkedHashesInObject`},
 * the
 * Chum-sync modules
 * using this type list only those links that had to be transferred from the remote instance.
 *
 * **Note** that if a hash is referenced more than once it will also be included in the array
 * for its type more than once. We decided not to filter duplicates because that would mean
 * hiding information (how many links to the same hash there are).
 * @global
 * @typedef {object} LinkedObjectsHashAndValueTypeList
 * @property {Array<{hash:SHA256Hash,rule:RecipeRule}>} references
 * @property {Array<{hash:SHA256IdHash,rule:RecipeRule}>} idReferences
 * @property {Array<{hash:SHA256Hash<'BLOB'>,rule:RecipeRule}>} blobs
 * @property {Array<{hash:SHA256Hash<'CLOB'>,rule:RecipeRule}>} clobs
 */
export interface LinkedObjectsHashAndValueTypeList {
    references: Array<{hash: SHA256Hash; valueType: ReferenceToObjValue}>;
    idReferences: Array<{hash: SHA256IdHash; valueType: ReferenceToIdValue}>;
    blobs: Array<{hash: SHA256Hash<BLOB>; valueType: ReferenceToBlobValue}>;
    clobs: Array<{hash: SHA256Hash<CLOB>; valueType: ReferenceToClobValue}>;
}

import type {
    BLOB,
    CLOB,
    OneIdObjectTypes,
    OneObjectTypes,
    ReferenceToBlobValue,
    ReferenceToClobValue,
    ReferenceToIdValue,
    ReferenceToObjValue
} from '../recipes.js';
import {
    determineChildrenForIdObjectWithMetadataSync,
    determineChildrenWithMetadataSync
} from './determine-children-with-metadata.js';
import type {ChildObjectWithMetaData} from './determine-children-with-metadata.js';
import type {ChildObject} from './determine-children.js';
import {determineChildrenForIdObjectSync, determineChildrenSync} from './determine-children.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';

function convertHashesWithMetadata(
    childObjects: ChildObjectWithMetaData[]
): LinkedObjectsHashAndValueTypeList {
    const links: LinkedObjectsHashAndValueTypeList = {
        references: [],
        idReferences: [],
        blobs: [],
        clobs: []
    };

    childObjects.forEach(obj => {
        if (obj.type === 'object') {
            links.references.push({
                hash: obj.hash,
                valueType: obj.valueType
            });
        }

        if (obj.type === 'id') {
            links.idReferences.push({
                hash: obj.hash,
                valueType: obj.valueType
            });
        }

        if (obj.type === 'blob') {
            links.blobs.push({
                hash: obj.hash,
                valueType: obj.valueType
            });
        }

        if (obj.type === 'clob') {
            links.clobs.push({
                hash: obj.hash,
                valueType: obj.valueType
            });
        }
    });

    return links;
}

function convertHashes(childObjects: ChildObject[]): LinkedObjectsHashList {
    const links: LinkedObjectsHashList = {
        references: [],
        idReferences: [],
        blobs: [],
        clobs: []
    };

    childObjects.forEach(obj => {
        if (obj.type === 'object') {
            links.references.push(obj.hash);
        }

        if (obj.type === 'id') {
            links.idReferences.push(obj.hash);
        }

        if (obj.type === 'blob') {
            links.blobs.push(obj.hash);
        }

        if (obj.type === 'clob') {
            links.clobs.push(obj.hash);
        }
    });

    return links;
}

/**
 * Given a ONE object find all ONE Reference objects pointing to versioned or unversioned
 * ONE objects, to ID objects (all versions of a versioned object), or to CLOB/BLOB files. The
 * object is traversed using the order of the array of rules of the {@link Recipe|Recipe},
 * i.e. it is deterministic and independent of things like insertion order of the properties,
 * which is usually used when iterating over a Javascript object.
 * @static
 * @param {(OneObjectTypes|OneIdObjectTypes)} obj - A ONE object
 * @returns {LinkedObjectsHashList} An object pointing to arrays of SHA-256 hashes for all
 * references, ID references, and all CLOB and BLOB links found in the object
 */
export function findLinkedHashesInObject(obj: Readonly<OneObjectTypes>): LinkedObjectsHashList {
    return convertHashes(determineChildrenSync(obj));
}

/**
 * Given a ONE object find all ONE Reference objects pointing to versioned or unversioned
 * ONE objects, to ID objects (all versions of a versioned object), or to CLOB/BLOB files. The
 * object is traversed using the order of the array of rules of the {@link Recipe|Recipe},
 * i.e. it is deterministic and independent of things like insertion order of the properties,
 * which is usually used when iterating over a Javascript object.
 * @static
 * @param {(OneObjectTypes|OneIdObjectTypes)} obj - A ONE object
 * @returns {LinkedObjectsHashList} An object pointing to arrays of SHA-256 hashes for all
 * references, ID references, and all CLOB and BLOB links found in the object
 */
export function findLinkedHashesInIdObject(
    obj: Readonly<OneObjectTypes | OneIdObjectTypes>
): LinkedObjectsHashList {
    return convertHashes(determineChildrenForIdObjectSync(obj as OneIdObjectTypes));
}

/**
 * Given a ONE object find all ONE Reference objects pointing to versioned or unversioned
 * ONE objects, to ID objects (all versions of a versioned object), or to CLOB/BLOB files. The
 * object is traversed using the order of the array of rules of the {@link Recipe|Recipe},
 * i.e. it is deterministic and independent of things like insertion order of the properties,
 * which is usually used when iterating over a Javascript object.
 * @static
 * @param {(OneObjectTypes|OneIdObjectTypes)} obj - A ONE object
 * @returns {LinkedObjectsHashList} An object pointing to arrays of SHA-256 hashes for all
 * references, ID references, and all CLOB and BLOB links found in the object
 */
export function findLinkedHashesWithValueTypeInObject(
    obj: Readonly<OneObjectTypes>
): LinkedObjectsHashAndValueTypeList {
    return convertHashesWithMetadata(determineChildrenWithMetadataSync(obj));
}

/**
 * Given a ONE object find all ONE Reference objects pointing to versioned or unversioned
 * ONE objects, to ID objects (all versions of a versioned object), or to CLOB/BLOB files. The
 * object is traversed using the order of the array of rules of the {@link Recipe|Recipe},
 * i.e. it is deterministic and independent of things like insertion order of the properties,
 * which is usually used when iterating over a Javascript object.
 * @static
 * @param {(OneObjectTypes|OneIdObjectTypes)} obj - A ONE object
 * @returns {LinkedObjectsHashList} An object pointing to arrays of SHA-256 hashes for all
 * references, ID references, and all CLOB and BLOB links found in the object
 */
export function findLinkedHashesWithValueTypeInIdObject(
    obj: Readonly<OneObjectTypes | OneIdObjectTypes>
): LinkedObjectsHashAndValueTypeList {
    return convertHashesWithMetadata(
        determineChildrenForIdObjectWithMetadataSync(obj as OneIdObjectTypes)
    );
}
