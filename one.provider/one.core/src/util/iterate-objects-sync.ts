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
import {sparseMap} from './array.js';
import {isObject} from './type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';

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
    defaultIterationStrategies?: {
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
    string?(args: CbArgs<string>): void;
    integer?(args: CbArgs<number>): void;
    number?(args: CbArgs<number>): void;
    boolean?(args: CbArgs<boolean>): void;

    referenceToObj?(args: CbArgs<SHA256Hash>): void;
    referenceToId?(args: CbArgs<SHA256IdHash>): void;
    referenceToClob?(args: CbArgs<SHA256Hash<CLOB>>): void;
    referenceToBlob?(args: CbArgs<SHA256Hash<BLOB>>): void;
    map?(args: CbArgs<Map<string, unknown>>): void;

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
    ): MapIterationStrategy | IterationStrategy | void;
    bag?(args: CbArgs<unknown[]>): IterationStrategy | void;
    array?(args: CbArgs<unknown[]>): IterationStrategy | void;
    set?(args: CbArgs<Set<unknown>>): IterationStrategy | void;
    object?(args: CbArgs<Record<string, unknown>>): void;

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
    ): IterationStrategy | void;
    stringifiable?(args: CbArgs<string>): void;
}

/**
 * Iterate over multiple objects at the same time and calling the passed callbacks.
 *
 * @param {T[]} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 */
export function iterateObjectsSync<T extends OneObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options?: IterateOptions
): void {
    iterateAnyObjectsSync(objs, cb, options || {}, false);
}

/**
 * Iterate over a single id-object and call the specified callbacks
 *
 * @param {T} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 */
export function iterateIdObjectsSync<T extends OneIdObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options?: IterateOptions
): void {
    iterateAnyObjectsSync(objs, cb, options || {}, true);
}

/**
 * Iterate over a single (id-)object and call the specified callbacks
 *
 * @param {T} objs
 * @param {Callbacks} cb
 * @param {IterateOptions} options
 * @param {boolean} idObject
 */
