/**
 * @file This file is the entry point for all operations related to access. It will defer most
 * operations to child modules, but having a central entry point makes the architecture cleaner
 * - at least until we have implemented all of them. Some of them are placeholders for the future.
 */
import {onChumStart, onChumEnd} from './chum-sync.js';
import {createError} from './errors.js';
import type {
    BLOB,
    CLOB,
    HashTypes,
    OneObjectTypes,
    OneVersionedObjectTypes,
    Person
} from './recipes.js';
import type {AccessibleObject} from './util/determine-accessible-hashes.js';
import {determineAccessibleHashes} from './util/determine-accessible-hashes.js';
import {determineChildren, determineChildrenForIdObject} from './util/determine-children.js';
import type {ChildObject} from './util/determine-children.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';

type AccessibleEntry = Set<SHA256Hash<HashTypes> | SHA256IdHash>;

// For each Person(Id):
// Map of root-[ID-]hash => Array<ID|OBJ|VERSION_NODE|BLOB|CLOB>
const ACCESSIBLE: Map<SHA256IdHash<Person>, AccessibleEntry> = new Map();

// There can be more than one Chum at a time for any given Person-ID.
const ChumCount: Map<SHA256IdHash<Person>, number> = new Map();

export function initAccessManager(): void {
    onChumStart.addListener(chumOpts => {
        const cnt = ChumCount.get(chumOpts.remotePersonId) ?? 0;

        if (cnt === 0) {
            ChumCount.set(chumOpts.remotePersonId, 1);
            ACCESSIBLE.set(chumOpts.remotePersonId, new Set());
        } else {
            ChumCount.set(chumOpts.remotePersonId, cnt + 1);
        }
    });

    onChumEnd.addListener(chumOpts => {
        const cnt = ChumCount.get(chumOpts.remotePersonId) ?? 0;

        if (cnt === 1) {
            ChumCount.delete(chumOpts.remotePersonId);
            ACCESSIBLE.delete(chumOpts.remotePersonId);
        } else {
            ChumCount.set(chumOpts.remotePersonId, cnt - 1);
        }
    });
}

/**
 * Get a list of accessible root hashes for a specific person.
 *
 * @param {SHA256IdHash<Person>} personId
 * @param {Function} objectFilter - Optional filter function to determine if an object should be shared
 * @returns {Promise<AccessibleObject[]>}
 */
export async function getAccessibleRootHashes(
    personId: SHA256IdHash<Person>,
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
): Promise<AccessibleObject[]> {
    const result = await determineAccessibleHashes(personId, false, objectFilter);
    const accessibleSet = ACCESSIBLE.get(personId);

    if (accessibleSet === undefined) {
        // This should have been put into the Map onChumStart. It should not be possible to end
        // up here.
        throw createError('AM-GARH1', {personId});
    }

    result.forEach(r => {
        switch (r.type) {
            case 'id':
                accessibleSet.add(r.idHash);
                break;
            case 'unversioned':
                accessibleSet.add(r.hash);
                break;
            case 'versioned':
                accessibleSet.add(r.idHash);
                accessibleSet.add(r.hash);
                break;
            case 'version_node':
                accessibleSet.add(r.node);
                break;
        }
    });
    return result;
}

/**
 * Get a list of children for a specified object.
 *
 * @param {SHA256IdHash} personId
 * @param {SHA256Hash} hash
 * @returns {Promise<ChildObject[]>}
 */
export async function getChildren(
    personId: SHA256IdHash<Person>,
    hash: SHA256Hash
): Promise<ChildObject[]> {
    const result = await determineChildren(hash);

    const accessibleHashes = ACCESSIBLE.get(personId);

    if (accessibleHashes === undefined) {
        throw new Error('Impossible');
    }

    result.forEach(r => {
        accessibleHashes.add(r.hash);
    });

    return result;
}

/**
 * Get a list of children for a specified id-object.
 *
 * @param {SHA256IdHash} personId
 * @param {SHA256Hash} idHash
 * @returns {Promise<ChildObject[]>}
 */
export async function getChildrenForIdObject(
    personId: SHA256IdHash<Person>,
    idHash: SHA256IdHash
): Promise<ChildObject[]> {
    const result = await determineChildrenForIdObject(idHash);

    const accessibleHashes = ACCESSIBLE.get(personId);

    if (accessibleHashes === undefined) {
        throw new Error('Impossible');
    }

    result.forEach(r => {
        accessibleHashes.add(r.hash);
    });

    return result;
}

/**
 * Check if a hash / object is accessible by a specific person.
 *
 * @param {SHA256IdHash<Person>} personId
 * @param {SHA256Hash<OneObjectTypes | BLOB | CLOB>} hash
 * @returns {Promise<boolean>}
 */
export async function isAccessibleBy(
    personId: SHA256IdHash<Person>,
    hash: SHA256Hash<OneObjectTypes | BLOB | CLOB>
): Promise<boolean> {
    const accessibleHashes = ACCESSIBLE.get(personId);

    if (accessibleHashes === undefined) {
        return false;
    }

    return accessibleHashes.has(hash);
}

/**
 * Check if an id-hash / id-object is accessible by a specific person.
 *
 * @param {SHA256IdHash<Person>} personId
 * @param {SHA256IdHash<OneObjectTypes | BLOB | CLOB>} idHash
 * @returns {Promise<boolean>}
 */
export async function isIdAccessibleBy(
    personId: SHA256IdHash<Person>,
    idHash: SHA256IdHash<OneVersionedObjectTypes>
): Promise<boolean> {
    const accessibleHashes = ACCESSIBLE.get(personId);

    if (accessibleHashes === undefined) {
        return false;
    }

    return accessibleHashes.has(idHash);
}
