import {getRecipe, isVersionedObject, resolveRuleInheritance} from '../object-recipes.js';
import type {
    ArrayValue,
    BagValue,
    MapValue,
    ObjectValue,
    OneIdObjectTypes,
    OneObjectTypes,
    SetValue,
    ValueType
} from '../recipes.js';

/**
 * Clone a one object
 *
 * @param {T} obj
 * @returns {T}
 */
export function cloneOneObject<T extends OneObjectTypes>(obj: T): T {
    const recipe = getRecipe(obj.$type$);

    const result: T = {
        ...cloneObjectValue(
            {type: 'object', rules: recipe.rule},
            obj as unknown as Record<string, unknown>,
            false
        ),
        $type$: obj.$type$
    } as T;

    return result;
}

/**
 * Clone a one id object
 *
 * @param {T} obj
 * @returns {T}
 */
export function cloneOneIdObject<T extends OneIdObjectTypes>(obj: T): T {
    const recipe = getRecipe(obj.$type$);

    return {
        ...cloneObjectValue(
            {type: 'object', rules: recipe.rule},
            obj as unknown as Record<string, unknown>,
            false
        ),
        $type$: obj.$type$
    } as T;
}

export function cloneOneObjectFragment(recipeValue: ValueType, value: unknown): unknown {
    switch (recipeValue.type) {
        case 'string':
        case 'integer':
        case 'number':
        case 'boolean':
        case 'referenceToObj':
        case 'referenceToId':
        case 'referenceToClob':
        case 'referenceToBlob':
        case 'stringifiable':
            return value;
        case 'map':
            return cloneMapValue(recipeValue, value as Map<string, unknown>);
        case 'bag':
            return cloneBagValue(recipeValue, value as unknown[]);
        case 'array':
            return cloneArrayValue(recipeValue, value as unknown[]);
        case 'set':
            return cloneSetValue(recipeValue, value as Set<unknown>);
        case 'object':
            return cloneObjectValue(recipeValue, value as Record<string, unknown>, false);
    }
}

// ######## Private API ########

function cloneObjectValue(
    recipeValue: ObjectValue,
    obj: Record<string, unknown>,
    idObject: boolean
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const rawRule of recipeValue.rules) {
        const rule = resolveRuleInheritance(rawRule);
        const itemtype = rule.itemtype || {type: 'string'};

        if (idObject && rule.isId !== true) {
            continue;
        }

        if (obj[rule.itemprop] !== undefined) {
            result[rule.itemprop] = cloneOneObjectFragment(itemtype, obj[rule.itemprop]);
        }
    }

    return result;
}

function cloneMapValue(recipeValue: MapValue, map: Map<string, unknown>): Map<string, unknown> {
    const result: Map<string, unknown> = new Map();

    for (const [key, value] of map.entries()) {
        result.set(key, cloneOneObjectFragment(recipeValue.value, value));
    }

    return result;
}

function cloneBagValue(recipeValue: BagValue, bag: unknown[]): unknown[] {
    const result: unknown[] = [];

    for (const value of bag) {
        result.push(cloneOneObjectFragment(recipeValue.item, value));
    }

    return result;
}

function cloneArrayValue(recipeValue: ArrayValue, array: unknown[]): unknown[] {
    const result: unknown[] = [];

    for (const value of array) {
        result.push(cloneOneObjectFragment(recipeValue.item, value));
    }

    return result;
}

function cloneSetValue(recipeValue: SetValue, set: Set<unknown>): Set<unknown> {
    const result: Set<unknown> = new Set();

    for (const value of set) {
        result.add(cloneOneObjectFragment(recipeValue.item, value));
    }

    return result;
}
