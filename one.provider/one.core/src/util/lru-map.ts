/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A simple and generic LRU map implementation. ONE.core uses it for an internal ID hash cache.
 * This utility module can be used by anyone, there is nothing specific to ONE in it.
 * @module
 */

import {createError} from '../errors.js';
import {isInteger} from './type-checks-basic.js';

/**
 * Implementation of an LRU collection with a given maximum size. Internally it uses a `Map`
 * object and uses the fact that that object's iterator uses insertion order. Each time a key is
 * accessed - get or set - it is removed and reinserted. That means that at the beginning of the
 * Map iterator there will always be the least recently used item.
 * See {@link util/lru-map.module:ts|util/lru-map}
 * @global
 * @template K, V
 * @typedef {object} LruMapObj
 * @property {function(*):Iterator} $Iterator - The iterator `[Symbol.iterator]` of the
 * underlying `Map` object so that this object can be used e.g. in a `for...of` loop. The
 * iterator is obtained by calling `entries()` on the underlying `Map` object.
 * @property {function(K):void} get - `(K) => void | V>`
 * @property {function(K,V):void} set - `(K, V) => void`
 * @property {function():void} clear - `() => void`
 */
export interface LruMapObj<K, V> {
    [Symbol.iterator](): IterableIterator<[K, V]>;
    get: (key: K) => void | V;
    set: (key: K, value: V) => void;
    clear: () => void;
}

/**
 * Creates an LRU collection with a given maximum size.
 * Also see {@link LruMapObj}
 * @static
 * @param {number} maxSize - The maximum size of the LRU collection
 * @returns {LruMapObj} Returns an LRU-Map object
 */
export function createLruMap<K, V>(maxSize: number): LruMapObj<K, V> {
    if (!isInteger(maxSize) || maxSize < 2) {
        throw createError('ULRU-CRM1', {maxSize, type: typeof maxSize});
    }

    const collection: Map<K, V> = new Map();

    function get(key: K): void | V {
        const entry: undefined | V = collection.get(key);

        if (entry !== undefined) {
            collection.delete(key);
            collection.set(key, entry);
        }

        return entry;
    }

    function set(key: K, value: V): void {
        if (collection.has(key)) {
            // Refresh this entry. This also ensures that if the collection is full no other
            // entry is removed.
            collection.delete(key);
        } else if (collection.size >= maxSize) {
            // Since we always reinsert upon use (get or set), and since the Map iterator uses
            // insertion order, the first item it returns will be the least recently used one.
            const firstKey = collection.keys().next().value;

            if (firstKey !== undefined) {
                collection.delete(firstKey);
            }
        }

        collection.set(key, value);
    }

    function clear(): void {
        collection.clear();
    }

    return {
        [Symbol.iterator](): IterableIterator<[K, V]> {
            return collection.entries();
        },
        get,
        set,
        clear
    };
}
