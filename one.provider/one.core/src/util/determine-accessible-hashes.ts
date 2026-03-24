import {createError} from '../errors.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';
import type {
    Access,
    IdAccess,
    OneUnversionedObjectTypeNames,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypeNames,
    OneVersionedObjectTypes,
    Person,
    VersionNode
} from '../recipes.js';
import {getObject} from '../storage-unversioned-objects.js';
import {getIdObject, getVersionsNodeHashes} from '../storage-versioned-objects.js';
import {calculateIdHashForStoredObj} from '../microdata-to-id-hash.js';
import {getOnlyLatestReferencingObjsHashAndId} from '../reverse-map-query.js';
import {getOrCreate} from './map.js';

export interface AccessReasons {
    person?: SHA256IdHash<Person>;
    groups: string[];
}

export interface AccessibleUnversionedObject {
    type: 'unversioned';
    hash: SHA256Hash<OneUnversionedObjectTypes>;
    oneType: OneUnversionedObjectTypeNames;
    accessReasons?: AccessReasons;
}

export interface AccessibleVersionedObject {
    type: 'versioned';
    hash: SHA256Hash<OneVersionedObjectTypes>;
    idHash: SHA256IdHash;
    oneType: OneVersionedObjectTypeNames;
    accessReasons?: AccessReasons;
}

export interface AccessibleVersionNode<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> {
    type: 'version_node';
    node: SHA256Hash<VersionNode<T>>;
    dataIdHash: SHA256IdHash;
    dataType: OneVersionedObjectTypeNames;
    accessReasons?: AccessReasons;
}

export interface AccessibleIdObject {
    type: 'id';
    idHash: SHA256IdHash;
    oneType: OneVersionedObjectTypeNames;
    accessReasons?: AccessReasons;
}

export type AccessibleObject<T extends OneVersionedObjectTypes = OneVersionedObjectTypes> =
    | AccessibleUnversionedObject
    | AccessibleVersionedObject
    | AccessibleVersionNode<T>
    | AccessibleIdObject;

/**
 * Returns a list of all objects that are accessible by a specific user.
 *
 * @param {SHA256IdHash<Person>} person
 * @param {boolean} includeReasons
 * @param {Function} objectFilter - Optional filter function to determine if an object should be shared
 * @returns {AccessibleObject[]}
 */
export async function determineAccessibleHashes(
    person: SHA256IdHash<Person>,
    includeReasons = false,
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
): Promise<AccessibleObject[]> {
    const accessibleObjects = new Map<SHA256Hash | SHA256IdHash, AccessibleObject>();

    // Determine access objs
    // Determine id access objs
    const personAccessObjs = await getOnlyLatestReferencingObjsHashAndId(person, 'Access');
    const personIdAccessObjs = await getOnlyLatestReferencingObjsHashAndId(person, 'IdAccess');

    for (const accessObjHashes of personAccessObjs) {
        // Filter Access objects if objectFilter is provided
        if (!objectFilter || await objectFilter(accessObjHashes.hash, 'Access')) {
            await addObjToAccessibleObjectsMap(accessibleObjects, accessObjHashes.hash, {
                person: includeReasons ? person : undefined
            });
        }
    }

    for (const idAccessObjHashes of personIdAccessObjs) {
        // Filter IdAccess objects if objectFilter is provided
        if (!objectFilter || await objectFilter(idAccessObjHashes.hash, 'IdAccess')) {
            await addVersionedObjToAccessibleObjectsMap(accessibleObjects, idAccessObjHashes.hash, {
                person: includeReasons ? person : undefined
            });
        }
    }

    // Determine groups
    const groupsContainingPerson = await getOnlyLatestReferencingObjsHashAndId(person, 'Group');

    // Filter groups if objectFilter is provided
    const allowedGroups: typeof groupsContainingPerson = [];

    if (objectFilter) {
        for (const group of groupsContainingPerson) {
            if (await objectFilter(group.idHash, 'Group')) {
                allowedGroups.push(group);
            }
        }
    }

    // Determine access objs
    // Determine id access objs
    for (const group of allowedGroups) {
        const groupName = (await getIdObject(group.idHash)).name;
        const groupAccess = await getOnlyLatestReferencingObjsHashAndId(group.idHash, 'Access');
        const groupIdAccess = await getOnlyLatestReferencingObjsHashAndId(group.idHash, 'IdAccess');

        for (const accessObjHashes of groupAccess) {
            // Filter Access objects if objectFilter is provided
            if (!objectFilter || await objectFilter(accessObjHashes.hash, 'Access')) {
                await addObjToAccessibleObjectsMap(accessibleObjects, accessObjHashes.hash, {
                    groupName: includeReasons ? groupName : undefined
                });
            }
        }

        for (const idAccessObjHashes of groupIdAccess) {
            // Filter IdAccess objects if objectFilter is provided
            if (!objectFilter || await objectFilter(idAccessObjHashes.hash, 'IdAccess')) {
                await addVersionedObjToAccessibleObjectsMap(accessibleObjects, idAccessObjHashes.hash, {
                    groupName: includeReasons ? groupName : undefined
                });
            }
        }
    }

    return [...accessibleObjects.values()];
}

