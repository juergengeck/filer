/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

/**
 * Options object for instance-updater, which updates the currently active instance.
 * @global
 * @typedef {object} InstanceUpdateOptions
 * @property {Recipe[]} [recipes=[]]
 */
export interface InstanceUpdaterOptions {
    recipes?: InstanceOptions['initialRecipes'];
}

import {createError} from './errors.js';
import type {InstanceOptions} from './instance.js';
import {getInstanceIdHash} from './instance.js';
import {addRecipeToRuntime} from './object-recipes.js';
import type {Instance} from './recipes.js';
import type {VersionedObjectResult} from './storage-versioned-objects.js';
import {
    getObjectByIdHash,
    STORE_AS,
    storeVersionedObject
} from './storage-versioned-objects.js';
import {ensureRecipeObj} from './util/recipe-checks.js';

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
 * results only exist if any recipes or modules were provided.
 */
export async function updateInstance({
    recipes = []
}: InstanceUpdaterOptions): Promise<VersionedObjectResult<Instance>> {
    const instanceIdHash = getInstanceIdHash();

    if (instanceIdHash === undefined) {
        throw createError('INU-CRO');
    }

    const {obj: instanceObj} = await getObjectByIdHash(instanceIdHash);

    recipes.map(addRecipeToRuntime);

    const recipeResults = await Promise.all(
        recipes.map(r => storeVersionedObject(ensureRecipeObj(r)))
    );

    for (const recipeResult of recipeResults) {
        instanceObj.recipe.add(recipeResult.hash);
    }

    return await storeVersionedObject(instanceObj);
}
