/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Create Access or IdAccess objects giving Chum-sync access for a Person or a group to that
 * object or ID object (all versions).
 * @module
 */

/**
 * An `enum` to be used when calling the {@link access.module:ts} `access` module to set access
 * rights and create {@link IdAccess} or {@link Access} ONE objects.
 * @global
 * @typedef {('replace'|'add')} SetAccessMode
 */
export type SetAccessMode = (typeof SET_ACCESS_MODE)[keyof typeof SET_ACCESS_MODE];

/**
 * An array of `SetAccessParam` objects is expected by the {@link access.module:ts|"Lib/access"}
 * module.
 * @global
 * @typedef {object} SetAccessParam
 * @property {Reference} [object] - A reference to the unversioned or versioned object for which
 * access rights are set
 * @property {SHA256IdHash} [id] - An ID reference to the ID object of a versioned object for
 * which access rights are set *for all current and future versions*
 * @property {('replace'|'add')} mode - If there already is an Access object, add to its list of
 * grant hashes or ignore its contents and let the new Access object exclusively use the data
 * from this new set-access request? The parameter is *mandatory* to force developers to add
 * this piece of information each time access is set. This is to prevent errors when the code
 * makes an assumption but during runtime the actual behavior depends on if there is a previous
 * Access object or not.
 * @property {SHA256IdHash[]} person - An array of references to Person ID objects to whom
 * access is granted. All versions of A reference Person ID object are granted access - versions
 * in space (Person) vs. versions in time (Group) access.
 * @property {SHA256IdHash[]} group - An array of references to  Group ID objects to whom
 * access is granted. Only the latest version (at the time of actual access attempt) is granted
 * access - versions in space (Person) vs. versions in time (Group) access.
 */
export interface SetAccessParam {
    object?: SHA256Hash;
    id?: SHA256IdHash;
    person: Array<SHA256IdHash<Person>>;
    group: Array<SHA256IdHash<Group>>;
    mode: SetAccessMode;
}

import {createError} from './errors.js';
import type {Access, Group, IdAccess, Person} from './recipes.js';
import {SET_ACCESS_MODE} from './storage-base-common.js';
import type {VersionedObjectResult} from './storage-versioned-objects.js';
import {getObjectByIdObj, storeVersionedObject} from './storage-versioned-objects.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import {isHash} from './util/type-checks.js';

/**
 * @private
 * @param {SetAccessParam} accessRequest
 * @returns {boolean} Returns `true` if the given object is a {@link SetAccessParam} object
 * @throws {Error} If there are missing oir conflicting parameters an `Error` is thrown
 */
function isSetAccessParam(accessRequest: SetAccessParam): accessRequest is SetAccessParam {
    if (
        accessRequest.mode !== SET_ACCESS_MODE.ADD &&
        accessRequest.mode !== SET_ACCESS_MODE.REPLACE
    ) {
        return false;
    }

    if (accessRequest.object === undefined && accessRequest.id === undefined) {
        return false;
    }

    if (accessRequest.object !== undefined && accessRequest.id !== undefined) {
        return false;
    }

    if (accessRequest.object !== undefined && !isHash(accessRequest.object)) {
        return false;
    }

    if (accessRequest.id !== undefined && !isHash(accessRequest.id)) {
        return false;
    }

    // NOTE: An empty array is allowed! This creates an Access object without any grants, which
    // revokes any grants set in the previous version of the Access object. We place no
    // restriction on the `mode`, so it is possible to use mode="add" and an empty array to
    // create a new Access object that is exactly the same as the last one. Whether this writes
    // anything to storage - it would only affect the version map - depends on the version map
    // policy (`storeVersionedObject` parameter).

    if (
        accessRequest.person !== undefined &&
        (!Array.isArray(accessRequest.person) || !accessRequest.person.every(item => isHash(item)))
    ) {
        return false;
    }

    // noinspection RedundantIfStatementJS
    if (
        accessRequest.group !== undefined &&
        (!Array.isArray(accessRequest.group) || !accessRequest.group.every(item => isHash(item)))
    ) {
        return false;
    }

    return true;
}

/**
 * The function creates an Access object or an IdAccess object
 * @private
 * @param {SetAccessParam} accessRequest
 * @returns {Promise<VersionedObjectResult>}
 * @throws {Error} If there are missing oir conflicting parameters an `Error` is thrown
 */
async function setAccessForOneObject(
    accessRequest: SetAccessParam
): Promise<VersionedObjectResult<Access | IdAccess>> {
    if (!isSetAccessParam(accessRequest)) {
        throw createError('ACC-CP1', {accessRequest});
    }

    const accessObj =
        accessRequest.id === undefined
            ? ({
                  $type$: 'Access',
                  object: accessRequest.object,
                  person: accessRequest.person ?? [],
                  group: accessRequest.group ?? []
              } as Access)
            : ({
                  $type$: 'IdAccess',
                  id: accessRequest.id,
                  person: [...new Set(accessRequest.person ?? [])],
                  group: [...new Set(accessRequest.group ?? [])]
              } as IdAccess);

    // REPLACE or ADD
    if (accessRequest.mode === SET_ACCESS_MODE.ADD) {
        try {
            const {obj: previousAccessObj} = await getObjectByIdObj(accessObj);

            accessObj.person.push(...previousAccessObj.person);
            accessObj.group.push(...previousAccessObj.group);
        } catch (err) {
            // "File not found" is okay, there may not be a previous version
            if (err.name !== 'FileNotFoundError') {
                throw err;
            }
        }
    }

    return await storeVersionedObject({
        ...accessObj,
        person: [...new Set(accessObj.person)],
        group: [...new Set(accessObj.group)]
    });
}

/**
 * Create one Access object for a given versioned ONE object.  Access objects have "references"
 * and not just a simple SHA-256 hash for linkage to the target object because objects should be
 * linked through reference links, but more importantly, only Reference object links trigger the
 * writing of reverse maps, which makes it possible to start from a given Person and find all
 * Access objects that reference it. For any given versioned object find all Access objects
 * referencing it (granting access to someone).
 * If the `person` or `group` array is empty an Access object without grants is created if no
 * previous Access object existed for the given object. If there already is one and `mode` is
 * `mode` is "add" (constant `Storage.SET_ACCESS_MODE.ADD`) only a new version map entry is
 * created, if `mode` is "replace" a new most current Access object version is created without
 * grants, thereby revoking any access rights that may previously have existed.
 *
 * @example
 *
 * // Set access right for two objects (Array of two SetAccessParam objects)
 * // Result: Array with two VersionedObjectResult<Access> objects
 * const access: ObjectCreation = await createAccess([
 *     {
 *         object: objectHash,
 *         person: [personIdHash, anotherPersonIdHash],
 *         group: [],
 *         mode: Storage.SET_ACCESS_MODE.ADD
 *     },
 *     {
 *         object: objectHash,
 *         person: personIdHash,
 *         group: [],
 *         mode: Storage.SET_ACCESS_MODE.REPLACE
 *     }
 * ]);
 *
 * @static
 * @async
 * @param {SetAccessParam[]} accessRequests - An array of object/person-references Reference
 * objects. For each object access rights are created for the corresponding Person objects.
 * @returns {Promise<VersionedObjectResult[]>} Returns the result of writing the Access
 * object.
 */
export async function createAccess(
    accessRequests: SetAccessParam[]
): Promise<Array<VersionedObjectResult<Access | IdAccess>>> {
    return await Promise.all(
        accessRequests.map(
            (accessRequest: SetAccessParam): Promise<VersionedObjectResult<Access | IdAccess>> =>
                setAccessForOneObject(accessRequest)
        )
    );
}