/**
 * Parse and validate a JSON serialized AccessibleObject array.
 *
 * @param {unknown} data - string with JSON array of AccessibleObjects
 * @returns {ChildObject[]}
 */
export function parseAccessibleObjects(data: unknown): AccessibleObject[] {
    if (typeof data !== 'string') {
        throw createError('DAH-PAO1', {data});
    }

    const accessibleObjects = JSON.parse(data);

    if (!Array.isArray(accessibleObjects)) {
        throw createError('DAH-PAO2', {data: accessibleObjects});
    }

    for (const accessibleObject of accessibleObjects) {
        if (
            accessibleObject.type !== 'unversioned' &&
            accessibleObject.type !== 'versioned' &&
            accessibleObject.type !== 'version_node' &&
            accessibleObject.type !== 'id'
        ) {
            throw createError('DAH-PAO3', {type: accessibleObject.type});
        }
    }

    return accessibleObjects;
}

// #### Private interface ####

interface AccessReason {
    person?: SHA256IdHash<Person>;
    groupName?: string;
}

/**
 * Appends the reason why the object was shared to the accessible object.
 *
 * @param {AccessibleObject} accessibleObject
 * @param {AccessReason} accessReason
 */
function appendShareReason(accessibleObject: AccessibleObject, accessReason: AccessReason): void {
    if (accessReason.person !== undefined) {
        if (accessibleObject.accessReasons === undefined) {
            accessibleObject.accessReasons = {groups: []};
        }
        accessibleObject.accessReasons.person = accessReason.person;
    }

    if (accessReason.groupName !== undefined) {
        if (accessibleObject.accessReasons === undefined) {
            accessibleObject.accessReasons = {groups: []};
        }
        accessibleObject.accessReasons.groups.push(accessReason.groupName);
    }
}

/**
 * Adds the id object and all versions to the map of accessible objects.
 *
 * @param {Map} accessibleObjects
 * @param {SHA256Hash<IdAccess>} idAccessObjHash
 * @param {AccessReason} accessReason
 */
async function addVersionedObjToAccessibleObjectsMap(
    accessibleObjects: Map<SHA256Hash | SHA256IdHash, AccessibleObject>,
    idAccessObjHash: SHA256Hash<IdAccess>,
    accessReason: AccessReason
): Promise<void> {
    const idHashUnchecked = (await getObject(idAccessObjHash)).id;
    const idObj = await getIdObject(idHashUnchecked);

    const idHash = idHashUnchecked as SHA256IdHash<OneVersionedObjectTypes>;

    // Add the id object to list of accessible hashes
    // We need to share it, because if no versions exist, then at least we need to share the id
    // object.
    const accessibleIdObject = getOrCreate(accessibleObjects, idHash, {
        type: 'id',
        idHash,
        oneType: idObj.$type$
    });
    appendShareReason(accessibleIdObject, accessReason);

    // Add versions to the list of accessible hashes
    const versions = await getVersionsNodeHashes(idHash);

    if (versions === undefined || versions.length === 0) {
        return;
    }

    for (const version of versions) {
        const accessibleVersionNode = getOrCreate(accessibleObjects, version, {
            type: 'version_node',
            node: version,
            dataIdHash: idHash,
            dataType: idObj.$type$
        });
        appendShareReason(accessibleVersionNode, accessReason);
    }
}

/**
 * Adds the object and all versions to the map of accessible objects.
 *
 * @param {Map} accessibleObjects
 * @param {SHA256Hash<Access>} accessObjHash
 * @param {AccessReason} accessReason
 */
async function addObjToAccessibleObjectsMap(
    accessibleObjects: Map<SHA256Hash | SHA256IdHash, AccessibleObject>,
    accessObjHash: SHA256Hash<Access>,
    accessReason: AccessReason
): Promise<void> {
    const accessObj = await getObject(accessObjHash);

    // Determine whether it is a versioned or an unversioned object
    const idHash = await calculateIdHashForStoredObj(
        accessObj.object as SHA256Hash<OneVersionedObjectTypes>
    );

    if (idHash === undefined) {
        const accessibleObject = getOrCreate(accessibleObjects, accessObj.object, {
            type: 'unversioned',
            hash: accessObj.object as SHA256Hash<OneUnversionedObjectTypes>,
            oneType: ((await getObject(accessObj.object)) as OneUnversionedObjectTypes).$type$
        });
        appendShareReason(accessibleObject, accessReason);
    } else {
        const accessibleObject = getOrCreate(accessibleObjects, accessObj.object, {
            type: 'versioned',
            hash: accessObj.object as SHA256Hash<OneVersionedObjectTypes>,
            idHash,
            oneType: ((await getObject(accessObj.object)) as OneVersionedObjectTypes).$type$
        });
        appendShareReason(accessibleObject, accessReason);
    }
}
