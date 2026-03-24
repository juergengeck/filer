/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * **This module provides functions to other ONE core modules. It should not be used by
 * applications.**
 *
 * Reverse maps are `\n` separated lists of hashes of objects referencing the object the reverse
 * mao belongs to. The map name is hash.$type$ - $type$ being the type of the referencing
 * objects that the map is for. The hash is the object the map belongs to, which is the target
 * of the hash links.
 *
 * There is no difference between ID and regular hashes. Both target and reference hashes can be
 * either regular or ID hashes. The referencing object's hash link can be an ID hash. The
 * referencing object can itself be an ID object, since ID properties can be [ID] hash links.
 *
 * Entries are hex string format SHA-256 hashes separated by newlines '\n' (Unix style, not \r\n
 * Windows style).
 *
 * ReverseMaps are unordered and do not contain duplicates (they would be redundant).
 *
 * Also see module reverse-map-query.
 * @private
 * @module
 */

import {createError} from './errors.js';
import type {
    OneIdObjectTypes,
    OneObjectTypeNames,
    OneObjectTypes,
    OneVersionedObjectTypeNames,
    OneVersionedObjectTypes
} from './recipes.js';
import type {FileCreation, FileCreationStatus} from './storage-base-common.js';
import {CREATION_STATUS, STORAGE} from './storage-base-common.js';
import type {IdFileCreation} from './storage-versioned-objects.js';
import {appendUTF8SystemMapFile, readUTF8TextFile} from './system/storage-base.js';
import {
    determineChildrenForIdObjectWithMetadataSync,
    determineChildrenWithMetadataSync
} from './util/determine-children-with-metadata.js';
import {serializeWithType} from './util/promise.js';

/**
 * For these ONE core parent object types that reference other (core or non-core) objects
 * reverse maps must always be written.
 * @private
 * @type {Array<Array<OneObjectTypeNames,Set<string>>>}
 */
const CORE_RVMAPS: ReadonlyArray<[OneObjectTypeNames, Set<string>]> = [
    ['Access', new Set(['*'])],
    ['Group', new Set(['*'])],
    ['IdAccess', new Set(['*'])],
    ['Keys', new Set(['*'])]
];

/**
 * For these ONE core parent ID object types that reference other (core or non-core) objects
 * reverse maps must always be written.
 * @private
 * @type {Array<Array<OneObjectTypeNames,Set<string>>>}
 */
const CORE_RVMAPSIDOBJS: ReadonlyArray<[OneVersionedObjectTypeNames, Set<string>]> = [
    ['Access', new Set(['*'])],
    ['IdAccess', new Set(['*'])],
    ['Instance', new Set(['*'])]
];

/**
 * Reverse maps are written only for types listed here.
 * @private
 * @type {Map<OneObjectTypeNames,Set<string>>}
 */
const enabledRvMapTypes: Map<OneObjectTypeNames, Set<string>> = new Map(CORE_RVMAPS);

/**
 * Reverse maps are written only for ID objects of types listed here.
 * @private
 * @type {Map<OneObjectTypeNames,Set<string>>}
 */
const enabledRvMapTypesForIdObjects: Map<OneVersionedObjectTypeNames, Set<string>> = new Map(
    CORE_RVMAPSIDOBJS
);

/**
 * Add a ONE object type name for which reverse maps should be written. Adding a type more than
 * once is considered an error. This initialization should be done at start-up exactly once and
 * completely. It would be too hard to tell here if receiving the same type twice is just bad
 * coding or an error, and to just do "magic" silently, like overriding the existing entry or
 * adding to the Set in the value part could just lead to hard-to-debug problems because
 * problems will manifest not here but somewhere down the line.
 * @static
 * @param {OneObjectTypeNames} type
 * @param {Set<string>} props
 * @returns {undefined}
 */
export function addEnabledRvMapType(type: OneObjectTypeNames, props: Set<string>): void {
    if (enabledRvMapTypes.has(type)) {
        throw createError('SRH-AEMAP1', {type, props});
    }

    enabledRvMapTypes.set(type, props);
}

