/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Provides types for all core ONE object types. Also see module
 * {@link core-types.module:ts|core-types}.
 *
 * Provides an API to
 *
 * - check if a type string has a recipe
 * - get a recipe for a type string
 * - add your own recipes
 * - check if a type string is a versioned object
 *
 * @module
 */

import {createError} from './errors.js';
import type {
    OneObjectTypeNames,
    OneObjectTypes,
    OneVersionedObjectTypeNames,
    OneVersionedObjectTypes,
    Recipe,
    RecipeRule
} from './recipes.js';
import {CORE_RECIPES} from './recipes.js';
import {clone} from './util/clone-object.js';
import {ensureRecipeObj, isRuleInheritanceWithOptions} from './util/recipe-checks.js';
import {isObject} from './util/type-checks-basic.js';

/**
 * In addition to ONE object type names declared in recipes we have one type with the meaning of
 * "everything binary". For example, it is used during Chum synchronization to inform a
 * remote instance about the type behind a hash to select the right method (binary websocket stream
 * transfer) to obtain the file. We define it as a string constant in one place to be sure there
 * is only one such string in the code and only one place to change it.
 * @static
 * @type {'BLOB'}
 */
export const BINARY = 'BLOB';

/**
 * In addition to ONE object type names declared in recipes we have one type with the meaning of
 * "everything UTF-8 but not a ONE object". For example, it is used during Chum synchronization to
 * inform a remote instance about the type behind a hash to select the right method (utf-8 based
 * websocket stream transfer) to obtain the file. We define it as a string constant in one place
 * to be sure there is only one such string in the code and only one place to change it.
 * @static
 * @type {'CLOB'}
 */
export const UTF8 = 'CLOB';

/**
 * The storage for all recipes known to the runtime.
 * Key: ONE object type name strings
 * Value: The ONE Recipe object with its array of rules
 * @private
 * @type {Map<string,Recipe>}
 */
const recipes: Map<string, Recipe> = new Map();

/**
 * This Set contains the "type" strings of all recipes that have at least one ID property, which
 * shows that it is a recipe for a versioned object.
 * @private
 * @type {Set<string>}
 */
const versionedObjects: Set<string> = new Set();

/**
 * Key: A RecipeRule that has "inheritFrom" set to point to another rule
 * Value: The target rule after merging it with the source rule
 * @private
 * @static
 * @type {Map<RecipeRule, RecipeRule>}
 */
const ruleInheritanceCache: Map<RecipeRule, RecipeRule> = new Map();

/**
 * Check if we have a recipe *in memory* for the given type string. The recipe must have been
 * registered with the instance and loaded into memory, the function does not check for
 * {@link Recipe|Recipe objects} in storage.
 * @static
 * @param {string} type - Any string
 * @returns {boolean} Returns true if the given string is the name of a type that we have a
 * recipe consisting of an array of rules for.
 */
export function hasRecipe(type: string): boolean {
    return recipes.has(type);
}

/**
 * Convenience function for the static type checker: Turns a generic "string" into a
 * "OneObjectTypeNames". Check if we have a recipe *in memory* for the given type string. The
 * recipe must have been registered with the instance and loaded into memory, the function does
 * not check for {@link Recipe|Recipe objects} in storage. If we have the recipe the function
 * returns the string, but now tagged as "OneObjectTypeNames" instead of as generic "string".
 * @static
 * @param {string} type - Any string
 * @returns {OneObjectTypeNames} Returns the given type string if the given string is the name of a
 * type that we have a recipe consisting of an array of rules for.
 * @throws {Error} Throws an error if the given type string is not a recipe we know about
 */
export function ensureValidTypeName<K extends OneObjectTypeNames>(type: K | string): K {
    // The reason to use a generic type parameter is that if the type is valid the returned
    // string will be tagged as being of that concrete object name, otherwise it would be tagged
    // as "one of all the valid names", if we just used OneObjectTypeNames as return type.
    if (recipes.has(type)) {
        return type as K;
    }

    throw createError('OR-ET1', {type});
}

