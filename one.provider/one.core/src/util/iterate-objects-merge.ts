/* eslint-disable no-await-in-loop */
import type {OneVersionedObjectInterfaces} from '@OneObjectInterfaces';
import type {CrdtAlgorithm} from '../crdts/interfaces/CrdtAlgorithm.js';
import {getCrdtAlgorithmFromConfigOrDefault} from '../crdts/CrdtAlgorithmRegistry.js';
import type {OptionalValueMergeResult} from '../crdts/interfaces/CrdtAlgorithmOptionalValue.js';
import type {ReferenceToObjectMergeResult} from '../crdts/interfaces/CrdtAlgorithmReferenceToObject.js';
import type {Transformation} from '../crdts/interfaces/Transformation.js';
import {getRecipe, isVersionedObject, resolveRuleInheritance} from '../object-recipes.js';
import type {
    BLOB,
    CLOB,
    MapValue,
    ObjectValue,
    OneObjectTypes,
    OneVersionedObjectTypeNames,
    ReferenceToObjValue,
    ValueType
} from '../recipes.js';
import {storeUnversionedObject} from '../storage-unversioned-objects.js';
import type {VersionedObjectResult} from '../storage-versioned-objects.js';
import {storeVersionedObject, storeVersionedObjectNoMerge} from '../storage-versioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';
import type {ChildVersionTree} from '../crdts/VersionTree.js';
import type {VersionTree} from '../crdts/VersionTree.js';

type PromiseOrNot<T> = T | Promise<T>;

/**
 * Arguments that all callbacks receive.
 */
export interface CbArgs<T> {
    path: string;
    tree: ChildVersionTree<T, Transformation[]>;
    valueType: ValueType;
    crdtAlgorithm: CrdtAlgorithm;
}

/**
 * Interface that must be implemented by the caller of iterateObjectsMerge.
 */
export interface MergeCallbacks {
    string(args: CbArgs<string>): PromiseOrNot<string>;
    integer(args: CbArgs<number>): PromiseOrNot<number>;
    number(args: CbArgs<number>): PromiseOrNot<number>;
    boolean(args: CbArgs<boolean>): PromiseOrNot<boolean>;
    referenceToObj(args: CbArgs<SHA256Hash>): PromiseOrNot<ReferenceToObjectMergeResult>;
    referenceToId(args: CbArgs<SHA256IdHash>): PromiseOrNot<SHA256IdHash>;
    referenceToClob(args: CbArgs<SHA256Hash<CLOB>>): PromiseOrNot<SHA256Hash<CLOB>>;
    referenceToBlob(args: CbArgs<SHA256Hash<BLOB>>): PromiseOrNot<SHA256Hash<BLOB>>;
    map(args: CbArgs<Map<string, unknown>>): PromiseOrNot<Map<string, unknown>>;
    mapEntry(args: CbArgs<unknown>): PromiseOrNot<OptionalValueMergeResult>;
    bag(args: CbArgs<unknown[]>): PromiseOrNot<unknown[]>;
    array(args: CbArgs<unknown[]>): PromiseOrNot<unknown[]>;
    set(args: CbArgs<Set<unknown>>): PromiseOrNot<Set<unknown>>;
    object(args: CbArgs<Record<string, unknown>>): PromiseOrNot<Record<string, unknown>>;
    objectProperty(args: CbArgs<unknown>): PromiseOrNot<OptionalValueMergeResult>;
    stringifiable(args: CbArgs<string>): PromiseOrNot<string>;
}

export async function iterateObjectsMerge<T extends OneVersionedObjectTypeNames>(
    type: T,
    tree: VersionTree,
    cb: MergeCallbacks
): Promise<VersionedObjectResult<OneVersionedObjectInterfaces[T]> & {timestamp: number}> {
    const recipe = getRecipe(type);

    const newObj = {
        ...(await iterateObjectMerge({type: 'object', rules: recipe.rule}, '', cb, {
            crdtConfig: recipe.crdtConfig || new Map(),
            tree
        })),
        $type$: type
    } as OneVersionedObjectInterfaces[T];

    return storeVersionedObjectNoMerge(newObj);
}

