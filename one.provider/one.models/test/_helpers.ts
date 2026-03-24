import {SYSTEM} from '@refinio/one.core/lib/system/platform.js';
import {statSync} from 'fs';
import path from 'path';
import {readFile} from 'fs/promises';

import {initInstance} from '@refinio/one.core/lib/instance.js';
import type {
    Instance,
    OneObjectTypeNames,
    OneVersionedObjectTypeNames,
    Recipe
} from '@refinio/one.core/lib/recipes.js';
import type {KeyPair} from '@refinio/one.core/lib/crypto/encryption.js';
import type {SignKeyPair} from '@refinio/one.core/lib/crypto/sign.js';

import RecipesStable from '../lib/recipes/recipes-stable.js';
import RecipesExperimental from '../lib/recipes/recipes-experimental.js';

export const defaultDbName = 'testDb';

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

export async function initOneCorePlatform() {
    await import(`@refinio/one.core/lib/system/load-${SYSTEM}.js`);
}

/**
 * @param {object} [options={}]
 * @param {string} [options.email]
 * @param {string|null} [options.secret]
 * @param {string} [options.name]
 * @param {string} [options.dbKey]
 * @param {boolean} [options.deleteDb=true]
 * @param {boolean} [options.encryptStorage=false]
 * @param {Array} [options.initiallyEnabledReverseMapTypes]
 * @param {Array} [options.initiallyEnabledReverseMapTypesForIdObjects]
 * @param {KeyPair|undefined} [options.personEncryptionKeyPair]
 * @param {SignKeyPair|undefined} [options.personSignKeyPair]
 * @param {KeyPair|undefined} [options.instanceEncryptionKeyPair]
 * @param {SignKeyPair|undefined} [options.instanceSignKeyPair]
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
    dbKey = defaultDbName,
    deleteDb = true,
    encryptStorage = false,
    initiallyEnabledReverseMapTypes = [],
    initiallyEnabledReverseMapTypesForIdObjects = []
}: StorageHelpersInitOpts = {}): Promise<Instance> {
    await initOneCorePlatform();

    return await initInstance({
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
        initialRecipes: [...RecipesStable, ...RecipesExperimental],
        initiallyEnabledReverseMapTypes: new Map(initiallyEnabledReverseMapTypes),
        initiallyEnabledReverseMapTypesForIdObjects: new Map(
            initiallyEnabledReverseMapTypesForIdObjects
        )
    });
}

export function buildTestFile(): File {
    const filePath = './test/consent.pdf';
    const stats = statSync(filePath);

    return {
        lastModified: stats.ctimeMs,
        name: path.basename(filePath),
        size: stats.size,
        type: 'application/pdf',
        arrayBuffer: () => readFile(filePath)
    } as unknown as File;
}