/**
 * Returns the {@link Recipe} object describing how a ONE object of the given type looks like.
 *
 * ### Example
 *
 * See {@link object-recipes.module:ts.addRecipeToRuntime|addRecipeToRuntime}
 * for an example of a definition of a versioned ONE object. Using that example of a `Mailbox`
 * object the following code
 * ```
 * console.log(
 *     ObjectRecipes.getRecipe('Mailbox')
 * );
 * ```
 *
 * might produce output that looks like this:
 * ```
 * {
 *     $type$: 'Recipe',
 *     name: 'Mailbox',
 *     rule: [
 *         {
 *            itemprop: 'account',
 *            isId: true
 *         },
 *         {
 *             itemprop: 'name',
 *             isId: true
 *         },
 *         {
 *             itemprop: 'uidEmailBlobMap',
 *             valueType: 'object'
 *         }
 *     ]
 * }
 * ```
 * @static
 * @param {OneObjectTypeNames|string} type - The name of a ONE type for which we have a recipe
 * @returns {Recipe} returns a Recipe object describing the ONE object type
 * @throws {Error} If the given type is unknown
 */
export function getRecipe(type: OneObjectTypeNames): Recipe {
    const recipe = recipes.get(type);

    // If we have a recipe for such a type we accept it. We check the string against RECIPES as
    // a more complete test: The type string can be anything at this point given how we still
    // have to look for the two characters ">
    if (recipe) {
        return recipe;
    }

    throw createError('OR-GR1', {type});
}

/**
 * Add a recipe to working memory. The "Recipe" object may or may not exist in storage.
 *
 * A recipe consists of an array of objects of type RecipeRule for the given type ("name")
 * string. The recipe's rules are checked for the property names and the corresponding types but
 * no further: For example, if you forget "itemprop" (mandatory, a string) in a rule, or if you
 * have the wrong type of item on a rule property an Error is thrown. However, for "type" and
 * a rule's "itemprop" string property we only guard against HTML-breaking "<" and ">" and
 * against whitespace, and we don't check if any other recipes you refer to exist and a wide
 * range of conceivable problems.
 *
 * A recipe for a ONE object type consists of arrays of objects describing the data properties.
 * Allowed rule properties are explained in {@link RecipeRule}:
 *
 * ### Example
 *
 * The following code adds a recipe for a ONE object type "Mailbox":
 *
 * ```javascript
 * import * as ObjectRecipes from 'one.core/lib/object-recipes.js';
 *
 * if (!ObjectRecipes.hasRecipe('Mailbox')) {
 *     ObjectRecipes.addRecipeToRuntime({
 *         $type$: 'Recipe',
 *         name: 'Mailbox',
 *         rule: [
 *             // SHA-256 hash pointing to OneTest$ImapAccount object that mailbox belongs to.
 *             // Both the account and the name are the ID attributes of this VERSIONED object,
 *             // meaning any Mailbox object with the same account and name will be a version of
 *             // the same object, varying only in the data properties not marked as "isID:true".
 *             { itemprop: 'account', isId: true, referenceToObj: new Set(['Account']) },
 *             { itemprop: 'name', isId: true },
 *             // This is an IMAP protocol feature to check if the IMAP-UIDs from last time are
 *             // still valid. This 32-bit integer can be fully represented by a Javascript number.
 *             { itemprop: 'uidValidity', valueType: 'number' },
 *             // A JSON-stringified UID => OneTest$Email-BLOB-hash map
 *             { itemprop: 'uidEmailBlobMap', valueType: 'object' },
 *         ]
 *     });
 * }
 * ```
 *
 * A ONE object created using this recipe would look like this (indentation and newlines added
 * fore readability, not present in the actual microdata):
 *
 * ```html
 * <div itemscope itemtype="//refin.io/Mailbox">
 *   <span itemprop="account">8296cf598c1af767b5287....2bd96eae03448da3066aa</span>
 *   <span itemprop="name">INBOX</span>
 *   <span itemprop="uidValidity">1455785767</span>
 *   <span itemprop="uidEmailBlobMap">...[JSON]....</span>
 * </span>
 * ```
 * @static
 * @param {Recipe} uncheckedRecipe - (Hopefully) a {@link Recipe|ONE "Recipe" object}
 * @returns {undefined} Returns nothing, but if a type with the given name already exists it
 * throws an error, also if the given recipe does not pass a few basic tests
 * @throws {Error} Throws an Error when there is an error in the recipe that our
 * (incomplete) tests detect
 */