// ######## Private API ########

interface Params {
    crdtConfig: Map<string, string>;
    tree: VersionTree;
}

async function iterateRecipeValueMerge(
    recipeValue: ValueType,
    path: string,
    cb: MergeCallbacks,
    params: Params
): Promise<unknown> {
    const crdtAlgorithm = getCrdtAlgorithmFromConfigOrDefault(
        params.crdtConfig,
        path,
        recipeValue.type
    );

    const cbArgs: CbArgs<unknown> = {
        path,
        valueType: recipeValue,
        tree: await params.tree.createTreeForSubPath(`${path}#${crdtAlgorithm.id}`),
        crdtAlgorithm
    };

    switch (recipeValue.type) {
        case 'string':
            return cb.string(cbArgs as CbArgs<string>);
        case 'integer':
            return cb.integer(cbArgs as CbArgs<number>);
        case 'number':
            return cb.number(cbArgs as CbArgs<number>);
        case 'boolean':
            return cb.boolean(cbArgs as CbArgs<boolean>);
        case 'referenceToObj':
            return iterateReferenceToObjectMerge(recipeValue, path, cb, params);
        case 'referenceToId':
            return cb.referenceToId(cbArgs as CbArgs<SHA256IdHash>);
        case 'referenceToClob':
            return cb.referenceToClob(cbArgs as CbArgs<SHA256Hash<CLOB>>);
        case 'referenceToBlob':
            return cb.referenceToBlob(cbArgs as CbArgs<SHA256Hash<BLOB>>);
        case 'map':
            if (crdtAlgorithm.algoType === 'NotAvailable') {
                return iterateMapMerge(recipeValue, path, cb, params);
            } else {
                return cb.map(cbArgs as CbArgs<Map<string, unknown>>);
            }
        case 'bag':
            return cb.bag(cbArgs as CbArgs<unknown[]>);
        case 'array':
            return cb.array(cbArgs as CbArgs<unknown[]>);
        case 'set':
            return cb.set(cbArgs as CbArgs<Set<unknown>>);
        case 'object':
            if (crdtAlgorithm.algoType === 'NotAvailable') {
                return iterateObjectMerge(recipeValue, path, cb, params);
            } else {
                return cb.object(cbArgs as CbArgs<Record<string, unknown>>);
            }
        case 'stringifiable':
            return cb.stringifiable(cbArgs as CbArgs<string>);
        default:
            throw new Error('Found unexpected ValueType!');
    }
}

async function iterateReferenceToObjectMerge(
    recipeValue: ReferenceToObjValue,
    path: string,
    cb: MergeCallbacks,
    params: Params
): Promise<SHA256Hash> {
    const crdtAlgorithm = getCrdtAlgorithmFromConfigOrDefault(
        params.crdtConfig,
        path,
        'referenceToObj'
    );

    const result = await cb.referenceToObj({
        path,
        tree: await params.tree.createTreeForSubPath(`${path}#${crdtAlgorithm.id}`, false),
        valueType: recipeValue,
        crdtAlgorithm
    });

    if (result.action === 'set') {
        return result.value;
    } else {
        const newObj = {
            ...(await iterateObjectMerge(
                {type: 'object', rules: getRecipe(result.type).rule},
                path,
                cb,
                {
                    crdtConfig: params.crdtConfig,
                    tree: result.tree
                }
            )),
            $type$: result.type
        } as OneObjectTypes;

        if (isVersionedObject(newObj)) {
            // TODO: This should not write to the version map
            return (await storeVersionedObject(newObj)).hash;
        } else {
            return (await storeUnversionedObject(newObj)).hash;
        }
    }
}

