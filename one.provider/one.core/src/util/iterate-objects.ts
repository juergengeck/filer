/* eslint-disable no-await-in-loop,@typescript-eslint/no-for-in-array */
import type {CrdtAlgorithm} from '../crdts/interfaces/CrdtAlgorithm.js';
import {getCrdtAlgorithmFromConfigOrDefault} from '../crdts/CrdtAlgorithmRegistry.js';
import {getRecipe, resolveRuleInheritance} from '../object-recipes.js';
import type {
    ArrayValue,
    BagValue,
    BLOB,
    CLOB,
    MapValue,
    ObjectValue,
    OneIdObjectTypes,
    OneObjectTypeNames,
    OneObjectTypes,
    RecipeRule,
    ReferenceToIdValue,
    ReferenceToObjValue,
    SetValue,
    ValueType
} from '../recipes.js';
import {getObject} from '../storage-unversioned-objects.js';
import {getIdObject} from '../storage-versioned-objects.js';
import {makeSparseArray, sparseMap, sparsePromiseAll} from './array.js';
import {isObject} from './type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';

type PromiseOrNot<T> = T | Promise<T>;

/**
 * Arguments that all callbacks receive.
 */
export interface CbArgs<T> {
    values: T[];
    valueType: ValueType;
    path: string;
    crdtAlgorithm: CrdtAlgorithm;
    setValue: (i: number, value: T) => void;
}

export type IterationStrategy = 'off' | 'parallel' | 'separate';

export function isIterationStrategy(arg: any): arg is IterationStrategy {
    return arg === 'off' || arg === 'parallel' || arg === 'separate';
}

export interface MapIterationStrategy {
    keyIterationStrategy: IterationStrategy;
    valueIterationStrategy: IterationStrategy;
}

export function isMapIterationStrategy(arg: any): arg is MapIterationStrategy {
    return (
        isObject(arg) &&
        isIterationStrategy(arg.valueIterationStrategy) &&
        isIterationStrategy(arg.keyIterationStrategy)
    );
}

/**
 * Options for the iteration.
 */
export interface IterateOptions {
    /**
     * If true, then iterate into child objects (referenceToObj, referenceToId)
     * If false, then do not iterate child objects. In theory the whole iteration is
     * then synchronous, but I do not know how to make functions sync/async based on a boolean
     * flag, so for now everything is async.
     */
    iterateChildObjects?: boolean;
    iterateChildIdObjects?: boolean;

    defaultIterationStrategies?: {
        referenceToObj?: IterationStrategy;
        referenceToId?: IterationStrategy;
        mapKeys?: IterationStrategy;
        mapValues?: IterationStrategy;
        bagValues?: IterationStrategy;
        arrayValues?: IterationStrategy;
        setValues?: IterationStrategy;
        objectValues?: IterationStrategy;
    };

    continueOnReadErrors?: boolean;

    // Called when a value was changed via the setValue callbacks
    onValueChange?: (path: string, i: number, value: unknown) => void;
}

/**
 * Interface that must be implemented by the caller of iterateObjects.
 */
export interface Callbacks {
    string?(args: CbArgs<string>): PromiseOrNot<void>;
    integer?(args: CbArgs<number>): PromiseOrNot<void>;
    number?(args: CbArgs<number>): PromiseOrNot<void>;
    boolean?(args: CbArgs<boolean>): PromiseOrNot<void>;

    /**
     * Iterate a map entry
     *
     * @param {CbArgs<SHA256Hash[]>} args - You are allowed to change top level of the value array
     *                                    in order to continue the iteration with different values.
     * @param {string} args.objs - the objects behind the hash
     * @returns {boolean | void} - If exactly false is returned the iteration will stop. every
     *                             other value including undefined will continue the iteration.
     */
    referenceToObj?(
        args: CbArgs<SHA256Hash> & {objs?: OneObjectTypes[]}
    ): PromiseOrNot<IterationStrategy | void>;
    referenceToId?(
        args: CbArgs<SHA256IdHash> & {objs?: OneIdObjectTypes[]}
    ): PromiseOrNot<IterationStrategy | void>;
    referenceToClob?(args: CbArgs<SHA256Hash<CLOB>>): PromiseOrNot<void>;
    referenceToBlob?(args: CbArgs<SHA256Hash<BLOB>>): PromiseOrNot<void>;
    map?(args: CbArgs<Map<string, unknown>>): PromiseOrNot<void>;

