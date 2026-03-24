/**
 * @author Erik Haßlmeyer <erik.hasslmeyer@refinio.net>
 * @copyright REFINIO GmbH 2022
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {fromByteArray as fromByteArrayToBase64} from 'base64-js';

import type {CryptoApi} from '../crypto/CryptoApi.js';
import type {KeyPair} from '../crypto/encryption.js';
import {createKeyPair} from '../crypto/encryption.js';
import type {SignKeyPair} from '../crypto/sign.js';
import {createSignKeyPair} from '../crypto/sign.js';
import {createError} from '../errors.js';
import {createMessageBus} from '../message-bus.js';
import type {Instance, Keys, Person} from '../recipes.js';
import {getAllEntries} from '../reverse-map-query.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';
import {getSecretKeys, hasSecretKeys} from './key-storage-secret.js';
import {createCryptoApi, storeKeys} from './key-storage.js';
import {MasterKeyManager} from './master-key-manager.js';

const MessageBus = createMessageBus('keychain-person');
const masterKeyManager = new MasterKeyManager('keychain_masterkey', 'keychain_salt');

// ######## Keychain lock / unlock ########

/**
 * Unlock the keychain.
 *
 * This will derive a key from the secret and store the master key in memory.
 *
 * @param {string} secret
 * @returns {Promise<void>}
 */
export async function unlockOrCreateKeyChain(secret: string): Promise<void> {
    await masterKeyManager.loadOrCreateMasterKey(secret);
}

/**
 * Lock the keychain.
 *
 * The master key is purged from memory and all other keychain functions won't work anymore.
 */
export function lockKeyChain(): void {
    masterKeyManager.unloadMasterKey();
}

/**
 * Changes the secret used to unlock the keychain.
 *
 * @param {string} oldSecret
 * @param {string} newSecret
 */
export async function changeKeyChainSecret(oldSecret: string, newSecret: string): Promise<void> {
    await masterKeyManager.changeSecret(oldSecret, newSecret);
}

// ######## get crypto apis ########

/**
 * Create a crypto functions for a person or instance.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<CryptoApi>}
 */
export async function createCryptoApiFromDefaultKeys(
    owner: SHA256IdHash<Person | Instance>
): Promise<CryptoApi> {
    const defaultKeys = await getDefaultKeys(owner);
    return createCryptoApi(defaultKeys, masterKeyManager);
}

// ######## Get keys associated with a specific owner ########

/**
 * Get a list of all keys associated with this owner.
 *
 * Note: Incomplete keys are not trustworthy. The Keys object could have been sent from anyone.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<Array<{keys: SHA256Hash<Keys>, complete: boolean, default: boolean}>>}
 */
export async function getListOfKeys(owner: SHA256IdHash<Person | Instance>): Promise<
    Array<{
        keys: SHA256Hash<Keys>;
        complete: boolean;
        default: boolean;
    }>
> {
    const keysObjs = await getAllEntries(owner, 'Keys');
    return Promise.all(
        keysObjs.map(async keysObj => {
            const secretKeysExist = await hasSecretKeys(keysObj);
            return {keys: keysObj, complete: secretKeysExist, default: secretKeysExist};
        })
    );
}

/**
 * Get incomplete keys associated with a person.
 *
 * Incomplete means, that you do not possess secret keys for this keys object.
 *
 * Note: The keys are not trustworthy. The Keys object could have been sent from anyone.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<Array<SHA256Hash<Keys>>>}
 */
export async function getListOfIncompleteKeys(
    owner: SHA256IdHash<Person | Instance>
): Promise<Array<SHA256Hash<Keys>>> {
    const listOfKeys = await getListOfKeys(owner);
    return listOfKeys.filter(keys => !keys.complete).map(keys => keys.keys);
}

/**
 * Get a list of complete keys associated with a person.
 *
 * Note: You can trust complete keys, because the secret part can only be written by yourself.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<Array<{keys: SHA256Hash<Keys>, default: boolean}>>}
 */
export async function getListOfCompleteKeys(owner: SHA256IdHash<Person | Instance>): Promise<
    Array<{
        keys: SHA256Hash<Keys>;
        default: boolean;
    }>
> {
    const listOfKeys = await getListOfKeys(owner);
    return listOfKeys
        .filter(keys => keys.complete)
        .map(keys => ({keys: keys.keys, default: keys.default}));
}