async function iterateObjectMerge(
    recipeValue: ObjectValue,
    path: string,
    cb: MergeCallbacks,
    params: Params
): Promise<Record<string, unknown>> {
    const crdtAlgorithm = getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'object');

    const childTree = await params.tree.createTreeForSubPath<Record<string, unknown>>(
        `${path}#${crdtAlgorithm.id}`
    );

    if (crdtAlgorithm.algoType !== 'NotAvailable') {
        return cb.object({
            path: path,
            tree: childTree,
            valueType: recipeValue,
            crdtAlgorithm
        });
    }

    const resultObj: Record<string, unknown> = {
        ...(childTree.commonHistoryNode.type === 'empty'
            ? childTree.firstMergeNode.data
            : childTree.commonHistoryNode.data)
    };
    const changedProps = new Set<string>(
        params.tree.getChangedSubPaths(path, true).map(p => p.split('.')[0])
    );

    for (const rawRule of recipeValue.rules) {
        const rule = resolveRuleInheritance(rawRule);
        const itemtype = rule.itemtype || {type: 'string'};

        // Skip children that have no changes
        if (!changedProps.has(rule.itemprop)) {
            continue;
        }

        const subPath = path === '' ? rule.itemprop : path.concat('.', rule.itemprop);

        const crdtAlgorithmProp = getCrdtAlgorithmFromConfigOrDefault(
            params.crdtConfig,
            subPath,
            'objectProperty'
        );

        const result: OptionalValueMergeResult = rule.optional
            ? await cb.objectProperty({
                  path: subPath,
                  tree: await params.tree.createTreeForSubPath(
                      `${subPath}#${crdtAlgorithmProp.id}`,
                      false
                  ),
                  valueType: itemtype,
                  crdtAlgorithm: crdtAlgorithmProp
              })
            : {
                  action: 'iterate',
                  tree: params.tree
              };

        if (result.action === 'set') {
            resultObj[rule.itemprop] = result.value;
        } else if (result.action === 'delete') {
            delete resultObj[rule.itemprop];
        } else {
            resultObj[rule.itemprop] = await iterateRecipeValueMerge(itemtype, subPath, cb, {
                crdtConfig: params.crdtConfig,
                tree: result.tree
            });
        }
    }

    return resultObj;
}

async function iterateMapMerge(
    recipeValue: MapValue,
    path: string,
    cb: MergeCallbacks,
    params: Params
): Promise<Map<string, unknown>> {
    const crdtAlgorithm = getCrdtAlgorithmFromConfigOrDefault(params.crdtConfig, path, 'map');
    const childTree = await params.tree.createTreeForSubPath<Map<string, unknown>>(
        `${path}#${crdtAlgorithm.id}`
    );

    if (crdtAlgorithm.algoType !== 'NotAvailable') {
        return cb.map({
            path: path,
            tree: childTree,
            valueType: recipeValue,
            crdtAlgorithm
        });
    }

    const resultMap =
        childTree.commonHistoryNode.type === 'empty'
            ? new Map<string, unknown>(childTree.firstMergeNode.data)
            : new Map(childTree.commonHistoryNode.data);
    const changedKeys = new Set<string>(
        params.tree.getChangedSubPaths(path, true).map(p => p.split('.')[0])
    );

    for (const key of changedKeys) {
        const subPath = path === '' ? key : path.concat('.', key);

        const crdtAlgorithmElem = getCrdtAlgorithmFromConfigOrDefault(
            params.crdtConfig,
            subPath,
            'mapEntry'
        );

        const result = await cb.mapEntry({
            path: subPath,
            tree: await params.tree.createTreeForSubPath(`${subPath}#${crdtAlgorithmElem.id}`),
            valueType: recipeValue,
            crdtAlgorithm: crdtAlgorithmElem
        });

        if (result.action === 'set') {
            resultMap.set(key, result.value);
        } else if (result.action === 'delete') {
            resultMap.delete(key);
        } else {
            resultMap.set(
                key,
                await iterateRecipeValueMerge(recipeValue.value, subPath, cb, {
                    crdtConfig: params.crdtConfig,
                    tree: result.tree
                })
            );
        }
    }

    return resultMap;
}
