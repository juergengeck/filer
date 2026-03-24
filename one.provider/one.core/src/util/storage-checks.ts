/* eslint-disable no-await-in-loop */
/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import {createError} from '../errors.js';
import type {BLOB, CLOB, HashTypes} from '../recipes.js';
import {readBlobAsArrayBuffer} from '../storage-blob.js';
import {getObject} from '../storage-unversioned-objects.js';
import {getIdObject} from '../storage-versioned-objects.js';
import {getFileType, listAllObjectHashes, readUTF8TextFile} from '../system/storage-base.js';
import type {LinkedObjectsHashAndValueTypeList} from './object-find-links.js';
import {
    findLinkedHashesWithValueTypeInIdObject,
    findLinkedHashesWithValueTypeInObject
} from './object-find-links.js';
import {createReadonlyTrackingObj} from './object.js';
import {isFunction} from './type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from './type-checks.js';

export interface StorageCheckStatistics {
    nrFilesTotal: number;
    nrFilesVisited: number;
    nrIdObjectsVisited: number;
    nrObjectsVisited: number;
    nrBlobsVisited: number;
    nrClobsVisited: number;
    problems: Map<SHA256Hash<HashTypes> | SHA256IdHash, string[]>;
}

let checkIsRunning = false;

/**
 * Function to check storage integrity of storage space "objects". It iterates over all files
 * and checks if all linked hashes exist and are readable, and if all links have the correct
 * tyoe asked for in the recipe.
 * @static
 * @param {function(string):undefined} [onProblemCb]
 * @param {function(StorageCheckStatistics):undefined} [onProgressCb]
 * @returns {Promise<StorageCheckStatistics>}
 */
export async function checkAllObjectHashes(
    onProblemCb: (problem: string) => void = () => undefined,
    onProgressCb: (stats: Readonly<StorageCheckStatistics>) => void = () => undefined
): Promise<StorageCheckStatistics> {
    function addProblem(hash: SHA256Hash<HashTypes> | SHA256IdHash, msg: string): void {
        const issueList = Stats.problems.get(hash) ?? [];
        issueList.push(msg);
        Stats.problems.set(hash, issueList);
        onProblemCb(msg);
    }

    async function handleBlob(fileHash: SHA256Hash<BLOB>): Promise<void> {
        Stats.nrBlobsVisited += 1;

        try {
            // TEST if it's possible to read the file (test for corruption)
            await readBlobAsArrayBuffer(fileHash);
        } catch (err) {
            addProblem(fileHash, `${fileHash} (BLOB) ERROR: ${err.message}`);
        }
    }

    async function handleClob(fileHash: SHA256Hash<CLOB>): Promise<void> {
        Stats.nrClobsVisited += 1;

        try {
            // TEST if it's possible to read the file (test for corruption)
            await readUTF8TextFile(fileHash);
        } catch (err) {
            addProblem(fileHash, `${fileHash} (CLOB) ERROR: ${err.message}`);
        }
    }

    async function checkObjectRefs(
        fileHash: SHA256Hash | SHA256IdHash,
        type: string,
        refs: LinkedObjectsHashAndValueTypeList['references']
    ): Promise<void> {
        for (const {hash, valueType} of refs) {
            const depObj = await getObject(hash);
            const allowedTypes = valueType.allowedTypes;

            if (!allowedTypes.has('*') && !allowedTypes.has(depObj.$type$)) {
                addProblem(
                    fileHash,
                    `${fileHash} (${type}) Referenced object ${hash} has type ` +
                        `"${depObj.$type$}". Allowed are ${[...allowedTypes]}.`
                );
            }
        }
    }

    async function checkIdObjectRefs(
        fileHash: SHA256Hash | SHA256IdHash,
        type: string,
        refs: LinkedObjectsHashAndValueTypeList['idReferences']
    ): Promise<void> {
        for (const {hash, valueType} of refs) {
            const depObj = await getIdObject(hash);
            const allowedTypes = valueType.allowedTypes;

            if (!allowedTypes.has('*') && !allowedTypes.has(depObj.$type$)) {
                addProblem(
                    fileHash,
                    `${fileHash} (${type}) Referenced object ${hash} has type ` +
                        `"${depObj.$type$}". Allowed are ${[...allowedTypes]}.`
                );
            }
        }
    }

    // TODO Check reverse maps and, for versioned and for ID objects, version maps

    async function handleIdObject(fileHash: SHA256IdHash, type: string): Promise<void> {
        Stats.nrIdObjectsVisited += 1;

        try {
            const obj = await getIdObject(fileHash);
            const deps = findLinkedHashesWithValueTypeInIdObject(obj);

            await checkObjectRefs(fileHash, type, deps.references);
            await checkIdObjectRefs(fileHash, type, deps.idReferences);

            for (const {hash} of deps.blobs) {
                await handleBlob(hash);
            }

            for (const {hash} of deps.clobs) {
                await handleClob(hash);
            }
        } catch (err) {
            addProblem(fileHash, `${fileHash} (${type}) ERROR: ${err.message}`);
        }
    }

    async function handleObject(fileHash: SHA256Hash, type: string): Promise<void> {
        Stats.nrObjectsVisited += 1;

        try {
            const obj = await getObject(fileHash);
            const deps = findLinkedHashesWithValueTypeInObject(obj);

            await checkObjectRefs(fileHash, type, deps.references);
            await checkIdObjectRefs(fileHash, type, deps.idReferences);

            for (const {hash} of deps.blobs) {
                await handleBlob(hash);
            }

            for (const {hash} of deps.clobs) {
                await handleClob(hash);
            }
        } catch (err) {
            addProblem(fileHash, `${fileHash} (${type}) ERROR: ${err.message}`);
        }
    }

    if (checkIsRunning) {
        throw createError('USC-CAOH1');
    }

    checkIsRunning = true;

    const Stats: StorageCheckStatistics = {
        nrFilesTotal: 0,
        nrFilesVisited: 0,
        nrIdObjectsVisited: 0,
        nrObjectsVisited: 0,
        nrBlobsVisited: 0,
        nrClobsVisited: 0,
        problems: new Map()
    };

    const ReadonlyStats = createReadonlyTrackingObj(Stats);

    let reportInterval: undefined | ReturnType<typeof setInterval>;

    if (isFunction(onProgressCb)) {
        reportInterval = setInterval(() => {
            onProgressCb(ReadonlyStats);
        }, 750);
    }

    const hashes = await listAllObjectHashes();

    Stats.nrFilesTotal = hashes.length;

    for (const fileHash of hashes) {
        Stats.nrFilesVisited += 1;

        const type = await getFileType(fileHash);

        if (type === 'BLOB') {
            await handleBlob(fileHash as SHA256Hash<BLOB>);
        } else if (type === 'CLOB') {
            await handleClob(fileHash as SHA256Hash<CLOB>);
        } else if (type.endsWith(' [ID]')) {
            await handleIdObject(fileHash as SHA256IdHash, type);
        } else {
            await handleObject(fileHash as SHA256Hash, type);
        }
    }

    if (reportInterval !== undefined) {
        clearInterval(reportInterval);
    }

    checkIsRunning = false;

    return Stats;
}