/**
 * Get the person keys for which we have the secret part (hence complete)
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<SHA256Hash<Keys>>}
 */
export async function getDefaultKeys(
    owner: SHA256IdHash<Person | Instance>
): Promise<SHA256Hash<Keys>> {
    const listOfKeys = await getListOfKeys(owner);
    const defaultKeys = listOfKeys.filter(keys => keys.default);

    if (defaultKeys.length === 0) {
        throw createError('KEYCH-NODEFKEYS', {owner});
    }

    if (defaultKeys.length > 1) {
        MessageBus.send(
            'Error',
            'We have more than one complete set keys. That is currently not expected.'
        );
    }

    return defaultKeys[0].keys;
}

/**
 * Get the person keys for which we have the secret part (hence complete)
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<{secretEncryptionKey:string,secretSignKey:string}>}
 */
export async function getDefaultSecretKeysAsBase64(owner: SHA256IdHash<Person>): Promise<{
    secretEncryptionKey: string;
    secretSignKey: string;
}> {
    const keys = await getDefaultKeys(owner);
    const {secretEncryptionKey, secretSignKey} = await getSecretKeys(keys, masterKeyManager);

    return {
        secretEncryptionKey: fromByteArrayToBase64(secretEncryptionKey),
        secretSignKey: fromByteArrayToBase64(secretSignKey)
    };
}

/**
 * Returns whether we have a complete keypair for a person.
 *
 * 'Complete' means that we have public and secret keys.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @returns {Promise<boolean>}
 */
export async function hasDefaultKeys(owner: SHA256IdHash<Person | Instance>): Promise<boolean> {
    const listOfKeys = await getListOfKeys(owner);
    return listOfKeys.some(keys => keys.default);
}

// ######## Keys creation ########

/**
 * Create new default encryption and sign key pairs for a person.
 *
 * If a default keypair already exists, this function will fail. At the moment this is to ensure,
 * that we only have a single private key for a person (will change in the future - but makes things
 * easier right now).
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @param {KeyPair} encryptionKeyPair - If keypair is omitted, create a random keypair
 * @param {SignKeyPair} signKeyPair - If keypair is omitted, create a random keypair
 * @returns {Promise<SHA256Hash<Keys>>}
 */
export async function createDefaultKeys(
    owner: SHA256IdHash<Person | Instance>,
    encryptionKeyPair: KeyPair = createKeyPair(),
    signKeyPair: SignKeyPair = createSignKeyPair()
): Promise<SHA256Hash<Keys>> {
    masterKeyManager.ensureMasterKeyLoaded();

    if (await hasDefaultKeys(owner)) {
        throw createError('KEYCH-HASDEFKEYS');
    }

    return (await storeKeys(owner, encryptionKeyPair, signKeyPair, masterKeyManager)).hash;
}

/**
 * Same as createDefaultKeys() but skip if default keys already exist.
 *
 * @param {SHA256IdHash<Person | Instance>} owner
 * @param {('owner'|'instance')} keyType
 * @param {KeyPair} [encryptionKeyPairParam]
 * @param {SignKeyPair} [signKeyPairParam]
 * @returns {Promise<SHA256Hash<Keys>>}
 */
export async function createDefaultKeysIfNotExist(
    owner: SHA256IdHash<Person | Instance>,
    keyType: 'owner' | 'instance',
    encryptionKeyPairParam?: KeyPair,
    signKeyPairParam?: SignKeyPair
): Promise<{keys: SHA256Hash<Keys>; exists: boolean}> {
    if (
        // If any key is provided...
        (encryptionKeyPairParam !== undefined || signKeyPairParam !== undefined) &&
        // ... then *all* must be provided.
        (encryptionKeyPairParam === undefined || signKeyPairParam === undefined)
    ) {
        throw createError('KEYCH-CDK1', {
            keyType,
            encType: typeof encryptionKeyPairParam,
            sigType: typeof signKeyPairParam
        });
    }

    const encryptionKeyPair = encryptionKeyPairParam ?? createKeyPair();
    const signKeyPair = signKeyPairParam ?? createSignKeyPair();

    if (await hasDefaultKeys(owner)) {
        const keys = await getDefaultKeys(owner);

        return {
            keys,
            exists: true
        };
    } else {
        const keysResult = await storeKeys(owner, encryptionKeyPair, signKeyPair, masterKeyManager);

        return {
            keys: keysResult.hash,
            exists: false
        };
    }
}
