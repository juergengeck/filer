import type {Instance, Keys, Person} from '@refinio/one.core/lib/recipes.js';
import {exists} from '@refinio/one.core/lib/system/storage-base.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {getAllIdObjectEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {storeIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    createDefaultKeys,
    getDefaultKeys,
    hasDefaultKeys
} from '@refinio/one.core/lib/keychain/keychain.js';

// ######## Local & Remote instance management ########

/**
 * Get the instance object representing this instance / device.
 *
 * This is the instance object for which we have a complete keypair.
 *
 * @param owner - The owner of the instance
 */
export async function getLocalInstanceOfPerson(
    owner: SHA256IdHash<Person>
): Promise<SHA256IdHash<Instance>> {
    const localInstances = (await getInstancesOfPerson(owner))
        .filter(i => i.local)
        .map(i => i.instanceId);
    if (localInstances.length === 0) {
        throw new Error('There are no local instances for that person');
    } else if (localInstances.length > 1) {
        throw new Error('There are multiple local instances for that person - that is a bug');
    }

    return localInstances[0];
}

/**
 * Get all instances that represent remote instances / devices.
 *
 * These are all instance objects for which we don't have a complete keypair (because they weren't
 * created on this device)
 *
 * @param owner - The owner of the instance
 */
export async function getRemoteInstancesOfPerson(
    owner: SHA256IdHash<Person>
): Promise<Array<SHA256IdHash<Instance>>> {
    return (await getInstancesOfPerson(owner)).filter(i => !i.local).map(i => i.instanceId);
}

/**
 * Get all instance objects owned by a specific person.
 *
 * @param owner - The owner of the instance
 */
export async function getInstancesOfPerson(owner: SHA256IdHash<Person>): Promise<
    Array<{
        instanceId: SHA256IdHash<Instance>;
        local: boolean;
    }>
> {
    const revMapEntries = await getAllIdObjectEntries(owner, 'Instance');

    return Promise.all(
        revMapEntries.map(async instanceId => {
            return {
                instanceId,
                local: await hasDefaultKeys(instanceId)
            };
        })
    );
}

/**
 * Check if we have a local instance object that is owned by this person.
 *
 * @param owner
 */
export async function hasPersonLocalInstance(owner: SHA256IdHash<Person>): Promise<boolean> {
    return (await getInstancesOfPerson(owner)).some(i => i.local);
}

/**
 * Creates a local instance if none already exists.
 *
 * This means that the instance will also have a complete set of keys associated with it.
 * This function will assert that only one local instance for this owner exists.
 *
 * @param owner
 * @param instanceName
 */
export async function createLocalInstanceIfNoneExists(
    owner: SHA256IdHash<Person>,
    instanceName?: string
): Promise<{
    instanceId: SHA256IdHash<Instance>;
    instanceKeys: SHA256Hash<Keys>;
    exists: boolean;
}> {
    const localInstances = (await getInstancesOfPerson(owner)).filter(i => i.local);

    // If local instance already exists return its information
    if (localInstances.length > 0) {
        return {
            instanceId: localInstances[0].instanceId,
            instanceKeys: await getDefaultKeys(localInstances[0].instanceId),
            exists: true
        };
    } else {
        const result = await createInstanceWithDefaultKeys(owner, instanceName);

        return {
            ...result,
            exists: false
        };
    }
}

// ######## Instance management ########

/**
 * Creates a new instance by creating the Instance IdObject.
 *
 * Throws if the instance with this name already exists.
 *
 * @param owner
 * @param instanceName
 */
export async function createInstance(
    owner: SHA256IdHash<Person>,
    instanceName?: string
): Promise<SHA256IdHash<Instance>> {
    const result = await createInstanceIfNotExist(owner, instanceName);

    if (result.exists) {
        throw new Error('Instance already exists');
    }

    return result.instanceId;
}

/**
 * Creates a new instance by creating the Instance IdObject.
 *
 * @param owner
 * @param instanceName
 */
export async function createInstanceIfNotExist(
    owner: SHA256IdHash<Person>,
    instanceName?: string
): Promise<{
    instanceId: SHA256IdHash<Instance>;
    exists: boolean;
}> {
    if (instanceName === undefined) {
        instanceName = await createRandomString(64);
    }

    const status = await storeIdObject({
        $type$: 'Instance',
        name: instanceName,
        owner
    });

    return {
        instanceId: status.idHash as SHA256IdHash<Instance>,
        exists: status.status === 'exists'
    };
}

/**
 * Creates an instance with a default set of keys.
 *
 * @param owner
 * @param instanceName
 */
export async function createInstanceWithDefaultKeys(
    owner: SHA256IdHash<Person>,
    instanceName?: string
): Promise<{
    instanceId: SHA256IdHash<Instance>;
    instanceKeys: SHA256Hash<Keys>;
}> {
    const instanceId = await createInstance(owner, instanceName);
    const instanceKeys = await createDefaultKeys(instanceId);
    return {instanceId, instanceKeys};
}

/**
 * Check if instance exists.
 *
 * @param instanceId
 */
export async function doesInstanceExist(instanceId: SHA256IdHash<Instance>): Promise<boolean> {
    return exists(instanceId);
}

/**
 * Check if instance exists.
 *
 * @param owner
 * @param instanceName
 */
export async function doesInstanceExistByOwnerAndName(
    owner: SHA256IdHash<Person>,
    instanceName: string
): Promise<boolean> {
    return doesInstanceExist(
        await calculateIdHashOfObj({$type$: 'Instance', owner, name: instanceName})
    );
}