    /**
     * Iterate a map entry
     *
     * @param {CbArgs<unknown[]>} args
     * @param {string} args.key - key of map entry
     * @returns {boolean | void} - If exactly false is returned the iteration will stop. every
     *                             other value including undefined will continue the iteration.
     */
    mapEntry?(
        args: CbArgs<unknown> & {key: string; keyType: ValueType}
    ): PromiseOrNot<MapIterationStrategy | IterationStrategy | void>;
    bag?(args: CbArgs<unknown[]>): PromiseOrNot<IterationStrategy | void>;
    array?(args: CbArgs<unknown[]>): PromiseOrNot<IterationStrategy | void>;
    set?(args: CbArgs<Set<unknown>>): PromiseOrNot<IterationStrategy | void>;
    object?(args: CbArgs<Record<string, unknown>>): PromiseOrNot<void>;

    /**
     * Iterate an object property
     *
     * @param {CbArgs<unknown[]>} args
     * @param {string} args.propertyName - name of property
     * @returns {boolean | void} - If exactly false is returned the iteration will stop. every
     *                             other value including undefined will continue the iteration.
     */
    objectProperty?(
        args: CbArgs<unknown> & {rule: RecipeRule; optional: boolean}
    ): PromiseOrNot<IterationStrategy | void>;
    stringifiable?(args: CbArgs<string>): PromiseOrNot<void>;

    // Callbacks that are called after the iteration of children was done - needed for some
    // algorithms
    referenceToObjAfterIter?(
        args: CbArgs<SHA256Hash> & {objs?: OneObjectTypes[]}
    ): PromiseOrNot<void>;
    referenceToIdAfterIter?(
        args: CbArgs<SHA256IdHash> & {objs?: OneIdObjectTypes[]}
    ): PromiseOrNot<void>;
    mapEntryAfterIter?(
        args: CbArgs<unknown> & {key: string; keyType: ValueType}
    ): PromiseOrNot<void>;
    bagAfterIter?(args: CbArgs<unknown[]>): PromiseOrNot<void>;
    arrayAfterIter?(args: CbArgs<unknown[]>): PromiseOrNot<void>;
    setAfterIter?(args: CbArgs<Set<unknown>>): PromiseOrNot<void>;
    objectPropertyAfterIter?(
        args: CbArgs<unknown> & {rule: RecipeRule; optional: boolean}
    ): PromiseOrNot<void>;
}

/**
 * Iterate over multiple objects at the same time and calling the passed callbacks.
 *
 * @param {T[]} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 * @returns {Promise<void>}
 */
export async function iterateObjects<T extends OneObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options?: IterateOptions
): Promise<void> {
    await iterateAnyObjects(objs, cb, options || {}, false);
}

/**
 * Iterate over a single id-object and call the specified callbacks
 *
 * @param {T} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 * @returns {Promise<void>}
 */
export async function iterateIdObjects<T extends OneIdObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options?: IterateOptions
): Promise<void> {
    await iterateAnyObjects(objs, cb, options || {}, true);
}

/**
 * Iterate over a single (id-)object and call the specified callbacks
 *
 * @param {T} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 * @param {boolean} idObject
 * @returns {Promise<void>}
 */