export function iterateAnyObjectsSync<T extends OneIdObjectTypes | OneObjectTypes>(
    objs: T[],
    cb: Callbacks,
    options: IterateOptions,
    idObject: boolean
): void {
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
        defaultIterationStrategies: {
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

    iterateObjectValue(
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
    defaultIterationStrategies: {
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

function iterateRecipeValue(
    recipeValue: ValueType,
    values: unknown[],
    path: string,
    cb: Callbacks,
    p: Params,
    setValue: (i: number, value: unknown) => void
): void {
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
            cb.string && cb.string(cbArgs as CbArgs<string>);
            break;
        case 'integer':
            cb.integer && cb.integer(cbArgs as CbArgs<number>);
            break;
        case 'number':
            cb.number && cb.number(cbArgs as CbArgs<number>);
            break;
        case 'boolean':
            cb.boolean && cb.boolean(cbArgs as CbArgs<boolean>);
            break;
        case 'referenceToObj':
            iterateReferenceToObjectValue(
                recipeValue,
                values as SHA256Hash[],
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'referenceToId':
            iterateReferenceToIdValue(recipeValue, values as SHA256IdHash[], path, cb, p, setValue);
            break;
        case 'referenceToClob':
            cb.referenceToClob && cb.referenceToClob(cbArgs as CbArgs<SHA256Hash<CLOB>>);
            break;
        case 'referenceToBlob':
            cb.referenceToBlob && cb.referenceToBlob(cbArgs as CbArgs<SHA256Hash<BLOB>>);
            break;
        case 'map':
            iterateMapValue(
                recipeValue,
                values as Array<Map<string, unknown>>,
                path,
                cb,
                p,
                setValue
            );
            break;
        case 'bag':
            iterateBagValue(recipeValue, values as unknown[][], path, cb, p, setValue);
            break;
        case 'array':
            iterateArrayValue(recipeValue, values as unknown[][], path, cb, p, setValue);
            break;
        case 'set':
            iterateSetValue(recipeValue, values as Array<Set<unknown>>, path, cb, p, setValue);
            break;
        case 'object':
            iterateObjectValue(
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
            cb.stringifiable && cb.stringifiable(cbArgs as CbArgs<string>);
            break;
    }
}

function iterateReferenceToObjectValue(
    recipeValue: ReferenceToObjValue,
    hashes: SHA256Hash[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    cb.referenceToObj &&
        cb.referenceToObj({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToObj'
            ),
            setValue
        });
}

function iterateReferenceToIdValue(
    recipeValue: ReferenceToIdValue,
    hashes: SHA256IdHash[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    cb.referenceToId &&
        cb.referenceToId({
            values: hashes,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(
                params.crdtConfig,
                path,
                'referenceToId'
            ),
            setValue
        });
}

function iterateObjectValue(
    recipeValue: ObjectValue,
    objs: Array<Record<string, unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void,
    idObject: boolean
): void {
    cb.object &&
        cb.object({
            values: objs,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'object'),
            setValue
        });

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
            cb.objectProperty({
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
            });

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

        if (hasValuesLeft) {
            iterateValues(
                getIterationStrategyFromCB(iterate, params.defaultIterationStrategies.objectValues),
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
    }
}

function iterateMapValue(
    recipeValue: MapValue,
    maps: Array<Map<string, unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    cb.map &&
        cb.map({
            values: maps,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'map'),
            setValue
        });

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
            cb.mapEntry({
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
            });

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

        if (hasValuesLeft) {
            iterateValues(
                getIterationStrategyFromCB(
                    keyIterationStrategy,
                    params.defaultIterationStrategies.mapKeys
                ),
                recipeValue.key,
                keysForIter,
                keyPathForIteration,
                cb,
                params,
                () => {
                    throw new Error('Changing keys is not supported');
                }
            );

            iterateValues(
                getIterationStrategyFromCB(
                    valueIterationStrategy,
                    params.defaultIterationStrategies.mapValues
                ),
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
 */
function iterateBagValue(
    recipeValue: BagValue,
    bags: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    const iterate =
        cb.bag &&
        cb.bag({
            values: bags,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'bag'),
            setValue
        });

    iterateValueArrays(
        getIterationStrategyFromCB(iterate, params.defaultIterationStrategies.bagValues),
        recipeValue.item,
        bags,
        path,
        cb,
        params
    );
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
 */
function iterateArrayValue(
    recipeValue: ArrayValue,
    arrays: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    const iterate =
        cb.array &&
        cb.array({
            values: arrays,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'array'),
            setValue
        });

    iterateValueArrays(
        getIterationStrategyFromCB(iterate, params.defaultIterationStrategies.arrayValues),
        recipeValue.item,
        arrays,
        path,
        cb,
        params
    );
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
 */
function iterateSetValue(
    recipeValue: SetValue,
    sets: Array<Set<unknown>>,
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    const iterate =
        cb.set &&
        cb.set({
            values: sets,
            valueType: recipeValue,
            path,
            crdtAlgorithm: getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'set'),
            setValue
        });

    iterateValueArrays(
        getIterationStrategyFromCB(iterate, params.defaultIterationStrategies.setValues),
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
}

// ######## Common iterations of the ValueType iterators ########

function iterateValues(
    iterate: IterationStrategy,
    valueType: ValueType,
    values: unknown[],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue: (i: number, value: unknown) => void
): void {
    if (iterate === 'parallel') {
        iterateRecipeValue(valueType, values, path, cb, params, setValue);
    } else if (iterate === 'separate') {
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const i in values) {
            const newValues: unknown[] = [];
            newValues[i] = values[i];
            iterateRecipeValue(valueType, newValues, path, cb, params, setValue);
        }
    }
}

function iterateValueArrays(
    iterate: IterationStrategy,
    valueType: ValueType,
    arrays: unknown[][],
    path: string,
    cb: Callbacks,
    params: Params,
    setValue?: (i: number, elementIndex: number, value: unknown) => void
): void {
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

            iterateRecipeValue(valueType, values, valuePath, cb, params, (index, value) => {
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

                iterateRecipeValue(valueType, values, valuePath, cb, params, (index, value) => {
                    arrays[index][i] = value;
                    params.onValueChange(path, index, value);
                });
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
