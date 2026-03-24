/* eslint-disable no-await-in-loop,jsdoc/require-param-type,jsdoc/require-returns */
import {getIdObject} from '../storage-versioned-objects.js';
import type {Blob, Clob, IdObject, PlainObject} from './determine-children.js';
import type {CbArgs} from './iterate-objects-sync.js';
import {iterateIdObjectsSync, iterateObjectsSync} from './iterate-objects-sync.js';
import {iterateIdObjects, iterateObjects} from './iterate-objects.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';
import type {
    BLOB,
    CLOB,
    OneIdObjectTypes,
    OneObjectTypes,
    ReferenceToBlobValue,
    ReferenceToClobValue,
    ReferenceToIdValue,
    ReferenceToObjValue
} from '../recipes.js';
import {getObject} from '../storage-unversioned-objects.js';

export interface BlobWithMetaData extends Blob {
    valueType: ReferenceToBlobValue;
    path: string;
}

export interface ClobWithMetaData extends Clob {
    valueType: ReferenceToClobValue;
    path: string;
}

export interface IdObjectWithMetaData extends IdObject {
    valueType: ReferenceToIdValue;
    path: string;
}

export interface PlainObjectWithMetaData extends PlainObject {
    valueType: ReferenceToObjValue;
    path: string;
}

export type ChildObjectWithMetaData =
    | BlobWithMetaData
    | ClobWithMetaData
    | IdObjectWithMetaData
    | PlainObjectWithMetaData;

/**
 * Compute a list of children of the passed object / hash.
 *
 * The list is sorted in such a way that all the dependencies of a child are behind the child.
 *
 * @param {SHA256Hash | OneObjectTypes} hashOrObj - Hash or object to iterate. This object will
 *                                                  not be part of the output list.
 * @param {boolean} iterateChildObjects - If true also descend into child ONE objects
 *                                        (referenceToObj, referenceToId)
 */
export async function determineChildrenWithMetadata(
    hashOrObj: SHA256Hash | OneObjectTypes,
    iterateChildObjects: boolean = true
): Promise<ChildObjectWithMetaData[]> {
    const obj = typeof hashOrObj === 'string' ? await getObject(hashOrObj) : hashOrObj;

    const cbs = new ChildObjectCollector();
    await iterateObjects([obj], cbs, {
        iterateChildObjects,
        iterateChildIdObjects: iterateChildObjects,
        defaultIterationStrategies: {
            mapKeys: 'parallel'
        }
    });

    return cbs.results;
}

/**
 * Compute a list of children of the passed object.
 *
 * @param {OneObjectTypes} obj - Object to iterate.
 */
export function determineChildrenWithMetadataSync(obj: OneObjectTypes): ChildObjectWithMetaData[] {
    const cbs = new ChildObjectCollector();
    iterateObjectsSync([obj], cbs, {
        defaultIterationStrategies: {
            mapKeys: 'parallel'
        }
    });

    return cbs.results;
}

/**
 * Compute a list of children of the passed id-object / id-hash.
 *
 * The list is sorted in such a way that all the dependencies of a child are behind the child.
 *
 * @param {SHA256IdHash | OneIdObjectTypes} idHashOrObj - Hash or object to iterate. This object
 *                                                        will not be part of the output list.
 * @param {boolean} iterateChildObjects - If true also descend into child ONE objects
 *                                        (referenceToObj, referenceToId)
 */
export async function determineChildrenForIdObjectWithMetadata(
    idHashOrObj: SHA256IdHash | OneIdObjectTypes,
    iterateChildObjects: boolean = true
): Promise<ChildObjectWithMetaData[]> {
    const idObj = typeof idHashOrObj === 'string' ? await getIdObject(idHashOrObj) : idHashOrObj;

    const cbs = new ChildObjectCollector();
    await iterateIdObjects([idObj], cbs, {
        iterateChildObjects,
        iterateChildIdObjects: iterateChildObjects,
        defaultIterationStrategies: {
            mapKeys: 'parallel'
        }
    });

    return cbs.results;
}

/**
 * Compute a list of children of the passed id-object.
 *
 * @param {OneIdObjectTypes} idObj - ID-Object to iterate.
 */
export function determineChildrenForIdObjectWithMetadataSync(
    idObj: OneIdObjectTypes
): ChildObjectWithMetaData[] {
    const cbs = new ChildObjectCollector();
    iterateIdObjectsSync([idObj], cbs, {
        defaultIterationStrategies: {
            mapKeys: 'parallel'
        }
    });

    return cbs.results;
}

// ######## Private ########

class ChildObjectCollector {
    childObjects = new Map<
        SHA256Hash<BLOB | CLOB | OneObjectTypes> | SHA256IdHash,
        ChildObjectWithMetaData
    >();

    constructor() {
        this.referenceToBlob = this.referenceToBlob.bind(this);
        this.referenceToClob = this.referenceToClob.bind(this);
        this.referenceToId = this.referenceToId.bind(this);
        this.referenceToObj = this.referenceToObj.bind(this);
    }

    get results(): ChildObjectWithMetaData[] {
        return [...this.childObjects.values()];
    }

    referenceToBlob(arg: CbArgs<SHA256Hash<BLOB>>): void {
        if (arg.valueType.type !== 'referenceToBlob') {
            throw new Error(
                'Programming Error in iterateObjects: Blob hash without ReferenceToBlob value type'
            );
        }

        this.childObjects.delete(arg.values[0]);
        this.childObjects.set(arg.values[0], {
            type: 'blob',
            hash: arg.values[0],
            valueType: arg.valueType,
            path: arg.path
        });
    }

    referenceToClob(arg: CbArgs<SHA256Hash<CLOB>>): void {
        if (arg.valueType.type !== 'referenceToClob') {
            throw new Error(
                'Programming Error in iterateObjects: Clob hash without ReferenceToClob value type'
            );
        }

        this.childObjects.delete(arg.values[0]);
        this.childObjects.set(arg.values[0], {
            type: 'clob',
            hash: arg.values[0],
            valueType: arg.valueType,
            path: arg.path
        });
    }

    referenceToId(arg: CbArgs<SHA256IdHash>): void {
        if (arg.valueType.type !== 'referenceToId') {
            throw new Error(
                'Programming Error in iterateObjects: Hash without ReferenceToObj value type'
            );
        }

        this.childObjects.delete(arg.values[0]);
        this.childObjects.set(arg.values[0], {
            type: 'id',
            hash: arg.values[0],
            valueType: arg.valueType,
            path: arg.path
        });
    }

    referenceToObj(arg: CbArgs<SHA256Hash>): void {
        if (arg.valueType.type !== 'referenceToObj') {
            throw new Error(
                'Programming Error in iterateObjects: Hash without ReferenceToObj value type'
            );
        }

        this.childObjects.delete(arg.values[0]);
        this.childObjects.set(arg.values[0], {
            type: 'object',
            hash: arg.values[0],
            valueType: arg.valueType,
            path: arg.path
        });
    }
}
