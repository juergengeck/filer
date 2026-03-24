/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * When working with versioned objects ONE frequently requires an object's ID hash, for example
 * to access the version map or the reverse map(s) for the given object.
 *
 * We used to pass ID hashes through from object creation to object use and also store them in
 * {@link Reference|Reference} objects when the reference pointed to a versioned object.
 * Because we decided to remove the ID hash from all references unless they are (pure) ID
 * references, the ID hash is frequently missing in many places where it is needed.
 *
 * Instead of having a mix of passing it through and calculating it on demand we introduce a
 * central place where ID hashes are cached. We replace determinism - but more complicated code
 * and inconsistent and confusing Reference objects (the presence of an ID hash in versioned
 * object references invites misuse as an ID reference) - with a simpler and more consistent
 * programming model that now is more probabilistic. If an ID hash is not found in the cache it
 * will have to be calculated, which additionally requires storage access to first read object
 * microdata. How well the compromise works is very use case (application) specific: The size of
 * the LRU cache and the (plain) LRU algorithm should usually do well enough but may have to be
 * adjusted for some use cases. ALso see {@link LruMapObj}, which is the collection used for the
 * cache internally.
 *
 * The cache mostly fills itself by being queried, but we also export the `set(hash, idHash)`
 * method so that anywhere in the code - ONE core or the application - that already calculates
 * an ID hash for a given hash can put it into the cache too. This is useful when objects are
 * used after they are created, for example by creating references to them. When the referencing
 * object is written it will require the ID hash for any referenced versioned object in order to
 * write the reverse map (pointing back up the graph or tree from referenced object to the
 * referencing object).
 * @private
 * @module
 */

import {calculateIdHashForStoredObj} from './microdata-to-id-hash.js';
import type {
    BLOB,
    CLOB,
    HashTypes,
    OneUnversionedObjectTypes,
    OneVersionedObjectTypes
} from './recipes.js';
import type {LruMapObj} from './util/lru-map.js';
import {createLruMap} from './util/lru-map.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';

const ID_HASH_CACHE_MAX_SIZE = 500;

/**
 * The value includes `null` so that hashes of unversioned objects can also be keys. We cannot
 * use `undefined` since that would be in conflict with the `undefined` returned for "no entry".
 * @private
 * @static
 * @type {LruMapObj<SHA256Hash, null|SHA256IdHash>}
 */
const idHashCache: LruMapObj<SHA256Hash<any>, null | SHA256IdHash> = createLruMap(
    ID_HASH_CACHE_MAX_SIZE
);

/**
 * Add an ID hash to the ID hash cache (LRU).
 *
 * This function is called by storage-versioned-objects' function storeVersionedObject() and by
 * storage-unversioned-objects' function storeUnversionedObject() (the latter to fill the cache
 * with negatives, i.e. "no ID hash for this hash", too).
 * @static
 * @param {SHA256Hash} hash
 * @param {(null|SHA256IdHash)} idHash
 * @returns {undefined}
 */
export function setIdHash(hash: SHA256Hash<any>, idHash: null | SHA256IdHash): void {
    idHashCache.set(hash, idHash);
}

export async function getIdHash<T extends OneVersionedObjectTypes>(
    hash: SHA256Hash<T>
): Promise<SHA256IdHash<T>>;
export async function getIdHash<T extends OneUnversionedObjectTypes | BLOB | CLOB>(
    hash: SHA256Hash<T>
): Promise<undefined>;
export async function getIdHash<T extends HashTypes>(hash: SHA256Hash<T>): Promise<undefined>;

/**
 * Get an ID hash either from the (LRU) ID hash cache, or calculate it and in addition to
 * returning it also store it in the ID hash cache. If the ID hash has to be calculated the
 * microdata of the given object is loaded, the ID properties are extracted directly from this
 * string, and the SHA-256 of the ID object microdata is calculated.
 * @static
 * @async
 * @param {SHA256Hash} hash - Hash of a ONE object
 * @returns {Promise<undefined | SHA256IdHash>} Returns undefined if the hash points to an
 * unversioned object, or the SHA-256 of the ID object of the object identified by the given
 * hash if it is a versioned object.
 */
export async function getIdHash<T extends HashTypes>(
    hash: SHA256Hash<T>
): Promise<T extends OneVersionedObjectTypes ? SHA256IdHash<T> : undefined> {
    const cachedIdHash = idHashCache.get(hash);

    if (cachedIdHash !== undefined) {
        // null is the cached value for unversioned object hashes
        return (
            cachedIdHash === null ? undefined : cachedIdHash
        ) as T extends OneVersionedObjectTypes ? SHA256IdHash<T> : undefined;
    }

    const idHash = await calculateIdHashForStoredObj(hash as SHA256Hash<any>);
    idHashCache.set(hash, idHash === undefined ? null : idHash);

    return idHash as T extends OneVersionedObjectTypes ? SHA256IdHash<T> : undefined;
}