export async function iterateAnyObjects<T extends OneIdObjectTypes | OneObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options: IterateOptions,
    idObject: boolean
): Promise<void> {
    const types = new Set<OneObjectTypeNames>();

    for (const obj of objs) {
        if (obj !== undefined) {
            types.add(obj.$type$);
        }
    }

    if (types.size !== 1) {
        throw new Error('All objects passed to iterateObjects need to be of same type');
    }

    const recipe = getRecipe([...types][0]);
    const params: Params = {
        crdtConfig: recipe.crdtConfig || new Map<string, string>(),
        iterateChildObjects:
            options.iterateChildObjects === undefined ? true : options.iterateChildObjects,
        iterateChildIdObjects:
            options.iterateChildIdObjects === undefined ? true : options.iterateChildIdObjects,
        defaultIterationStrategies: {
            referenceToObj: options.defaultIterationStrategies?.referenceToObj || 'parallel',
            referenceToId: options.defaultIterationStrategies?.referenceToId || 'parallel',
            mapKeys: options.defaultIterationStrategies?.mapKeys || 'off',
            mapValues: options.defaultIterationStrategies?.mapValues || 'parallel',
            arrayValues: options.defaultIterationStrategies?.arrayValues || 'separate',
            bagValues: options.defaultIterationStrategies?.bagValues || 'separate',
            setValues: options.defaultIterationStrategies?.setValues || 'separate',
            objectValues: options.defaultIterationStrategies?.objectValues || 'parallel'
        },
        continueOnReadErrors:
            options.continueOnReadErrors === undefined ? false : options.continueOnReadErrors,
        onValueChange: options.onValueChange === undefined ? () => {} : options.onValueChange
    };

    await iterateObjectValue(
        {type: 'object', rules: recipe.rule},
        objs as unknown as Array<Record<string, unknown>>,
        '',
        cb,
        params,
        (i: number, value: unknown): void => {
            objs[i] = value as T;
            params.onValueChange('', i, value);
        },
        idObject
    );
}

// ######## Private API ########

interface Params {
    crdtConfig: Map<string, string>;
    iterateChildObjects: boolean;
    iterateChildIdObjects: boolean;
    defaultIterationStrategies: {
        referenceToObj: IterationStrategy;
        referenceToId: IterationStrategy;
        mapKeys: IterationStrategy;
        mapValues: IterationStrategy;
        bagValues: IterationStrategy;
        arrayValues: IterationStrategy;
        setValues: IterationStrategy;
        objectValues: IterationStrategy;
    };
    onValueChange: (path: string, i: number, value: unknown) => void;
    continueOnReadErrors: boolean;
}

// ######## Iterate various ValueTypes ########

