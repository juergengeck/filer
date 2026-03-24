import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Instance, Keys, Person} from '@refinio/one.core/lib/recipes.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {getListOfKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {getInstancesOfPerson} from '../../misc/instance.js';
import type SomeoneModel from '../../models/Leute/SomeoneModel.js';

// ######## Keys ########

export type PrettyKeys = {
    complete: boolean;
    default: boolean;
    publicEncryptionKey: HexString;
    publicSignKey: HexString;
};

async function prettifyKeys(
    hash: SHA256Hash<Keys>,
    complete: boolean,
    deflt: boolean
): Promise<PrettyKeys> {
    const keys = await getObject(hash);
    return {
        complete: complete,
        default: deflt,
        publicEncryptionKey: keys.publicKey,
        publicSignKey: keys.publicSignKey
    };
}

// ######## Keys for owner ########

export type PrettyKeysList = Record<SHA256Hash<Keys>, PrettyKeys>;

async function prettifyKeysForOwner(
    owner: SHA256IdHash<Person | Instance>
): Promise<PrettyKeysList> {
    const keys = await getListOfKeys(owner);

    const prettyKeysArray = await Promise.all(
        keys.map(async function (key): Promise<[SHA256Hash<Keys>, PrettyKeys]> {
            return [key.keys, await prettifyKeys(key.keys, key.complete, key.default)];
        })
    );

    const prettyKeysList: PrettyKeysList = {};
    for (const prettyKeys of prettyKeysArray) {
        prettyKeysList[prettyKeys[0]] = prettyKeys[1];
    }

    return prettyKeysList;
}

// ######## Instance ########

export type PrettyInstanceWithKeys = {
    local: boolean;
    keys: PrettyKeysList;
};

async function prettifyInstanceWithKeys(
    instance: SHA256IdHash<Instance>,
    local: boolean
): Promise<Promise<PrettyInstanceWithKeys>> {
    return {
        local,
        keys: await prettifyKeysForOwner(instance)
    };
}

// ######## Instances for owner ########

export type PrettyInstancesWithKeys = Record<SHA256IdHash<Instance>, PrettyInstanceWithKeys>;

async function prettifyInstancesWithKeysForOwner(
    owner: SHA256IdHash<Person>
): Promise<PrettyInstancesWithKeys> {
    const instances = await getInstancesOfPerson(owner);

    const prettyInstances = await Promise.all(
        instances.map(async function (instance): Promise<
            [SHA256IdHash<Instance>, PrettyInstanceWithKeys]
        > {
            return [
                instance.instanceId,
                await prettifyInstanceWithKeys(instance.instanceId, instance.local)
            ];
        })
    );

    const prettyInstanceList: PrettyInstancesWithKeys = {};
    for (const prettyInstance of prettyInstances) {
        prettyInstanceList[prettyInstance[0]] = prettyInstance[1];
    }

    return prettyInstanceList;
}

// ######## Person ########

export type PrettyPersonWithKeysAndInstances = {
    main: boolean;
    keys: PrettyKeysList;
    instances: PrettyInstancesWithKeys;
};

async function prettifyPersonWithKeysAndInstancesWithKeys(
    person: SHA256IdHash<Person>,
    main: boolean
): Promise<Promise<PrettyPersonWithKeysAndInstances>> {
    return {
        main,
        keys: await prettifyKeysForOwner(person),
        instances: await prettifyInstancesWithKeysForOwner(person)
    };
}

// ######## Persons ########

export type PrettyPersonsWithKeysAndInstances = Record<
    SHA256IdHash<Person>,
    PrettyPersonWithKeysAndInstances
>;

export async function prettifyPersonsWithKeysAndInstances(
    persons: {personId: SHA256IdHash<Person>; main: boolean}[]
): Promise<PrettyPersonsWithKeysAndInstances> {
    const prettyPersons = await Promise.all(
        persons.map(async function (person): Promise<
            [SHA256IdHash<Person>, PrettyPersonWithKeysAndInstances]
        > {
            return [
                person.personId,
                await prettifyPersonWithKeysAndInstancesWithKeys(person.personId, person.main)
            ];
        })
    );

    const prettyPersonList: PrettyPersonsWithKeysAndInstances = {};
    for (const prettyPerson of prettyPersons) {
        prettyPersonList[prettyPerson[0]] = prettyPerson[1];
    }

    return prettyPersonList;
}

// ######## Someones ########

export async function prettifySomeoneWithKeysAndInstances(
    someone: SomeoneModel
): Promise<PrettyPersonsWithKeysAndInstances> {
    const mainId = await someone.mainIdentity();
    const identities = someone.identities();

    return prettifyPersonsWithKeysAndInstances(
        identities.map(identity => ({
            personId: identity,
            main: identity === mainId
        }))
    );
}
