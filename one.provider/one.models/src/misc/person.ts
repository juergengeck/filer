import type {Keys, Person} from '@refinio/one.core/lib/recipes.js';
import {exists} from '@refinio/one.core/lib/system/storage-base.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import {storeIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {createDefaultKeys, hasDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {hasPersonLocalInstance} from './instance.js';

/**
 * Creates a new person by creating a Person IdObject.
 *
 * Throws if the person with this email already exists.
 *
 * @param email
 */
export async function createPerson(email?: string): Promise<SHA256IdHash<Person>> {
    const result = await createPersonIfNotExist(email);

    if (result.exists) {
        throw new Error('Person already exists');
    }

    return result.personId;
}

/**
 * Creates a new person by creating a Person IdObject.
 *
 * @param email
 */
export async function createPersonIfNotExist(email?: string): Promise<{
    personId: SHA256IdHash<Person>;
    exists: boolean;
}> {
    if (email === undefined) {
        email = await createRandomString(64);
    }

    const status = await storeIdObject({
        $type$: 'Person',
        email
    });

    return {
        personId: status.idHash,
        exists: status.status === 'exists'
    };
}

/**
 * Creates a person with a default set of keys.
 *
 * @param email
 */
export async function createPersonWithDefaultKeys(email?: string): Promise<{
    personId: SHA256IdHash<Person>;
    personKeys: SHA256Hash<Keys>;
}> {
    const personId = await createPerson(email);
    const personKeys = await createDefaultKeys(personId);
    return {personId, personKeys};
}

/**
 * Checks if a person is a 'complete' person.
 *
 * What does 'complete' mean? It means that you can impersonate this person because you have secret
 * keys that should prove that you are this person. And you also have an instance with private
 * keys so that you can open connections with this person.
 *
 * @param person
 */
export async function isPersonComplete(person: SHA256IdHash<Person>): Promise<boolean> {
    if (!(await hasDefaultKeys(person))) {
        return false;
    }

    return await hasPersonLocalInstance(person);
}

/**
 * Check if person exists.
 *
 * @param personId
 */
export async function doesPersonExist(personId: SHA256IdHash<Person>): Promise<boolean> {
    return exists(personId);
}

/**
 * Check if person exists
 *
 * @param email
 */
export async function doesPersonExistByEmail(email: string): Promise<boolean> {
    return doesPersonExist(await calculateIdHashOfObj({$type$: 'Person', email}));
}
