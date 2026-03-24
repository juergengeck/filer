/**
 * This file implements helper functions to generate and import / export identities.
 * @module
 */

import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {isHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import {getIdObject, storeIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {createRandomString} from '@refinio/one.core/lib/system/crypto-helpers.js';
import type {CommunicationEndpointTypes} from '../recipes/Leute/CommunicationEndpoints.js';
import type {OneInstanceEndpoint} from '../recipes/Leute/CommunicationEndpoints.js';
import type {PersonDescriptionTypes} from '../recipes/Leute/PersonDescriptions.js';
import {sign} from './Signature.js';
import ProfileModel from '../models/Leute/ProfileModel.js';
import type {InstanceOptions} from '@refinio/one.core/lib/instance.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    hexToUint8ArrayWithCheck,
    isHexString,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    createKeyPair,
    ensurePublicKey,
    ensureSecretKey
} from '@refinio/one.core/lib/crypto/encryption.js';
import {
    createSignKeyPair,
    ensurePublicSignKey,
    ensureSecretSignKey
} from '@refinio/one.core/lib/crypto/sign.js';

// ######## Identity types ########

/**
 * Everything that is needed to contact an identity.
 */
export type Identity = {
    type: 'public';
    personEmail: string;
    instanceName: string;
    personKeyPublic: HexString;
    personSignKeyPublic: HexString;
    instanceKeyPublic: HexString;
    instanceSignKeyPublic: HexString;
    url?: string;
};

/**
 * Everything that is needed to impersonate an identity.
 *
 * This has the private keys in it, so it is very sensitive.
 */
export type IdentityWithSecrets = {
    type: 'secret';
    personEmail: string;
    instanceName: string;
    personKeySecret: HexString;
    personKeyPublic: HexString;
    personSignKeySecret: HexString;
    personSignKeyPublic: HexString;
    instanceKeySecret: HexString;
    instanceKeyPublic: HexString;
    instanceSignKeySecret: HexString;
    instanceSignKeyPublic: HexString;
    url?: string;
};

/**
 * Check if passed object is an identity object.
 *
 * @param arg
 */
export function isIdentity(arg: any): arg is Identity {
    return (
        arg !== null &&
        arg.type === 'public' &&
        typeof arg.personEmail === 'string' &&
        typeof arg.instanceName === 'string' &&
        isHexString(arg.personKeyPublic) &&
        isHexString(arg.personSignKeyPublic) &&
        isHexString(arg.instanceKeyPublic) &&
        isHexString(arg.instanceSignKeyPublic) &&
        (typeof arg.url === 'string' || typeof arg.url === 'undefined')
    );
}

/**
 * Check if passed object is an identity object with private keys.
 *
 * @param arg
 */
export function isIdentityWithSecrets(arg: any): arg is IdentityWithSecrets {
    return (
        arg !== null &&
        arg.type === 'secret' &&
        typeof arg.personEmail === 'string' &&
        typeof arg.instanceName === 'string' &&
        isHexString(arg.personKeySecret) &&
        isHexString(arg.personKeyPublic) &&
        isHexString(arg.personSignKeySecret) &&
        isHexString(arg.personSignKeyPublic) &&
        isHexString(arg.instanceKeySecret) &&
        isHexString(arg.instanceKeyPublic) &&
        isHexString(arg.instanceSignKeySecret) &&
        isHexString(arg.instanceSignKeyPublic) &&
        (typeof arg.url === 'string' || typeof arg.url === 'undefined')
    );
}

/**
 * Creates a new identity.
 *
 * Does not need a running one instance. It will generate new key pairs and if no personEmail or
 * instanceName is specified it will also generate random values for those.
 *
 * @param url - The communication server url to include in the identity objects.
 * @param personEmail - The person email to use. If not specified a random string is used.
 * @param instanceName - The instance name to use. If not specified a random string is used.
 */
export async function generateNewIdentity(
    url?: string,
    personEmail?: string,
    instanceName?: string
): Promise<{
    secret: IdentityWithSecrets;
    public: Identity;
}> {
    if (personEmail === undefined) {
        personEmail = await createRandomString();
    }
    if (instanceName === undefined) {
        instanceName = await createRandomString();
    }
    const personKeyPair = createKeyPair();
    const personSignKeyPair = createSignKeyPair();
    const instanceKeyPair = createKeyPair();
    const instanceSignKeyPair = createSignKeyPair();

    const identityWithSecrets: IdentityWithSecrets = {
        type: 'secret',
        personEmail,
        instanceName,
        personKeySecret: uint8arrayToHexString(personKeyPair.secretKey),
        personKeyPublic: uint8arrayToHexString(personKeyPair.publicKey),
        personSignKeySecret: uint8arrayToHexString(personSignKeyPair.secretKey),
        personSignKeyPublic: uint8arrayToHexString(personSignKeyPair.publicKey),
        instanceKeySecret: uint8arrayToHexString(instanceKeyPair.secretKey),
        instanceKeyPublic: uint8arrayToHexString(instanceKeyPair.publicKey),
        instanceSignKeySecret: uint8arrayToHexString(instanceSignKeyPair.secretKey),
        instanceSignKeyPublic: uint8arrayToHexString(instanceSignKeyPair.publicKey),
        url
    };

    const identity: Identity = {
        type: 'public',
        personEmail,
        instanceName,
        personKeyPublic: uint8arrayToHexString(personKeyPair.publicKey),
        personSignKeyPublic: uint8arrayToHexString(personSignKeyPair.publicKey),
        instanceKeyPublic: uint8arrayToHexString(instanceKeyPair.publicKey),
        instanceSignKeyPublic: uint8arrayToHexString(instanceSignKeyPair.publicKey),
        url
    };

    return {
        secret: identityWithSecrets,
        public: identity
    };
}

/**
 * Creates a one instance object from an identity object.
 *
 * This also signs the keys with our own key, so that they are considered trusted keys.
 *
 * @param identity
 */
export async function convertIdentityToOneInstanceEndpoint(
    identity: Identity
): Promise<UnversionedObjectResult<OneInstanceEndpoint>> {
    // Step 1: Create person object if it does not exist, yet
    const personHash = (
        await storeIdObject({
            $type$: 'Person',
            email: identity.personEmail
        })
    ).idHash;

    // Step 2: Create person keys object
    const personKeysHash = (
        await storeUnversionedObject({
            $type$: 'Keys',
            owner: personHash,
            publicKey: identity.personKeyPublic,
            publicSignKey: identity.personSignKeyPublic
        })
    ).hash;

    // Step 3: Create person object if it does not exist, yet
    const instanceHash = (
        await storeIdObject({
            $type$: 'Instance',
            name: identity.instanceName,
            owner: personHash
        })
    ).idHash as SHA256IdHash<Instance>;

    // Step 4: Create instance keys object
    const instanceKeysHash = (
        await storeUnversionedObject({
            $type$: 'Keys',
            owner: instanceHash,
            publicKey: identity.instanceKeyPublic,
            publicSignKey: identity.instanceSignKeyPublic
        })
    ).hash;

    // Sign keys
    await sign(personKeysHash);
    await sign(instanceKeysHash);

    // Construct the OneInstanceEndpoint
    return storeUnversionedObject({
        $type$: 'OneInstanceEndpoint',
        personId: personHash,
        personKeys: personKeysHash,
        instanceId: instanceHash,
        instanceKeys: instanceKeysHash,
        url: identity.url
    });
}

/**
 * Creates an identity object from a oneInstanceEndpoint hash
 *
 * @param oneInstanceEndpointOrHash
 */
export async function convertOneInstanceEndpointToIdentity(
    oneInstanceEndpointOrHash: SHA256Hash<OneInstanceEndpoint> | OneInstanceEndpoint
): Promise<Identity> {
    const oneInstanceEndpoint = isHash(oneInstanceEndpointOrHash)
        ? await getObject(oneInstanceEndpointOrHash)
        : oneInstanceEndpointOrHash;
    if (oneInstanceEndpoint.personKeys === undefined) {
        throw new Error('Person keys must not be undefined when exporting a OneInstanceEndpoint.');
    }
    const person = await getIdObject(oneInstanceEndpoint.personId);
    const personKeys = await getObject(oneInstanceEndpoint.personKeys);
    const instance = await getIdObject(oneInstanceEndpoint.instanceId);
    const instanceKeys = await getObject(oneInstanceEndpoint.instanceKeys);
    if (personKeys.publicSignKey === undefined) {
        throw new Error('Person needs a sign key when exporting a OneInstanceEndpoint.');
    }

    return {
        type: 'public',
        personEmail: person.email,
        instanceName: instance.name,
        personKeyPublic: personKeys.publicKey,
        personSignKeyPublic: personKeys.publicSignKey,
        instanceKeyPublic: instanceKeys.publicKey,
        instanceSignKeyPublic: instanceKeys.publicSignKey,
        url: oneInstanceEndpoint.url
    };
}

/**
 * Create a profile from an identity file.
 *
 * This profile will have a single OneInstanceEndpoint if it didn't exist before.
 * If it existed, the OneInstanceEndpoint will be added to the existing profile.
 *
 * @param identity - The identity that is added to the profile
 * @param profileId - The profile identity string. Defaults to 'default'.
 * @param owner - The owner of the profile. If undefined use the owner personId of the Identity.
 * @param communicationEndpoints
 * @param personDescriptions
 */
export async function convertIdentityToProfile(
    identity: Identity,
    profileId: string = 'default',
    owner?: SHA256IdHash<Person>,
    communicationEndpoints: CommunicationEndpointTypes[] = [],
    personDescriptions: PersonDescriptionTypes[] = []
): Promise<ProfileModel> {
    const oneInstanceEndpoint = await convertIdentityToOneInstanceEndpoint(identity);
    const personId = oneInstanceEndpoint.obj.personId;
    return await ProfileModel.constructWithNewProfile(
        personId,
        owner === undefined ? personId : owner,
        profileId,
        [oneInstanceEndpoint.obj, ...communicationEndpoints],
        [{$type$: 'SignKey', key: identity.personSignKeyPublic}, ...personDescriptions]
    );
}

/**
 * Creates instance options based on an identity.
 *
 * @param identity
 * @param secret - secret is mandatory for InstanceOptions => this is used 1:1
 */
export function convertIdentityToInstanceOptions(
    identity: Identity | IdentityWithSecrets,
    secret: string
): InstanceOptions {
    if (isIdentity(identity)) {
        return {
            name: identity.instanceName,
            email: identity.personEmail,
            secret
        };
    } else {
        return {
            name: identity.instanceName,
            email: identity.personEmail,
            personEncryptionKeyPair: {
                publicKey: ensurePublicKey(hexToUint8ArrayWithCheck(identity.personKeyPublic)),
                secretKey: ensureSecretKey(hexToUint8ArrayWithCheck(identity.personKeySecret))
            },
            personSignKeyPair: {
                publicKey: ensurePublicSignKey(
                    hexToUint8ArrayWithCheck(identity.personSignKeyPublic)
                ),
                secretKey: ensureSecretSignKey(
                    hexToUint8ArrayWithCheck(identity.personSignKeySecret)
                )
            },
            instanceEncryptionKeyPair: {
                publicKey: ensurePublicKey(hexToUint8ArrayWithCheck(identity.instanceKeyPublic)),
                secretKey: ensureSecretKey(hexToUint8ArrayWithCheck(identity.instanceKeySecret))
            },
            instanceSignKeyPair: {
                publicKey: ensurePublicSignKey(
                    hexToUint8ArrayWithCheck(identity.instanceSignKeyPublic)
                ),
                secretKey: ensureSecretSignKey(
                    hexToUint8ArrayWithCheck(identity.instanceSignKeySecret)
                )
            },
            secret
        };
    }
}