export function addRecipeToRuntime(uncheckedRecipe: Readonly<Recipe>): void {
    // Throws an Error if it is not a valid Recipe object
    const recipe = ensureRecipeObj(uncheckedRecipe);

    // We could ignore this because it has no immediate effect, but code that avoids it is usually
    // noticeable better - cleaner, more logical, easier to maintain.
    if (recipes.has(recipe.name)) {
        throw createError('OR-ADDR1', {rName: recipe.name});
    }

    // "isId:true" is only allowed in top level rules, so we don't have to recurse into nested
    // object rules and only have to examine the top level in this loop. We also don't need to
    // look at inherited rules because isId cannot be inherited (the decision was made).
    if (recipe.rule.some(rule => rule.isId === true)) {
        versionedObjects.add(recipe.name);
    }

    recipes.set(recipe.name, recipe);
}

/**
 * When then instance is closed is called all runtime recipes need to be removed
 */
export function clearRuntimeRecipes(): void {
    recipes.clear();
}

/**
 * Adds the core recipes to the Runtime needed for basic functionality.
 */
export function addCoreRecipesToRuntime(): void {
    for (const recipe of CORE_RECIPES) {
        addRecipeToRuntime(recipe);
    }
}

/**
 * Any ONE object with a recipe where there is a property `isId: true` is a *versioned object*
 * with an idHash common to all versions, a version map (stored using
 * the idHash) pointing to all versions.
 *
 * ### Example
 *
 * See {@link object-recipes.module:ts.addRecipeToRuntime|addRecipeToRuntime}
 * for an example of a definition of a versioned ONE object. Using that example of a `Mailbox`
 * object the following call would return `true` and the output would be `"Mailbox" is a
 * versioned type`:
 * ```
 * if (ObjectRecipes.isVersionedObjectType('Mailbox')) {
 *     console.log('"Mailbox" is a versioned type');
 * }
 * ```
 * @static
 * @param {string} type - A ONE object type string (or any string really)
 * @returns {boolean} Returns `true` and a type refinement to {@link OneVersionedObjectTypeNames}
 * if the given type is the type name of a versioned ONE object, false (and no type refinement
 * from `string`) otherwise.
 */
export function isVersionedObjectType(type: string): type is OneVersionedObjectTypeNames {
    return versionedObjects.has(type);
}

/**
 * This function checks the "`type`" property of the given ONE object against a `Set` of type
 * names of versioned object types currently registered in the running instance.
 * @static
 * @param {OneObjectTypes} obj - A versioned or an unversioned ONE object
 * @returns {boolean} Returns `true` and a type refinement to {@link OneVersionedObjectTypes} if
 * the given object is a versioned object type
 */
export function isVersionedObject(obj: OneObjectTypes): obj is OneVersionedObjectTypes {
    return versionedObjects.has(obj.$type$);
}

/**
 * A dynamic type check to turn a `string` into a {@link OneVersionedObjectTypeNames}.
 * @static
 * @param {string} type - A ONE object type string (or any string really)
 * @returns {OneVersionedObjectTypeNames} Returns the input string but now typed as
 * {@link OneVersionedObjectTypeNames}
 * @throws {Error} If the given type is unknown
 */
export function ensureVersionedObjectTypeName<K extends OneVersionedObjectTypeNames>(
    type: K | string
): K {
    if (versionedObjects.has(type)) {
        return type as K;
    }

    throw createError('OR-EVO1', {type});
}

/**
 * Get an array with all types known to the currently running instance. This checks memory, not
 * persistent storage, so only types actually loaded are found. Since all types registered with
 * an instance are automatically loaded this should match the registered types.
 * @static
 * @returns {OneObjectTypeNames[]} Returns an array of names of currently known (registered)
 * ONE object types.
 */
export function getKnownTypes(): OneObjectTypeNames[] {
    // Generally we use "string" for the keys because otherwise things like asking if some
    // string we got from storage is a valid object type string would already lead to type
    // errors. However, here we want to be specific, so we apply a type-cast - we know all keys
    // in recipes are ONE object type names.
    return Array.from(recipes.keys()) as OneObjectTypeNames[];
}

/**
 * @private
 * @static
 * @param {OneObjectTypeNames} recipeName - The recipe type string is only used for error messages
 * @param {RecipeRule[]} rules - Array of rules
 * @param {string[]} path - Path of itemprop strings
 * @returns {RecipeRule}
 */
