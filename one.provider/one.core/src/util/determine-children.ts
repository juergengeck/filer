/* eslint-disable no-await-in-loop,jsdoc/require-returns */
import {createError} from '../errors.js';
import {getIdObject} from '../storage-versioned-objects.js';
import type {CbArgs} from './iterate-objects-sync.js';
import {iterateIdObjectsSync, iterateObjectsSync} from './iterate-objects-sync.js';
import type {IterationStrategy} from './iterate-objects.js';
import {iterateIdObjects, iterateObjects} from './iterate-objects.js';
import {isHash} from './type-checks.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';
import type {BLOB, CLOB, OneIdObjectTypes, OneObjectTypes} from '../recipes.js';
import {getObject} from '../storage-unversioned-objects.js';

export interface Blob {
    type: 'blob';
    hash: SHA256Hash<BLOB>;
}

export interface Clob {
    type: 'clob';
    hash: SHA256Hash<CLOB>;
}

export interface IdObject {
    type: 'id';
    hash: SHA256IdHash;
}

export interface PlainObject {
    type: 'object';
    hash: SHA256Hash;
}

export type ChildObject = Blob | Clob | IdObject | PlainObject;

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
export async function determineChildren(
    hashOrObj: SHA256Hash | OneObjectTypes,
    iterateChildObjects: boolean = true
): Promise<ChildObject[]> {
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
export function determineChildrenSync(obj: OneObjectTypes): ChildObject[] {
    const cbs = new ChildObjectCollectorSync();
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
export async function determineChildrenForIdObject(
    idHashOrObj: SHA256IdHash | OneIdObjectTypes,
    iterateChildObjects: boolean = true
): Promise<ChildObject[]> {
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
export function determineChildrenForIdObjectSync(idObj: OneIdObjectTypes): ChildObject[] {
    const cbs = new ChildObjectCollectorSync();
    iterateIdObjectsSync([idObj], cbs, {
        defaultIterationStrategies: {
            mapKeys: 'parallel'
        }
    });

    return cbs.results;
}

// ######## Parser for ChildObject ########

/**
 * Parse and validate a JSON serialized ChildObject array.
 *
 * @param {unknown} data - string with JSON array of ChildObjects
 * @returns {ChildObject[]}
 */
export function parseChildren(data: unknown): ChildObject[] {
    if (typeof data !== 'string') {
        throw createError('DC-PC1', {data});
    }

    const childObjects = JSON.parse(data);

    if (!Array.isArray(childObjects)) {
        throw createError('DC-PC2', {data: childObjects});
    }

    for (const childObject of childObjects) {
        if (
            childObject.type !== 'blob' &&
            childObject.type !== 'clob' &&
            childObject.type !== 'id' &&
            childObject.type !== 'object'
        ) {
            throw createError('DC-PC3', {type: childObject.type});
        }

        if (!isHash(childObject.hash)) {
            throw createError('DC-PC4', {hash: childObject.hash});
        }
    }

    return childObjects as ChildObject[];
}

// ######## Private ########

class ChildObjectCollector {
    childObjects = new Map<SHA256Hash<BLOB | CLOB | OneObjectTypes> | SHA256IdHash, ChildObject>();

    constructor() {
        this.referenceToBlob = this.referenceToBlob.bind(this);
        this.referenceToClob = this.referenceToClob.bind(this);
        this.referenceToId = this.referenceToId.bind(this);
        this.referenceToObj = this.referenceToObj.bind(this);
    }

    get results(): ChildObject[] {
        return [...this.childObjects.values()].reverse();
    }

    referenceToBlob(arg: CbArgs<SHA256Hash<BLOB>>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'blob', hash: arg.values[0]});
    }

    referenceToClob(arg: CbArgs<SHA256Hash<CLOB>>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'clob', hash: arg.values[0]});
    }

    referenceToId(arg: CbArgs<SHA256IdHash>): IterationStrategy {
        return this.childObjects.has(arg.values[0]) ? 'off' : 'parallel';
    }

    referenceToIdAfterIter(arg: CbArgs<SHA256IdHash>): void {
        this.childObjects.set(arg.values[0], {type: 'id', hash: arg.values[0]});
    }

    referenceToObj(arg: CbArgs<SHA256Hash>): IterationStrategy {
        return this.childObjects.has(arg.values[0]) ? 'off' : 'parallel';
    }

    referenceToObjAfterIter(arg: CbArgs<SHA256Hash>): void {
        this.childObjects.set(arg.values[0], {type: 'object', hash: arg.values[0]});
    }
}

class ChildObjectCollectorSync {
    childObjects = new Map<SHA256Hash<BLOB | CLOB | OneObjectTypes> | SHA256IdHash, ChildObject>();

    constructor() {
        this.referenceToBlob = this.referenceToBlob.bind(this);
        this.referenceToClob = this.referenceToClob.bind(this);
        this.referenceToId = this.referenceToId.bind(this);
        this.referenceToObj = this.referenceToObj.bind(this);
    }

    get results(): ChildObject[] {
        return [...this.childObjects.values()];
    }

    referenceToBlob(arg: CbArgs<SHA256Hash<BLOB>>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'blob', hash: arg.values[0]});
    }

    referenceToClob(arg: CbArgs<SHA256Hash<CLOB>>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'clob', hash: arg.values[0]});
    }

    referenceToId(arg: CbArgs<SHA256IdHash>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'id', hash: arg.values[0]});
    }

    referenceToObj(arg: CbArgs<SHA256Hash>): void {
        if (this.childObjects.has(arg.values[0])) {
            return;
        }

        this.childObjects.set(arg.values[0], {type: 'object', hash: arg.values[0]});
    }
}