/**
 * Add a ONE object type name for which ID object reverse maps should be written. Adding a type more
 * than once is considered an error. This initialization should be done at start-up exactly once and
 * completely. It would be too hard to tell here if receiving the same type twice is just bad
 * coding or an error, and to just do "magic" silently, like overriding the existing entry or
 * adding to the Set in the value part could just lead to hard-to-debug problems because
 * problems will manifest not here but somewhere down the line.
 * @static
 * @param {OneVersionedObjectTypeNames} type
 * @param {Set<string>} props
 * @returns {undefined}
 */
export function addEnabledRvMapTypeForIdObjects(
    type: OneVersionedObjectTypeNames,
    props: Set<string>
): void {
    if (enabledRvMapTypesForIdObjects.has(type)) {
        throw createError('SRH-AEMAP1', {type, props});
    }

    enabledRvMapTypesForIdObjects.set(type, props);
}

/**
 * To support closing an Instance the map of types for which to write reverse maps needs to be
 * cleared.
 * @static
 * @returns {undefined}
 */
export function clearRvMapTypes(): void {
    enabledRvMapTypes.clear();
    enabledRvMapTypesForIdObjects.clear();
    CORE_RVMAPS.forEach(([type, props]) => enabledRvMapTypes.set(type, props));
    CORE_RVMAPSIDOBJS.forEach(([type, props]) => enabledRvMapTypesForIdObjects.set(type, props));
}

/**
 * This function adds the given new entry to the given reverse map only if this entry does not
 * exist yet. If it does, this function just returns.
 * @static
 * @async
 * @param {string} mapName - The name of the reverse-map file
 * @param {string} entry - The entry to be written into the RV map if it does not already exist
 * there. It must already include the separator character.
 * @returns {Promise<FileCreationStatus>} The returned status is `CREATION_STATUS.NEW` when the
 * entry was added, and `CREATION_STATUS.EXISTS` when the entry already existed and the new one
 * would have been a duplicate.
 */
async function addEntryIfNew(mapName: string, entry: string): Promise<FileCreationStatus> {
    let mapContents = '';

    try {
        mapContents = await readUTF8TextFile(mapName, STORAGE.RMAPS);
    } catch (err) {
        if (err.name !== 'FileNotFoundError') {
            throw err;
        }
    }

    if (mapContents.includes(entry)) {
        return CREATION_STATUS.EXISTS;
    }

    // We ignore the result of the write operation because this function returns EXISTS not based
    // on if the file exists, but if the entry already exists.
    await appendUTF8SystemMapFile(entry, mapName, STORAGE.RMAPS);

    return CREATION_STATUS.NEW;
}

/**
 * Helper for `storeUnversionedObject()` and `storeVersionedObject()` that takes care of creating
 * ReverseMap entries for all "Reference[To(Id|Blob|Clob)]" objects in the object being stored.
 *
 * For each object that contains [ID] hash links, create or update a reverse map for each
 * referenced object pointing back from the referenced [ID] object to the referencing object.
 *
 * Why: We can easily find which objects we reference by looking at this object being written
 * right here, but when we want to know from an object which other objects reference it we would
 * have to look at every single object ever written and check if it references the object. So to
 * make that reverse lookup easier we maintain reverse maps for each file which are updated each
 * time it is referenced.
 * @static
 * @async
 * @param {OneObjectTypes} obj - The [ID] object that was just stored. It is
 * used to find all its references to other objects or ID objects. The referenced objects each
 * become the "from", the object becomes the "to".
 * @param {FileCreation} writeResult - Hash and creation status ("new", "exists"). When the object
 * is new we create a reverse map entry (back) to(!) this hash, from each of the references in
 * the object.
 * @returns {Promise<void>}
 */
