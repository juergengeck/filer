/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A module with functions that perform runtime type checks. There are very simple checks such
 * as `isString()`, there also are complex checks.
 * @module
 */

/**
 * Type of values in a dynamically created Map of possible rule property names as keys and the
 * properties of those properties. This is used to check RecipeRule objects in Recipe objects if
 * they adhere to the rules for the respective object type. Creating checks dynamically based on
 * those rules is better than hard-coding everything, in case of changes.
 * @private
 * @typedef {object} CachedRuleProperties
 * @property {ValueType} valueType
 * @property {boolean} optional Whether a rule property is optional
 */
interface CachedRuleProperties {
    valueType: ValueType['type'];
    optional: boolean;
}

import {createError} from '../errors.js';
import type {
    ArrayValue,
    BagValue,
    IntegerValue,
    MapValue,
    NumberValue,
    ObjectValue,
    Recipe,
    RecipeRule,
    ReferenceToIdValue,
    ReferenceToObjValue,
    RuleInheritanceWithOptions,
    SetValue,
    StringValue,
    ValueType
} from '../recipes.js';
import {CORE_RECIPES} from '../recipes.js';
import {stringify, stringifyWithCircles} from './sorted-stringify.js';
import {getObjTypeName, isInteger, isNumber, isObject, isString} from './type-checks-basic.js';
import {isListItemType, ruleHasItemType} from './type-checks.js';

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureString(typeObj: ValueType, index: number): void {
    // This function is called when type is "string"
    const castedStringValue = typeObj as StringValue;

    // Revive the RegExp (if this was loaded from microdata it as stringified)
    if (
        castedStringValue.regexp !== undefined &&
        getObjTypeName(castedStringValue.regexp) !== 'RegExp'
    ) {
        castedStringValue.regexp = new RegExp(castedStringValue.regexp);
    }

    if (
        castedStringValue.regexp !== undefined &&
        getObjTypeName(castedStringValue.regexp) !== 'RegExp'
    ) {
        throw createError('URC-ERECI22', {index, castedStringValue});
    }
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureInteger(typeObj: ValueType, index: number): void {
    // This function is called when type is "integer"
    const castedIntengerValue = typeObj as IntegerValue;

    if (
        castedIntengerValue.max !== undefined &&
        castedIntengerValue.min !== undefined &&
        !(castedIntengerValue.max > castedIntengerValue.min)
    ) {
        throw createError('URC-ERECI30-A', {index, thing: castedIntengerValue});
    }

    if (
        !(castedIntengerValue.max === undefined || isInteger(castedIntengerValue.max)) ||
        !(castedIntengerValue.min === undefined || isInteger(castedIntengerValue.min))
    ) {
        throw createError('URC-ERECI30-B', {index, thing: castedIntengerValue});
    }
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureNumber(typeObj: ValueType, index: number): void {
    // This function is called when type is "number"
    const castedNumberValue = typeObj as NumberValue;

    if (
        castedNumberValue.max !== undefined &&
        castedNumberValue.min !== undefined &&
        !(castedNumberValue.max > castedNumberValue.min)
    ) {
        throw createError('URC-ERECI30-C', {index, thing: castedNumberValue});
    }

    if (
        !(castedNumberValue.max === undefined || isNumber(castedNumberValue.max)) ||
        !(castedNumberValue.min === undefined || isNumber(castedNumberValue.min))
    ) {
        throw createError('URC-ERECI30-D', {index, thing: castedNumberValue});
    }
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureReferenceToObj(typeObj: ValueType, index: number): void {
    // This function is called when type is "referenceToObj"
    const obj = typeObj as ReferenceToObjValue;

    // REVIVER HACK
    // because type is now an object, set is transformed into an array when the
    // recipe is converted to microdata
    if (Array.isArray(obj.allowedTypes)) {
        obj.allowedTypes = new Set(obj.allowedTypes);
    }

    if (
        !(obj.allowedTypes instanceof Set) ||
        // Should be <OneObjectTypeNames | '*'> but we only test "string" to enable
        // "lazy recipe registration", when a type is mentioned that is not yet
        // registered
        !Array.from(obj.allowedTypes).every(type => isString(type))
    ) {
        throw createError('URC-ERECI14', {
            index: index,
            ref: obj.allowedTypes,
            oName: getObjTypeName(obj.allowedTypes)
        });
    }
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureReferenceToId(typeObj: ValueType, index: number): void {
    // This function is called when type is "referenceToId"
    const obj = typeObj as ReferenceToIdValue;

    // REVIVER HACK
    // because type is now an object, set is transformed into an array when the
    // recipe is converted to microdata
    if (Array.isArray(obj.allowedTypes)) {
        obj.allowedTypes = new Set(obj.allowedTypes);
    }

    if (
        !(obj.allowedTypes instanceof Set) ||
        // Should be <OneObjectTypeNames | '*'> but we only test "string" to enable
        // "lazy recipe registration", when a type is mentioned that is not yet
        // registered
        !Array.from(obj.allowedTypes).every(type => isString(type))
    ) {
        throw createError('URC-ERECI14', {
            index: index,
            ref: obj.allowedTypes,
            oName: getObjTypeName(obj.allowedTypes)
        });
    }
}

// Map object keys are not allowed to be complex (i.e. an object type). In Javascript those
// would be based on being pointers to objects in memory, but - if we used them - they would be
// saved as JSON string, making them content-based. That would make it impossible to reliably
// reproduce the original situation in memory.
const BANNED_MAP_KEY_TYPES = new Set(['array', 'bag', 'map', 'object', 'set', 'stringifiable']);

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureMap(typeObj: ValueType, index: number): void {
    // This function is called when type is "map"
    const castedMapValue = typeObj as MapValue;

    if (castedMapValue.key === undefined) {
        throw createError('URC-ERECI31', {
            index: index,
            map: castedMapValue
        });
    }

    if (castedMapValue.value === undefined) {
        throw createError('URC-ERECI31', {
            index: index,
            map: castedMapValue
        });
    }

    if (BANNED_MAP_KEY_TYPES.has(castedMapValue.key.type)) {
        throw createError('URC-ERECI31', {
            index: index,
            type: castedMapValue.key.type
        });
    }

    checkItemTypeField(castedMapValue.key, index);
    checkItemTypeField(castedMapValue.value, index);
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureBag(typeObj: ValueType, index: number): void {
    // This function is called when type is "bag"
    const castedBagValue = typeObj as BagValue;

    if (castedBagValue.item === undefined) {
        throw createError('URC-ERECI31', {
            index: index,
            list: castedBagValue
        });
    }

    checkItemTypeField(castedBagValue.item, index);
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureArray(typeObj: ValueType, index: number): void {
    // This function is called when type is "array"
    const castedArrayValue = typeObj as ArrayValue;

    if (castedArrayValue.item === undefined) {
        throw createError('URC-ERECI31', {
            index: index,
            list: castedArrayValue
        });
    }

    checkItemTypeField(castedArrayValue.item, index);
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureSet(typeObj: ValueType, index: number): void {
    // This function is called when type is "set"
    const castedSetValue = typeObj as SetValue;

    if (castedSetValue.item === undefined) {
        throw createError('URC-ERECI31', {
            index: index,
            list: castedSetValue
        });
    }

    checkItemTypeField(castedSetValue.item, index);
}

/**
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureObject(typeObj: ValueType, index: number): void {
    // This function is called when type is "object"
    const castedObjectValue = typeObj as ObjectValue;
    castedObjectValue.rules.forEach(rule => ensureRecipeRule(typeObj.type, rule, index));
}

/**
 * Type ensurer for no option value types with only a "type" property.
 * - boolean
 * - referenceToBlob
 * - referenceToClob
 * - stringifiable
 * @private
 * @param {ValueType} typeObj
 * @param {number} index
 * @returns {undefined}
 */
function ensureOptionFreeType(typeObj: ValueType, index: number): void {
    if (
        Object.keys(typeObj).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(typeObj, 'type')
    ) {
        throw createError('URC-ERECI33', {
            index,
            type: typeObj.type
        });
    }
}

// This map contains ensurer functions for every type in the {@link RecipeRule.itemtype}
const ITEM_TYPE_CHECKER = new Map([
    ['string', ensureString],
    ['integer', ensureInteger],
    ['number', ensureNumber],
    ['boolean', ensureOptionFreeType],
    ['referenceToObj', ensureReferenceToObj],
    ['referenceToId', ensureReferenceToId],
    ['referenceToClob', ensureOptionFreeType],
    ['referenceToBlob', ensureOptionFreeType],
    ['map', ensureMap],
    ['bag', ensureBag],
    ['array', ensureArray],
    ['set', ensureSet],
    ['object', ensureObject],
    ['stringifiable', ensureOptionFreeType]
]);

/**
 * Runs checks on the {@link RecipeRule.itemtype} field
 * @param {ValueType} typeObj
 * @param {number} index
 */
function checkItemTypeField(typeObj: ValueType, index: number): void {
    const itemTypeChecker = ITEM_TYPE_CHECKER.get(typeObj.type);

    if (itemTypeChecker === undefined) {
        throw createError('URC-ERECI19', {
            index,
            jsTypeString: Array.from(ITEM_TYPE_CHECKER.keys()),
            valueType: typeObj.type
        });
    }

    itemTypeChecker(typeObj, index);
}

/**
 *
 * @param {Record<string, unknown>} thing
 * @param {string} originalKey
 * @param {unknown[]} matches
 * @returns {unknown[]}
 */
function collectRulesInItemtype(
    thing: Record<string, unknown>,
    originalKey: string,
    matches: unknown[] = []
): unknown[] {
    if (thing !== null) {
        if (Array.isArray(thing)) {
            for (const arrayItem of thing) {
                collectRulesInItemtype(arrayItem, originalKey, matches);
            }
        } else if (typeof thing === 'object') {
            for (const key of Object.keys(thing)) {
                if (key === originalKey) {
                    matches.push(thing);
                } else {
                    collectRulesInItemtype(
                        thing[key] as Record<string, unknown>,
                        originalKey,
                        matches
                    );
                }
            }
        }
    }

    return matches;
}

/**
 * A dual-use map of all property names that can be used in a RecipeRule object.
 * 1. Existence of the key is used to determine whether a given new RecipeRule only uses
 *    valid properties
 * 2. The two cached properties are used to determine if the RecipeRule definition for a new ONE
 *    object property has all required rule properties, and that they are of the expected type
 *
 * The only property every RecipeRule object *must* have is `itemprop`. Without anything else
 * this describes a string property. All other RecipeRule properties allow further customization
 * of the ONE object property they describe.
 *
 * @example
 *
 * Map {
 *      'itemprop' => { valueType: 'string', optional: false },
 *      'optional' => { valueType: 'boolean', optional: true },
 *      'isId' => { valueType: 'boolean', optional: true },
 *      'type' => { valueType: 'stringifiable', optional: true },
 *      'inheritFrom' => { valueType: 'stringifiable', optional: true },
 *      'object' => { valueType: 'string', optional: true }
 * }
 * @private
 * @type {Map<string,CachedRuleProperties>}
 */
const RECIPE_RULE_PROPERTIES: Map<string, CachedRuleProperties> = (() => {
    // Dynamic creation of runtime constants for the RecipeRule type-checker: Try to infer the
    // properties dynamically from the recipe instead of having to hard-code them into the
    // function's code.
    const recipeRecipeObj = CORE_RECIPES.find(r => r.name === 'Recipe');

    // For TS: We know we hard-coded that recipe in core-types.js - and if it is not there a
    // crash further down is okay anyway.
    if (recipeRecipeObj === undefined) {
        throw createError('URC-RRP1');
    }

    // "Meta": Recipes are themselves described in a "Recipe" object. It has a property called
    // "rule" that describes an array of nested objects - the RecipeRule rules at the heart of each
    // recipe.
    const recipeRulesRule = recipeRecipeObj.rule.find(rule => rule.itemprop === 'rule');

    if (recipeRulesRule === undefined) {
        throw createError('URC-RRP1');
    }

    if (recipeRulesRule.itemtype === undefined) {
        throw createError('URC-RRP3');
    }

    if (!('item' in recipeRulesRule.itemtype)) {
        throw createError('URC-RRP4');
    }

    if (recipeRulesRule.itemtype.item.type !== 'object') {
        throw createError('URC-RRP4');
    }

    if (!('rules' in recipeRulesRule.itemtype.item)) {
        throw createError('URC-RRP4');
    }

    return new Map(
        recipeRulesRule.itemtype.item.rules.map(rule => [
            rule.itemprop,
            {
                valueType: rule.itemtype ? rule.itemtype.type : 'string',
                optional: rule.optional === true // Be explicit to convert undefined to true
            }
        ])
    );
})(); // IIFE

/**
 * @param {*} thing - An argument that can be of any type
 * @returns {boolean} True if the argument is a `RuleInheritanceWithOptions` object, false if not
 */
export function isRuleInheritanceWithOptions(thing: unknown): thing is RuleInheritanceWithOptions {
    if (!isObject(thing)) {
        return false;
    }

    if (!isString(thing.rule)) {
        return false;
    }

    if (thing.rule.split('.').length < 2) {
        return false;
    }

    if (!isString(thing.extract)) {
        return false;
    }

    // noinspection RedundantIfStatementJS
    if (!['MapItemType', 'CollectionItemType'].includes(thing.extract)) {
        return false;
    }

    return true;
}

/**
 * This is a check of rules that cannot be done in ensureRecipeRule() because it requires
 * knowledge of all rules simultaneously.
 *
 * ONE object property names are stored in microdata attribute "itemprop" and set in the
 * {@link RecipeRule} property with the same name. On the same level there may be no duplication
 * of "itemprop" names, but duplication between different nested objects and different nesting
 * levels is allowed. An example is the itemprop "name", which is a top level property in
 * {@link Recipe} objects but {@RecipeRule} objects nested inside may have a "name" property
 * too (the top level name is for the recipe, the ones inside rule objects are for the rule they
 * are in).
 * @private
 * @param {RecipeRule[]} rules
 * @returns {undefined}
 */
function checkItempropsForDuplicates(rules: readonly RecipeRule[]): void {
    // Only within the same level, no recursion, because object property name duplication in
    // nested objects is not an issue
    const seen: Set<string> = new Set();

    for (const rule of rules) {
        if (seen.has(rule.itemprop)) {
            throw createError('URC-CIT1', {itemprop: rule.itemprop});
        }

        seen.add(rule.itemprop);
    }
}

/**
 * @private
 * @param {string} objType - The type name of the Recipe the rule belongs to
 * @param {RecipeRule} thing - The particular rule to check
 * @param {number} [index=0] - The position in the array of rules that is the entire recipe, used
 * to produce more useful error messages
 * @param {Set<RecipeRule[]>} [seenRulesArrays=new Set()] - To detect infinite recursion if
 * nested object definitions form a circle
 * @param {boolean} [isNested]
 * @returns {RecipeRule} Returns the RecipeRule ONE object
 * @throws {Error} Throws an Error when there is an error in the recipe that our
 * (incomplete) tests detect
 */
function ensureRecipeRule(
    objType: string,
    thing: unknown,
    index: number,
    seenRulesArrays: Set<RecipeRule[]> = new Set(),
    isNested: boolean = false
): RecipeRule {
    if (!isObject(thing)) {
        throw createError('URC-ERECI1', {type: thing === null ? 'null' : typeof thing});
    }

    const collectedRules: unknown[] = [];
    collectRulesInItemtype(thing, 'rules', collectedRules);

    // Only top level properties can be ID properties. They cannot be inherited either.
    // Not very flexible but since it complicates the parser, as long as this feature is not
    // urgently needed we place this restriction.
    if (isNested && thing.isId !== undefined) {
        throw createError('URC-ERECI2', {index});
    }

    // Make sure there are no additional properties that we don't know (and therefore would not
    // otherwise check)
    for (const prop of Object.keys(thing)) {
        if (!RECIPE_RULE_PROPERTIES.has(prop)) {
            throw createError('URC-ERECI3', {index, prop});
        }
    }

    // Checks based on dynamically created meta information from the rules for RecipeRules
    for (const [prop, {optional}] of RECIPE_RULE_PROPERTIES) {
        if (thing[prop] === undefined) {
            if (optional) {
                continue;
            }

            // This only catches "itemprop", the only mandatory RecipeRule property (right now)
            throw createError('URC-ERECI4', {index, prop});
        }
    }

    // Very basic check: We only guard against HTML-breaking characters "<", ">", whitespace and
    // ".". The dot is used in some pieces of code to express a path to an itemprop through a
    // nested object, where it is used to separate the "itemprop"s of each level.
    if (/[<>.\s]+/.test(thing.itemprop)) {
        throw createError('URC-ERECI8', {index});
    }

    if (thing.itemtype) {
        checkItemTypeField(thing.itemtype, index);
    }

    // While this could be intentional, since it could also be an error we make the choice to
    // FORBID intentionally setting this value to undefined. We had the problem in one.recipes
    // where every ONE object recipe is in its own module, and the CommonJS module node.js
    // version of the code ended up with "undefined" for imported rules due to circular imports
    // (an issue with the timing-dependent dynamic imports).

    for (const collectedRule of collectedRules) {
        const ruleThing = collectedRule as Record<string, unknown>;

        if (
            Reflect.getOwnPropertyDescriptor(ruleThing, 'rules') !== undefined &&
            ruleThing.rules === undefined
        ) {
            throw createError('URC-ERECI25', {index, itemprop: ruleThing.itemprop});
        }

        // INFINITE RECURSION
        if (Array.isArray(ruleThing.rules) && seenRulesArrays.has(ruleThing.rules)) {
            throw createError('URC-ERECI26', {index, rule: ruleThing.rules});
        }

        // RECURSION: Rules for a nested object or an array of nested objects
        if (Array.isArray(ruleThing.rules)) {
            seenRulesArrays.add(ruleThing.rules);
            // Parameter "seenRulesArrays": Each item creates a different branch and therefore needs a
            // copy, otherwise the branches would detect objects in another branch which do not form a
            // circle.
            ruleThing.rules.forEach(rule =>
                ensureRecipeRule(objType, rule, index, new Set(seenRulesArrays), true)
            );
        }

        if (
            ruleThing.rules !== undefined &&
            !(Array.isArray(ruleThing.rules) && ruleThing.rules.length > 0)
        ) {
            throw createError('URC-ERECI23', {index, rule: ruleThing.rules});
        }

        if (Array.isArray(ruleThing.rules) && ruleThing.isId) {
            throw createError('URC-ERECI24', {
                index,
                thingKeys: Object.keys(ruleThing)
            });
        }
    }

    // AFTER all rules have been checked individually, perform these checks that require
    // looking at all rules together. Those functions presume that the rules are correct
    // individually (i.e. properties and their types are correct).
    for (const rules of collectedRules.map(collectedRule => (collectedRule as ObjectValue).rules)) {
        checkItempropsForDuplicates(rules);
    }

    // This property defines a path starting with a recipe followed by a list of at least one
    // itemprop within that recipe, or multiple to find an itemprop on a deeper level of a
    // nested object. The path separator is "."
    // We don't check that the path leads to a recipe in memory _right now_, because it is okay
    // if the target is not there at this point. It just has to be there when this rule that
    // inherits from another rule, possibly in another recipe, is actually being used.
    // That's why we only perform a very rudimentary test to catch the most basic error(s).
    if (isString(thing.inheritFrom) && thing.inheritFrom.split('.').length < 2) {
        throw createError('URC-ERECI27', {index, inheritFrom: thing.inheritFrom});
    }

    // Similar to when it is a string, but it can also be an object that in addition to the
    // path-string
    if (isObject(thing.inheritFrom) && !isRuleInheritanceWithOptions(thing.inheritFrom)) {
        throw createError('URC-ERECI28', {index, inheritFrom: thing.inheritFrom});
    }

    return thing as unknown as RecipeRule;
}

/**
 * A test performed internally before adding new recipes for ONE objects.
 * @static
 * @param {*} thing
 * @returns {Recipe} Returns the Recipe ONE object
 * @throws {Error} Throws an Error when there is an error in the recipe that our
 * (incomplete) tests detect
 */
export function ensureRecipeObj(thing: unknown): Recipe {
    if (!isObject(thing)) {
        throw createError('URC-ERCP1', {type: thing === null ? 'null' : typeof thing});
    }

    if (thing.$type$ !== 'Recipe') {
        throw createError('URC-ERCP2', {type: thing.$type$});
    }

    const recipeName = thing.name;

    // Very basic check: We only guard against HTML-breaking characters "<", ">", whitespace and
    // ".". The dot is used in some pieces of code to express a path to an itemprop through a
    // nested object, where it is used to separate the "itemprop"s of each level.
    if (
        !isString(recipeName) ||
        recipeName === '' ||
        /[<>.\s]+/.test(recipeName) ||
        JSON.stringify(recipeName) !== `"${recipeName}"`
    ) {
        throw createError('URC-ERCP3', {recipeName});
    }

    if (!Array.isArray(thing.rule)) {
        throw createError('URC-ERCP4', {recipeName});
    }

    // Catch errors to add the whole recipe object to the error output, otherwise the caller
    // will only see the specific rule that caused the error and may have to guess to which
    // recipe it belongs.
    try {
        thing.rule.forEach((rule: unknown, index: number) =>
            ensureRecipeRule(recipeName, rule, index)
        );
    } catch (err) {
        // No need to createError() here, this already is one- It has this function in its
        // stack trace too. But the message thus far only has the one offending rule.
        err.message += ';\n  Recipe: ' + stringifyWithCircles(thing);
        throw err;
    }

    return thing as unknown as Recipe;
}

/**
 * Construct a recipeRule based on the `itemtype.item` from the list rule. This is used for
 * constructing CRDT types.
 * @param {RecipeRule} rule
 * @returns {RecipeRule}
 */
export function constructItemRuleFromListRule(rule: RecipeRule): RecipeRule {
    if (!ruleHasItemType(rule) || !isListItemType(rule.itemtype)) {
        throw new Error(`You cannot extract an item rule from a no list rule: ${stringify(rule)}`);
    }

    return {
        itemprop: rule.itemprop,
        itemtype: rule.itemtype.item
    };
}