async function iterateRecipeValue(
    recipeValue: ValueType,
    values: unknown[],
    path: string,
    cb: Callbacks,
    p: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    if (values.length === 0) {
        return;
    }

    const cbArgs: CbArgs<unknown> = {
        values: values,
        valueType: recipeValue,
        path,
        crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(p.crdtConfig, path, recipeValue.type),
        setValue
    };

    switch (recipeValue.type) {
        case 'string':
            cb.string && (await cb.string(cbArgs as CbArgs<string>));
            break;
        case 'integer':
            cb.integer && (await cb.integer(cbArgs as CbArgs<number>));
            break;
        case 'number':
            cb.number && (await cb.number(cbArgs as CbArgs<number>));
            break;
        case 'boolean':
            cb.boolean && (await cb.boolean(cbArgs as CbArgs<boolean>));
            break;
        case 'referenceToObj':
            await iterateReferenceToObjectValue(
                recipeValue,
                values as SHA256Hash[],
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'referenceToId':
            await iterateReferenceToIdValue(
                recipeValue,
                values as SHA256IdHash[],
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'referenceToClob':
            cb.referenceToClob && (await cb.referenceToClob(cbArgs as CbArgs<SHA256Hash<CLOB>>));
            break;
        case 'referenceToBlob':
            cb.referenceToBlob && (await cb.referenceToBlob(cbArgs as CbArgs<SHA256Hash<BLOB>>));
            break;
        case 'map':
            await iterateMapValue(
                recipeValue,
                values as Array<Map<string, unknown>>,
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'bag':
            await iterateBagValue(recipeValue, values as unknown[][], path, cb, p, setValue);
            break;
        case 'array':
            await iterateArrayValue(recipeValue, values as unknown[][], path, cb, p, setValue);
            break;
        case 'set':
            await iterateSetValue(
                recipeValue,
                values as Array<Set<unknown>>,
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'object':
            await iterateObjectValue(
                recipeValue,
                values as Array<Record<string, unknown>>,
                path,
                cb,
                p,
                setValue,
                false
            );
            break;
        case 'stringifiable':
            cb.stringifiable && (await cb.stringifiable(cbArgs as CbArgs<string>));
            break;
    }
}

async function iterateReferenceToObjectValue(
    recipeValue: ReferenceToObjValue,
    hashes: SHA256Hash[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    if (!params.iterateChildObjects) {
        cb.referenceToObj &&
            (await cb.referenceToObj({
                values: hashes,
                valueType: recipeValue,
                path,
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    path,
                    'referenceToObj'
                ),
                setValue
            }));
        return;
    }

    let objs: OneObjectTypes[] | undefined = undefined;

    try {
        objs = await sparsePromiseAll(sparseMap(hashes, getObject));
    } catch (e) {
        if (!params.continueOnReadErrors) {
            throw e;
        }
    }

    const iterate =
        cb.referenceToObj &&
        (await cb.referenceToObj({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToObj'
            ),
            setValue,
            objs
        }));

    const iterStrat = getIterationStrategyFromCB(
        iterate,
        params.defaultIterationStrategies.referenceToObj
    );

    if (iterStrat === 'off') {
        return;
    }

    if (objs) {
        await iterateReferenceValue(iterStrat, objs, path, cb, params, false);
    }

    cb.referenceToObjAfterIter &&
        (await cb.referenceToObjAfterIter({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToObj'
            ),
            setValue,
            objs
        }));
}

async function iterateReferenceToIdValue(
    recipeValue: ReferenceToIdValue,
    hashes: SHA256IdHash[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    if (!params.iterateChildIdObjects) {
        cb.referenceToId &&
            (await cb.referenceToId({
                values: hashes,
                valueType: recipeValue,
                path,
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    path,
                    'referenceToId'
                ),
                setValue
            }));
        return;
    }

    let objs: OneIdObjectTypes[] | undefined = undefined;

    try {
        objs = await sparsePromiseAll(sparseMap(hashes, getIdObject));
    } catch (e) {
        if (!params.continueOnReadErrors) {
            throw e;
        }
    }

    const iterate =
        cb.referenceToId &&
        (await cb.referenceToId({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToId'
            ),
            setValue,
            objs
        }));

    const iterStrat = getIterationStrategyFromCB(
        iterate,
        params.defaultIterationStrategies.referenceToId
    );

    if (iterStrat === 'off') {
        return;
    }

    if (objs) {
        await iterateReferenceValue(iterStrat, objs, path, cb, params, true);
    }

    cb.referenceToIdAfterIter &&
        (await cb.referenceToIdAfterIter({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToId'
            ),
            setValue,
            objs
        }));
}

