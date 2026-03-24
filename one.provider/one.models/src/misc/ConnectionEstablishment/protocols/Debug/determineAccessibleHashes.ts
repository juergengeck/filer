import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {
    Access,
    IdAccess,
    OneIdObjectTypes,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypeNames,
    OneVersionedObjectTypes,
    Person
} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getVersionsNodes} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashForStoredObj} from '@refinio/one.core/lib/microdata-to-id-hash.js';
import {getOnlyLatestReferencingObjsHashAndId} from '@refinio/one.core/lib/reverse-map-query.js';
import {getOrCreate} from '../../../../utils/MapUtils.js';

export type AccessReasons = {
    person?: SHA256IdHash<Person>;
    groups: string[];
};

export type AccessibleUnversionedObject = {
    type: 'unversioned';
    hash: SHA256Hash<OneUnversionedObjectTypes>;
    obj: OneUnversionedObjectTypes;
    accessReasons?: AccessReasons;
};

export type AccessibleVersionedObject = {
    type: 'versioned';
    hash: SHA256Hash<OneVersionedObjectTypes>;
    idHash: SHA256IdHash;
    oneType: OneVersionedObjectTypeNames;
    timestamps: number[];
    accessReasons?: AccessReasons;
};

export type AccessibleIdObject = {
    type: 'id';
    idHash: SHA256IdHash;
    idObj: OneIdObjectTypes;
    accessReasons?: AccessReasons;
};

export type AccessibleObject =
    | AccessibleUnversionedObject
    | AccessibleVersionedObject
    | AccessibleIdObject;

/**
 * Returns a list of all objects that are accessible by a specific user.
 *
 * @param person
 */
export async function determineAccessibleObjects(
    person: SHA256IdHash<Person>
): Promise<AccessibleObject[]> {
    const accessibleObjects = new Map<SHA256Hash | SHA256IdHash, AccessibleObject>();

    // Determine access objs
    // Determine id access objs
    const personAccessObjs = await getOnlyLatestReferencingObjsHashAndId(person, 'Access');
    const personIdAccessObjs = await getOnlyLatestReferencingObjsHashAndId(person, 'IdAccess');

    for (const accessObjHashes of personAccessObjs) {
        await addObjToAccessibleObjectsMap(accessibleObjects, accessObjHashes.hash, {person});
    }
    for (const idAccessObjHashes of personIdAccessObjs) {
        await addVersionedObjToAccessibleObjectsMap(accessibleObjects, idAccessObjHashes.hash, {
            person
        });
    }

    // Determine groups
    const groupsContainingPerson = await getOnlyLatestReferencingObjsHashAndId(person, 'Group');

    // Determine access objs
    // Determine id access objs
    for (const group of groupsContainingPerson) {
        const groupName = (await getIdObject(group.idHash)).name;
        const groupAccess = await getOnlyLatestReferencingObjsHashAndId(group.idHash, 'Access');
        const groupIdAccess = await getOnlyLatestReferencingObjsHashAndId(group.idHash, 'IdAccess');
        for (const accessObjHashes of groupAccess) {
            await addObjToAccessibleObjectsMap(accessibleObjects, accessObjHashes.hash, {
                groupName
            });
        }
        for (const idAccessObjHashes of groupIdAccess) {
            await addVersionedObjToAccessibleObjectsMap(accessibleObjects, idAccessObjHashes.hash, {
                groupName
            });
        }
    }

    return [...accessibleObjects.values()];
}

// #### Private interface ####

type AccessReason = {
    person?: SHA256IdHash<Person>;
    groupName?: string;
};

/**
 * Appends the reason why the object was shared to the accessible object.
 */
function appendShareReason(accessibleObject: AccessibleObject, accessReason: AccessReason) {
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
 * @param accessibleObjects
 * @param idAccessObjHash
 * @param accessReason
 */
async function addVersionedObjToAccessibleObjectsMap(
    accessibleObjects: Map<SHA256Hash | SHA256IdHash, AccessibleObject>,
    idAccessObjHash: SHA256Hash<IdAccess>,
    accessReason: AccessReason
): Promise<void> {
    const idHash = (await getObject(idAccessObjHash)).id;
    const idObj = await getIdObject(idHash);

    // Add the id object to list of accessable hashes
    const accessibleIdObject = getOrCreate(accessibleObjects, idHash, {
        type: 'id',
        idHash,
        idObj
    });
    appendShareReason(accessibleIdObject, accessReason);

    // Add all versions to the list of accessable hashes
    const versions = await getVersionsNodes(idHash);

    for (const version of versions) {
        const accessibleObject = getOrCreate(accessibleObjects, version.data, {
            type: 'versioned',
            hash: version.data,
            idHash,
            oneType: idObj.$type$,
            timestamps: []
        });

        if (accessibleObject.type === 'versioned') {
            accessibleObject.timestamps.push(version.creationTime);
        }
    }
}

/**
 * Adds the object and all versions to the map of accessible objects.
 *
 * @param accessibleObjects
 * @param accessObjHash
 * @param accessReason
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
            obj: (await getObject(accessObj.object)) as OneUnversionedObjectTypes
        });
        appendShareReason(accessibleObject, accessReason);
    } else {
        const idObj = await getIdObject(idHash);
        getOrCreate(accessibleObjects, idHash, {
            type: 'id',
            idHash,
            idObj
        });
        const accessibleObject = getOrCreate(accessibleObjects, accessObj.object, {
            type: 'versioned',
            hash: accessObj.object as SHA256Hash<OneVersionedObjectTypes>,
            idHash,
            oneType: idObj.$type$,
            timestamps: []
        });
        appendShareReason(accessibleObject, accessReason);
    }
}