export async function reverseMapUpdater(
    obj: Readonly<OneObjectTypes>,
    writeResult: FileCreation<OneObjectTypes>
): Promise<void> {
    if (writeResult.status === CREATION_STATUS.EXISTS) {
        // If the object already exists then so do the reverse map entries
        return;
    }

    const rvMapEnabledProps = enabledRvMapTypes.get(obj.$type$);

    if (rvMapEnabledProps === undefined) {
        // Reverse maps are not enabled for this ONE object type
        return;
    }

    const allLinks = determineChildrenWithMetadataSync(obj);

    await Promise.all(
        allLinks
            .filter(({path}) => {
                if (rvMapEnabledProps.has('*')) {
                    return true;
                }

                const pathElems = path.split('.');
                return [...rvMapEnabledProps].some(p => pathElems.includes(p));
            })
            .map(async ({hash}) => {
                const mapName = hash + '.Object.' + obj.$type$;

                // Yes - the return value is not used.
                await serializeWithType(
                    // It is sufficient to serialize only this operation, interference with versioned-object
                    // creation or retrieval does not matter. So we only guard against "lost writes": If
                    // there were two createReverseMapOrAppendEntry() calls one might load the file, then the
                    // other, then one writes the new file, then the other. We can also limit serialization
                    // to operations on one and the same map file.
                    'ReverseMap ' + mapName,
                    () => addEntryIfNew(mapName, writeResult.hash + '\n')
                );
            })
    );
}

/**
 * Helper for `storeIdObject()` that takes care of creating ReverseMap entries for all
 * "Reference[To(Id|Blob|Clob)]" objects in the id-object being stored.
 *
 * For each object that contains [ID] hash links, create or update a reverse map for each
 * referenced object pointing back from the referenced ID object to the referencing ID object.
 *
 * Why: We can easily find which objects we reference by looking at this object being written
 * right here, but when we want to know from an object which other objects reference it we would
 * have to look at every single object ever written and check if it references the object. So to
 * make that reverse lookup easier we maintain reverse maps for each file which are updated each
 * time it is referenced.
 * @static
 * @async
 * @param {(OneIdObjectTypes)} obj - The [ID] object that was just stored. It is
 * used to find all its references to other objects or ID objects. The referenced objects each
 * become the "from", the object becomes the "to".
 * @param {FileCreation} writeResult - Hash and creation status ("new", "exists"). When the object
 * is new we create a reverse map entry (back) to(!) this hash, from each of the references in
 * the object.
 * @returns {Promise<undefined>}
 */
export async function reverseMapUpdaterForIdObject(
    obj: Readonly<OneIdObjectTypes>,
    writeResult: IdFileCreation<OneVersionedObjectTypes | OneIdObjectTypes>
): Promise<void> {
    if (writeResult.status === CREATION_STATUS.EXISTS) {
        // If the object already exists then so do the reverse map entries
        return;
    }

    const rvMapEnabledProps = enabledRvMapTypesForIdObjects.get(obj.$type$);

    if (rvMapEnabledProps === undefined) {
        // Reverse maps are not enabled for this ONE object type
        return;
    }

    const allLinks = determineChildrenForIdObjectWithMetadataSync(obj);

    await Promise.all(
        allLinks
            .filter(({path}) => {
                if (rvMapEnabledProps.has('*')) {
                    return true;
                }

                const pathElems = path.split('.');
                return [...rvMapEnabledProps].some(p => pathElems.includes(p));
            })
            .map(async ({hash}) => {
                const mapName = hash + '.IdObject.' + obj.$type$;

                // Yes - the return value is not used.
                await serializeWithType(
                    // It is sufficient to serialize only this operation, interference with versioned-object
                    // creation or retrieval does not matter. So we only guard against "lost writes": If
                    // there were two createReverseMapOrAppendEntry() calls one might load the file, then the
                    // other, then one writes the new file, then the other. We can also limit serialization
                    // to operations on one and the same map file.
                    'ReverseMapId ' + mapName,
                    () => addEntryIfNew(mapName, writeResult.idHash + '\n')
                );
            })
    );
}