async function iterateObjectValue(
    recipeValue: ObjectValue,
    objs: Array<Record<string, unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void,
    idObject: boolean
): Promise<void> {
    cb.object &&
        (await cb.object({
            values: objs,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'object'),
            setValue
        }));

    for (const rawRule of recipeValue.rules) {
        const rule = resolveRuleInheritance(rawRule);
        const values = sparseMap(objs, obj => obj[rule.itemprop]);
        const propPath = path.length === 0 ? rule.itemprop : path.concat('.', rule.itemprop);
        const itemtype = rule.itemtype || {type: 'string'};

        if (idObject && rule.isId !== true) {
            continue;
        }

        const iterate =
            cb.objectProperty &&
            (await cb.objectProperty({
                values: values,
                valueType: itemtype,
                path: path.length === 0 ? rule.itemprop : path.concat('.', rule.itemprop),
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    propPath,
                    'objectProperty'
                ),
                rule: rule,
                setValue: (i: number, value: unknown) => {
                    if (value === undefined) {
                        delete objs[i][rule.itemprop];
                    } else {
                        objs[i][rule.itemprop] = value;
                    }
                    params.onValueChange(propPath, i, value);
                },
                optional: rule.optional === undefined ? false : rule.optional
            }));

        let hasValuesLeft = false;

        // Filter out values that are set to undefined => deleted (optional properties)
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const i in values) {
            if (values[i] === undefined) {
                delete values[i];
            } else {
                hasValuesLeft = true;
            }
        }

        const iterStrat = getIterationStrategyFromCB(
            iterate,
            params.defaultIterationStrategies.objectValues
        );

        if (iterStrat === 'off') {
            continue;
        }

        if (hasValuesLeft) {
            await iterateValues(
                iterStrat,
                itemtype,
                values,
                propPath,
                cb,
                params,
                (i: number, value: unknown) => {
                    if (value === undefined) {
                        delete objs[i][rule.itemprop];
                    } else {
                        objs[i][rule.itemprop] = value;
                    }
                    params.onValueChange(propPath, i, value);
                }
            );
        }

        cb.objectPropertyAfterIter &&
            (await cb.objectPropertyAfterIter({
                values: values,
                valueType: itemtype,
                path: path.length === 0 ? rule.itemprop : path.concat('.', rule.itemprop),
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    propPath,
                    'objectProperty'
                ),
                rule: rule,
                setValue: (i: number, value: unknown) => {
                    if (value === undefined) {
                        delete objs[i][rule.itemprop];
                    } else {
                        objs[i][rule.itemprop] = value;
                    }
                    params.onValueChange(propPath, i, value);
                },
                optional: rule.optional === undefined ? false : rule.optional
            }));
    }
}

async function iterateMapValue(
    recipeValue: MapValue,
    maps: Array<Map<string, unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    cb.map &&
        (await cb.map({
            values: maps,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'map'),
            setValue
        }));

    const keys = new Set<string>();

    // Get union of all keys of all maps
    for (const map of maps) {
        if (map !== undefined) {
            for (const [key] of map) {
                keys.add(key);
            }
        }
    }

    for (const key of keys) {
        const values = sparseMap(maps, m => m.get(key));
        const keysForIter = sparseMap(maps, _m => key);
        const keyPath = path.length === 0 ? key : path.concat('.', key);
        const keyPathForIteration = path.length === 0 ? key : path.concat('.!key!', key);

        const iterate =
            cb.mapEntry &&
            (await cb.mapEntry({
                values,
                valueType: recipeValue.value,
                path: keyPath,
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    keyPath,
                    'mapEntry'
                ),
                setValue: (i: number, value: unknown) => {
                    if (value === undefined) {
                        maps[i].delete(key);
                    } else {
                        maps[i].set(key, value);
                    }
                    params.onValueChange(keyPath, i, value);
                },
                key,
                keyType: recipeValue.key
            }));

        let hasValuesLeft = false;

        // Filter out values that are set to undefined => deleted (optional properties)
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const i in values) {
            if (values[i] === undefined) {
                delete values[i];
                delete keysForIter[i];
            } else {
                hasValuesLeft = true;
            }
        }

        let keyIterationStrategy;
        let valueIterationStrategy;

        if (isMapIterationStrategy(iterate)) {
            keyIterationStrategy = iterate.keyIterationStrategy;
            valueIterationStrategy = iterate.valueIterationStrategy;
        } else if (isIterationStrategy(iterate)) {
            valueIterationStrategy = iterate;
        }

        const iterStratKeys = getIterationStrategyFromCB(
            keyIterationStrategy,
            params.defaultIterationStrategies.mapKeys
        );

        const iterStratValues = getIterationStrategyFromCB(
            valueIterationStrategy,
            params.defaultIterationStrategies.mapValues
        );

        if (iterStratKeys === 'off' && iterStratValues === 'off') {
            return;
        }

        if (hasValuesLeft) {
            await iterateValues(
                iterStratKeys,
                recipeValue.key,
                keysForIter,
                keyPathForIteration,
                cb,
                params,
                () => {
                    throw new Error('Changing keys is not supported');
                }
            );

            await iterateValues(
                iterStratValues,
                recipeValue.value,
                values,
                keyPath,
                cb,
                params,
                (i: number, value: unknown) => {
                    if (value === undefined) {
                        maps[i].delete(key);
                    } else {
                        maps[i].set(key, value);
                    }
                    params.onValueChange(keyPath, i, value);
                }
            );
        }

        cb.mapEntryAfterIter &&
            (await cb.mapEntryAfterIter({
                values,
                valueType: recipeValue.value,
                path: keyPath,
                crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                    params.crdtConfig,
                    keyPath,
                    'mapEntry'
                ),
                setValue: (i: number, value: unknown) => {
                    if (value === undefined) {
                        maps[i].delete(key);
                    } else {
                        maps[i].set(key, value);
                    }
                    params.onValueChange(keyPath, i, value);
                },
                key,
                keyType: recipeValue.key
            }));
    }
}

