/*
  eslint-disable no-console,
  @typescript-eslint/no-use-before-define,
  @typescript-eslint/no-unsafe-call
 */

import type {KeyPair} from '../../lib/crypto/encryption.js';
import type {SignKeyPair} from '../../lib/crypto/sign.js';
import {closeInstance, deleteInstance, initInstance} from '../../lib/instance.js';
import {isVersionedObject} from '../../lib/object-recipes.js';
import type {
    Instance,
    OneObjectTypeNames,
    OneObjectTypes,
    OneVersionedObjectTypeNames,
    Recipe
} from '../../lib/recipes.js';
import type {AnyObjectCreation} from '../../lib/storage-base-common.js';
import {storeUnversionedObject} from '../../lib/storage-unversioned-objects.js';
import {storeVersionedObject, STORE_AS} from '../../lib/storage-versioned-objects.js';
import {isBrowser, SYSTEM} from '../../lib/system/platform.js';
import {SettingsStore} from '../../lib/system/settings-store.js';
import * as StorageBase from '../../lib/system/storage-base.js';
import type {AnyObject} from '../../lib/util/object.js';
import {isNumber, isString} from '../../lib/util/type-checks-basic.js';
import type {SHA256Hash} from '../../lib/util/type-checks.js';
import * as TestTypes from './_register-types.js';

export interface StorageHelpersInitOpts {
    email?: string;
    secret?: string;
    personEncryptionKeyPair?: KeyPair;
    personSignKeyPair?: SignKeyPair;
    instanceEncryptionKeyPair?: KeyPair;
    instanceSignKeyPair?: SignKeyPair;
    name?: string;
    dbKey?: string;
    addTypes?: boolean;
    deleteDb?: boolean;
    encryptStorage?: boolean;
    initialRecipes?: readonly Recipe[];
    initiallyEnabledReverseMapTypes?: Array<[OneObjectTypeNames, Set<string>]>;
    initiallyEnabledReverseMapTypesForIdObjects?: Array<[OneVersionedObjectTypeNames, Set<string>]>;
}

/**
 * @param {object} [options={}]
 * @param {string} [options.email]
 * @param {string|null} [options.secret]
 * @param {string} [options.name]
 * @param {string} [options.dbKey]
 * @param {boolean} [options.addTypes=true]
 * @param {boolean} [options.deleteDb=true]
 * @param {boolean} [options.encryptStorage=false]
 * @param {Array} [options.initiallyEnabledReverseMapTypes]
 * @param {Array} [options.initiallyEnabledReverseMapTypesForIdObjects]
 * @param {KeyPair|undefined} [options.personEncryptionKeyPair]
 * @param {SignKeyPair|undefined} [options.personSignKeyPair]
 * @param {KeyPair|undefined} [options.instanceEncryptionKeyPair]
 * @param {SignKeyPair|undefined} [options.instanceSignKeyPair]
 * @param {Recipe[]} [options.initialRecipes]
 * @returns {Promise<Instance>}
 */
export async function init({
    email = 'test@test.com',
    secret = 'SECRET PASSWORD',
    personEncryptionKeyPair,
    personSignKeyPair,
    instanceEncryptionKeyPair,
    instanceSignKeyPair,
    name = 'test',
    dbKey = 'testDb',
    addTypes = true,
    deleteDb = true,
    encryptStorage = isBrowser,
    initialRecipes = [],
    initiallyEnabledReverseMapTypes = [
        ['OneTest$Email', new Set(['*'])],
        ['OneTest$ReferenceTest', new Set(['*'])],
        ['OneTest$VersionedReferenceTest', new Set(['*'])]
    ],
    initiallyEnabledReverseMapTypesForIdObjects = [
        ['OneTest$VersionedReferenceTestAllId', new Set(['*'])]
    ]
}: StorageHelpersInitOpts = {}): Promise<Instance> {
    await import(`../../lib/system/load-${SYSTEM}.js`);

    const instanceObj = await initInstance({
        name,
        email,
        secret,
        personEncryptionKeyPair,
        personSignKeyPair,
        instanceEncryptionKeyPair,
        instanceSignKeyPair,
        wipeStorage: deleteDb,
        encryptStorage,
        directory: 'test/' + dbKey,
        initialRecipes,
        initiallyEnabledReverseMapTypes: new Map(initiallyEnabledReverseMapTypes),
        initiallyEnabledReverseMapTypesForIdObjects: new Map(
            initiallyEnabledReverseMapTypesForIdObjects
        )
    });

    if (addTypes) {
        TestTypes.addTestTypes();
    }

    return instanceObj;
}

