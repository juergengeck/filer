/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module creates the initial {@link Instance} and {@link Person} (for the instance owner)
 * objects.
 * @module
 */

export interface InstanceCreatorOptions {
    name: InstanceOptions['name'];
    email: string;
    ownerName?: string;
    personEncryptionKeyPair?: KeyPair;
    personSignKeyPair?: SignKeyPair;
    instanceEncryptionKeyPair?: KeyPair;
    instanceSignKeyPair?: SignKeyPair;
    initialRecipes: InstanceOptions['initialRecipes'];
    initiallyEnabledReverseMapTypes: InstanceOptions['initiallyEnabledReverseMapTypes'];
    initiallyEnabledReverseMapTypesForIdObjects: InstanceOptions['initiallyEnabledReverseMapTypesForIdObjects'];
}

import type {KeyPair} from './crypto/encryption.js';
import type {SignKeyPair} from './crypto/sign.js';
import type {InstanceOptions} from './instance.js';
import {createDefaultKeysIfNotExist} from './keychain/keychain.js';
import {addRecipeToRuntime, hasRecipe} from './object-recipes.js';
import type {Instance, Recipe} from './recipes.js';
import type {VersionedObjectResult} from './storage-versioned-objects.js';
import {storeVersionedObject} from './storage-versioned-objects.js';
import {ensureRecipeObj} from './util/recipe-checks.js';
import type {SHA256Hash} from './util/type-checks.js';

/**
 * Use this module through {@link instance.module:ts.registerRecipes|instance.registerRecipes} for
 * your convenience. It provides the `name` and `owner` from the active instance
 * and registers any given {@link Recipe|Recipes} with the currently running instance, which
 * this function does not do since you could create or update an inactive instance.
 * Note that recipes are *not* added to the runtime, since you might be updating an inactive
 * Instance object.
 * @static
 * @async
 * @param {InstanceUpdaterOptions} options
 * @returns {Promise<ObjectCreation[]>} Returns the result of creating the Instance object and,
 * if provided Recipe objects. The Instance object creation result always is in the
 * first position and always exists. The {@link Person} object creation result is in second
 * place, but it only exists if the Person object had to be created. {@link Recipe} creation
 * results only exist if any recipes were provided.
 */
export async function createInstance({
    name,
    email,
    ownerName,
    personEncryptionKeyPair,
    personSignKeyPair,
    instanceEncryptionKeyPair,
    instanceSignKeyPair,
    initialRecipes = [],
    initiallyEnabledReverseMapTypes = new Map(),
    initiallyEnabledReverseMapTypesForIdObjects = new Map()
}: InstanceCreatorOptions): Promise<VersionedObjectResult<Instance>> {
    // ----------------------------------------------------
    // PERSON (instance owner)
    // ----------------------------------------------------

    const owner = await storeVersionedObject({
        $type$: 'Person',
        email,
        name: ownerName
    });

    await createDefaultKeysIfNotExist(
        owner.idHash,
        'owner',
        personEncryptionKeyPair,
        personSignKeyPair
    );

    initialRecipes.filter(r => !hasRecipe(r.$type$)).map(r => addRecipeToRuntime(r));

    // ----------------------------------------------------
    // INSTANCE
    // ----------------------------------------------------
    const instance = await storeVersionedObject({
        $type$: 'Instance',
        name,
        owner: owner.idHash,
        recipe: new Set<SHA256Hash<Recipe>>(
            await Promise.all(
                initialRecipes.map(async r => {
                    return (await storeVersionedObject(ensureRecipeObj(r))).hash;
                })
            )
        ),
        enabledReverseMapTypes: initiallyEnabledReverseMapTypes,
        enabledReverseMapTypesForIdObjects: initiallyEnabledReverseMapTypesForIdObjects
    } as Instance);

    await createDefaultKeysIfNotExist(
        instance.idHash,
        'instance',
        instanceEncryptionKeyPair,
        instanceSignKeyPair
    );

    return instance;
}