/**
 * Iterate bag value
 *
 * @param {BagValue} recipeValue
 * @param {unknown[]} bags
 * @param {string} path
 * @param {Callbacks} cb
 * @param {Params} params
 * @param {Function} setValue
 * @returns {Promise<void>}
 */
async function iterateBagValue(
    recipeValue: BagValue,
    bags: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    const iterate =
        cb.bag &&
        (await cb.bag({
            values: bags,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'bag'),
            setValue
        }));

    const iterStrat = getIterationStrategyFromCB(
        iterate,
        params.defaultIterationStrategies.bagValues
    );

    if (iterStrat === 'off') {
        return;
    }

    await iterateValueArrays(iterStrat, recipeValue.item, bags, path, cb, params);

    cb.bagAfterIter &&
        (await cb.bagAfterIter({
            values: bags,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'bag'),
            setValue
        }));
}

/**
 * Iterate array value
 *
 * @param {ArrayValue} recipeValue
 * @param {unknown[]} arrays
 * @param {string} path
 * @param {Callbacks} cb
 * @param {Params} params
 * @param {Function} setValue
 * @returns {Promise<void>}
 */
async function iterateArrayValue(
    recipeValue: ArrayValue,
    arrays: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    const iterate =
        cb.array &&
        (await cb.array({
            values: arrays,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'array'),
            setValue
        }));

    const iterStrat = getIterationStrategyFromCB(
        iterate,
        params.defaultIterationStrategies.arrayValues
    );

    if (iterStrat === 'off') {
        return;
    }

    await iterateValueArrays(iterStrat, recipeValue.item, arrays, path, cb, params);

    cb.arrayAfterIter &&
        (await cb.arrayAfterIter({
            values: arrays,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'array'),
            setValue
        }));
}

/**
 * Iterate set value
 *
 * @param {SetValue} recipeValue
 * @param {Set<unknown>} sets
 * @param {string} path
 * @param {Callbacks} cb
 * @param {Params} params
 * @param {Function} setValue
 * @returns {Promise<void>}
 */
async function iterateSetValue(
    recipeValue: SetValue,
    sets: Array<Set<unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    const iterate =
        cb.set &&
        (await cb.set({
            values: sets,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'set'),
            setValue
        }));

    const iterStrat = getIterationStrategyFromCB(
        iterate,
        params.defaultIterationStrategies.setValues
    );

    if (iterStrat === 'off') {
        return;
    }

    await iterateValueArrays(
        iterStrat,
        recipeValue.item,
        sparseMap(sets, v => [...v]),
        path,
        cb,
        params,
        (i, elementIndex, value) => {
            // We do this weird thing, because we do not want to create a new set.
            // Otherwise, the set that we passed to the cb.set callback would be a different one.
            [...sets].forEach((v, j) => {
                sets[i].delete(v);
                sets[i].add(j === elementIndex ? value : v);
            });
            params.onValueChange(path, i, value);
        }
    );

    cb.setAfterIter &&
        (await cb.setAfterIter({
            values: sets,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'set'),
            setValue
        }));
}