function getRule(recipeName: OneObjectTypeNames, rules: RecipeRule[], path: string[]): RecipeRule {
    const rule = rules.find(r => r.itemprop === path[0]);

    if (rule === undefined) {
        throw createError('OR-GR01', {recipeName, path});
    }

    return rule;
}

/**
 * @private
 * @static
 * @param {string} path - A path starting with a recipe name followed by at least one or more
 * itemprop names for each level of object nesting. The separator is a dot ".".
 * @returns {RecipeRule}
 */
function getRuleWithPath(path: string): RecipeRule {
    const [recipeName, ...itempropPath] = path.split('.');
    const recipe = getRecipe(recipeName as OneObjectTypeNames);
    return getRule(recipe.name, recipe.rule, itempropPath);
}

/**
 * {@link RecipeRule} objects in {@link Recipe|Recipes} can link to other RecipeRule objects
 * in the same recipe by name. They inherit all properties of the linked rule.
 * @static
 * @param {RecipeRule} source - A rule that may or may not have an "`inheritFrom`"
 * property to inherit properties of the linked named rule
 * @returns {RecipeRule} Returns a new {@link RecipeRule} if the source rule links to a named
 * rule to inherit from, otherwise returns the source rule itself
 */
function resolveSimpleRuleInheritance(source: RecipeRule): RecipeRule {
    if (source.inheritFrom === undefined) {
        return source;
    }

    const cachedTarget = ruleInheritanceCache.get(source);

    if (cachedTarget !== undefined) {
        return cachedTarget;
    }

    const targetRule = isObject(source.inheritFrom) ? source.inheritFrom.rule : source.inheritFrom;

    const newRule = Object.assign(
        {},
        // Allow recursion, the target rule could also have "inheritFrom"
        resolveSimpleRuleInheritance(getRuleWithPath(targetRule)),
        source,
        {inheritFrom: undefined} // Cosmetic, leaving it in would not have an effect
    );

    if (
        isRuleInheritanceWithOptions(source.inheritFrom) &&
        newRule.itemtype !== undefined &&
        'item' in newRule.itemtype &&
        newRule.itemtype.item !== undefined
    ) {
        const {extract} = source.inheritFrom;

        if (extract === 'CollectionItemType') {
            if (!['bag', 'array', 'set'].includes(newRule.itemtype.type)) {
                throw createError('OR-RSRI1');
            }

            newRule.itemtype = newRule.itemtype.item;
        }

        if (extract === 'MapItemType') {
            if (newRule.itemtype.type !== 'map') {
                throw createError('OR-RSRI2');
            }

            const newRuleMapType = newRule.itemtype;

            newRule.itemtype = {
                type: 'object',
                rules: [
                    {itemprop: 'key', itemtype: newRuleMapType.key},
                    {itemprop: 'value', itemtype: newRuleMapType.value}
                ]
            };
        }
    }

    // This rule property cannot be inherited and is ignored should we encounter one
    if (source.isId === undefined && newRule.isId) {
        newRule.isId = false;
    }

    ruleInheritanceCache.set(source, newRule);

    return newRule;
}

/**
 *
 * @param {*} object
 * @param {string} key
 * @returns {RecipeRule | undefined}
 */
function resolveNestedRuleInheritanceInItemtype(object: any, key: string): RecipeRule {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
        return resolveSimpleRuleInheritance(object);
    }

    const newObject = clone(object);

    for (const objectKey of Object.keys(newObject)) {
        const value = newObject[objectKey];

        if (typeof value === 'object' && value !== null) {
            newObject[objectKey] = resolveNestedRuleInheritanceInItemtype(
                newObject[objectKey],
                key
            );
        }
    }

    return newObject;
}

/**
 * {@link RecipeRule} objects in {@link Recipe|Recipes} can link to other RecipeRule objects
 * in the same recipe type by name. They inherit all properties of the linked rule.
 * @static
 * @param {RecipeRule} source - A rule that may or may not have an "`inheritFrom`"
 * property to inherit properties of the linked named rule in his type
 * @returns {RecipeRule} Returns a new {@link RecipeRule} if the source rule links to a named
 * rule to inherit from, otherwise returns the source rule itself
 */
export function resolveRuleInheritance(source: RecipeRule): RecipeRule {
    if (source.itemtype === undefined) {
        return source.inheritFrom === undefined ? source : resolveSimpleRuleInheritance(source);
    }

    return resolveNestedRuleInheritanceInItemtype(source, 'inheritFrom');
}
