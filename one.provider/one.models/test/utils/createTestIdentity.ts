import tweetnacl from 'tweetnacl';

import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Keys, Person} from '@refinio/one.core/lib/recipes.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

/**
 * Create a new identity with public & private keys
 *
 * This will generate a Person, and a Keys object with the person set as owner.
 * @param email - The email used for the person object.
 */
export async function createTestIdentity(email: string): Promise<{
    keyPair: tweetnacl.BoxKeyPair;
    signKeyPair: tweetnacl.SignKeyPair;
    person: SHA256IdHash<Person>;
    keys: SHA256Hash<Keys>;
}> {
    const keyPair = tweetnacl.box.keyPair();
    const signKeyPair = tweetnacl.sign.keyPair();
    const personResult = await storeVersionedObject<Person>({
        $type$: 'Person',
        email
    });
    if (personResult.status !== 'new') {
        throw new Error('The person with the specified ID already exists.');
    }
    const keys = (
        await storeUnversionedObject<Keys>({
            $type$: 'Keys',
            owner: personResult.idHash,
            publicKey: uint8arrayToHexString(keyPair.publicKey),
            publicSignKey: uint8arrayToHexString(signKeyPair.publicKey)
        })
    ).hash;

    return {
        keyPair,
        signKeyPair,
        person: personResult.idHash,
        keys
    };
}