// ######## Common iterations of the ValueType iterators ########

async function iterateReferenceValue(
    iterate: IterationStrategy,
    objs: Array<OneObjectTypes | OneIdObjectTypes>,
    path: string,
    cb: Callbacks,
    params: Params,
    idObject: boolean
): Promise<void> {
    const types = new Set<OneObjectTypeNames>();

    for (const obj of objs) {
        if (obj !== undefined) {
            types.add(obj.$type$);
        }
    }

    if (iterate === 'parallel') {
        if (types.size !== 1) {
            return;
        }

        const recipe = getRecipe([...types][0]);

        await iterateObjectValue(
            {type: 'object', rules: recipe.rule},
            objs as unknown as Array<Record<string, unknown>>,
            path,
            cb,
            params,
            (i: number, value: unknown) => {
                objs[i] = value as OneObjectTypes | OneIdObjectTypes;
                params.onValueChange(path, i, value);
            },
            idObject
        );
    } else if (iterate === 'separate') {
        const recipes = sparseMap(objs, obj => obj && getRecipe(obj.$type$));

        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const i in objs) {
            await iterateObjectValue(
                {type: 'object', rules: recipes[i].rule},
                makeSparseArray([[i, objs[i]]]) as unknown as Array<Record<string, unknown>>,
                path,
                cb,
                params,
                (index: number, value: unknown) => {
                    objs[index] = value as OneObjectTypes | OneIdObjectTypes;
                    params.onValueChange(path, index, value);
                },
                idObject
            );
        }
    }
}

async function iterateValues(
    iterate: IterationStrategy,
    valueType: ValueType,
    values: unknown[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): Promise<void> {
    if (iterate === 'parallel') {
        await iterateRecipeValue(valueType, values, path, cb, params, setValue);
    } else if (iterate === 'separate') {
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const i in values) {
            const newValues: unknown[] = [];
            newValues[i] = values[i];
            await iterateRecipeValue(valueType, newValues, path, cb, params, setValue);
        }
    }
}

async function iterateValueArrays(
    iterate: IterationStrategy,
    valueType: ValueType,
    arrays: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue?: (i: number, elementIndex: number, value: unknown) => void
): Promise<void> {
    if (iterate === 'parallel') {
        const lengths = sparseMap(arrays, v => v.length);
        const maxLength = Math.max(...lengths.filter(v => v !== undefined));

        for (let i = 0; i < maxLength; ++i) {
            const valuePath = path + `.${i}`;
            const values = new Array(arrays.length);

            for (const idx in arrays) {
                if (i < arrays[idx].length) {
                    values[idx] = arrays[idx][i];
                }
            }

            await iterateRecipeValue(valueType, values, valuePath, cb, params, (index, value) => {
                if (setValue) {
                    setValue(index, i, value);
                } else {
                    arrays[index][i] = value;
                }
                params.onValueChange(path, index, value);
            });
        }
    } else if (iterate === 'separate') {
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const sparseIndex in arrays) {
            for (let i = 0; i < arrays[sparseIndex].length; ++i) {
                const valuePath = path + `.${i}`;
                const values = new Array(arrays.length);

                if (sparseIndex in arrays && i < arrays[sparseIndex].length) {
                    values[sparseIndex] = arrays[sparseIndex][i];
                } else {
                    continue;
                }

                await iterateRecipeValue(
                    valueType,
                    values,
                    valuePath,
                    cb,
                    params,
                    (index, value) => {
                        arrays[index][i] = value;
                        params.onValueChange(path, index, value);
                    }
                );
            }
        }
    }
}

function getIterationStrategyFromCB(
    iterationStrategy: unknown,
    defaultStrategy: IterationStrategy
): IterationStrategy {
    if (iterationStrategy === undefined) {
        return defaultStrategy;
    } else if (iterationStrategy === 'parallel' || iterationStrategy === 'separate') {
        return iterationStrategy;
    } else {
        return 'off';
    }
}