/**
 * Frontend to deleteInstance that sets teh default values to the same ones used in init(). It
 * also ignores errors if the instance does not exist, since this is just for test cleanup.
 * @param {string} instanceName
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function remove(instanceName = 'test', email = 'test@test.com'): Promise<void> {
    closeInstance();

    try {
        await deleteInstance(instanceName, email);
    } catch (_) {
        // Ignore
    }

    await SettingsStore.clear();
}

/**
 * @param {string} type
 * @returns {Promise<SHA256Hash[]>}
 */
export async function getAllFileHashesOfType(type: string): Promise<SHA256Hash[]> {
    const hashes = await StorageBase.listAllObjectHashes();
    const types = await Promise.all(hashes.map(StorageBase.getFileType));
    return hashes.filter((_hash, index) => types[index] === type) as SHA256Hash[];
}

/**
 * Converts a raw byte count number to an easily human-readable string.
 * Thanks to {@link https://stackoverflow.com/a/20732091/544779}
 * @param {number} size
 * @returns {string}
 */
export function humanReadablyByteCount(size: number): string {
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number(size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

/**
 * Convert an object one level deep and with numeric values to a string for debugging output
 * with human-readable numbers.
 * @param {AnyObject} obj
 * @returns {string}
 */
export function objWithNumberValuesToReadableStr(obj: AnyObject): string {
    return Object.keys(obj)
        .map(key =>
            isNumber(obj[key])
                ? `${key}: ${humanReadablyByteCount(obj[key])}`
                : JSON.stringify(obj[key])
        )
        .join(', ');
}

/**
 * Compares two ArrayBuffers byte for byte.
 * @param {ArrayBuffer} buf1
 * @param {ArrayBuffer} buf2
 * @returns {boolean}
 */
export function areArrayBuffersEqual(buf1: ArrayBuffer, buf2: ArrayBuffer): boolean {
    if (buf1.byteLength !== buf2.byteLength) {
        return false;
    }

    const dv1 = new Int8Array(buf1);
    const dv2 = new Int8Array(buf2);

    for (let i = 0; i !== buf1.byteLength; i++) {
        if (dv1[i] !== dv2[i]) {
            return false;
        }
    }

    return true;
}

// For normal calls
export function errObjConverter(value: any): AnyObject;
// For calls from JSON.stringify as a replacer function
export function errObjConverter(_key: string, value: any): AnyObject;

/**
 * To be used as replacer function for JSON.stringify: Create a new object from the Error object
 * with normal properties
 * @param {...*} args
 * @returns {object}
 */
export function errObjConverter(...args: any[]): AnyObject {
    const value = args.length === 1 ? args[0] : args.length === 2 ? args[1] : undefined;

    if (value instanceof Error) {
        return [
            ...new Set(['name', 'message', 'stack', ...Reflect.ownKeys(value).filter(isString)])
        ].reduce((obj, key) => {
            (obj as AnyObject)[key] = (value as AnyObject)[key];
            return obj;
        }, {});
    }

    return value;
}

/**
 * @param {OneObject} object
 * @param {'change' | 'merge'} storeAs - Whether this is a local change or remote object to merge.
 * @returns {Promise<AnyObjectCreation>}
 */
export async function createObj<T extends OneObjectTypes>(
    object: T,
    storeAs: typeof STORE_AS[keyof typeof STORE_AS] = STORE_AS.CHANGE
): Promise<AnyObjectCreation<T>> {
    return (
        isVersionedObject(object)
            ? await storeVersionedObject(object, storeAs)
            : await storeUnversionedObject(object)
    ) as AnyObjectCreation<T>;
}
