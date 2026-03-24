/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * A simple singly linked list based queue implementation for arbitrary data. This utility
 * module can be used by anyone, there is nothing specific to ONE.core in it.
 * @module
 */

/**
 * A simple general queue implementation using a singly linked list which accepts any data, as long
 * as it is a single item. Note that none of the API functions need to be bound (they don't use
 * `this`).
 * See {@link util/queue.ts}
 * @template T
 * @typedef {object} SimpleQueue
 * @property {function(T):void} enqueue - `(T) => void` &mdash; Add to the head of the queue
 * @property {function(Array<T>):void} enqueueN - `(T[]) => void` &mdash; Add n values at once
 * @property {function():T} dequeue - `() => T` &mdash; Return the oldest entry and remove it
 * from the queue
 * @property {function(number):T[]} dequeueN - `(number) => T[]` &mdash; Return n queue items at
 * once
 * @property {function():number} size - `() => number` &mdash; Size of the queue
 * @property {function():boolean} isEmpty - `() => boolean` &mdash; `true` if the queue is empty,
 * `false` if not
 * @property {function():void} clear - `() => void` &mdash; Removes all elements from this queue
 */
export interface SimpleQueue<T> {
    enqueue: (item: T) => void;
    enqueueN: (items: readonly T[]) => void;
    dequeue: () => T;
    dequeueN: (count: number) => T[];
    size: () => number;
    isEmpty: () => boolean;
    clear: () => void;
}

/**
 * @private
 * @typedef {object} QueueItem
 * @property {null|QueueItem} next - Points to the next more recent queue entry
 * @property {*} data - The data put into the queue
 */
interface QueueItem<T> {
    next: null | QueueItem<T>;
    data: T;
}

/*
    CODING STYLE COMMENT

    If one tries to make this slightly more "functional", e.g. by splitting the "enqueue()"
    into different mini-functions for inserting the very first item vs. the normal case, or
    changing the if-conditions to use "count" instead of checking "first" or "last" for null, one
    quickly starts finding limitations of the current static type system(s).
    This tiny module is a good example for the trade-offs of those 3rd party type systems. The
    code has to fit the type system instead of the other way around, or you start spending much
    more time on the types than on the actual code.

    Alternative enqueue implementation as example:

    const enqueueFirstItem = (item: QueueItem<T>): void => {
        first = item;
        last = item;
    };

    const enqueueNthItem = (item: QueueItem<T>): void => {
        first.next = item;
        first = item;
    };

    const enqueue = (data: T): void => {
        (count === 0 ? enqueueFirstItem : enqueueNthItem)({
            next: null,
            data
        });

        count += 1;
    };
*/

import {createError} from '../errors.js';

/**
 * Creates a queue instance that uses a singly linked list
 * @static
 * @returns {SimpleQueue} Returns an API-object for a simple queue
 */
export function createSimpleQueue<T>(): SimpleQueue<T> {
    let first: null | QueueItem<T> = null;
    let last: null | QueueItem<T> = null;
    let count = 0;

    // Add at the head
    function enqueue(data: T): void {
        const newItem: QueueItem<T> = {
            next: null,
            data
        };

        if (first === null) {
            first = newItem;
            last = newItem;
        } else {
            first.next = newItem;
            first = newItem;
        }

        count += 1;
    }

    function enqueueN(data: readonly T[]): void {
        data.forEach(enqueue);
    }

    // Remove from the tail
    function dequeue(): T {
        if (last === null) {
            throw createError('UQ-DEQ');
        }

        const data = last.data;

        if (first === last) {
            first = null;
            last = null;
        } else {
            // the next youngest
            last = last.next;
        }

        count -= 1;

        return data;
    }

    // Return n queue items at once, the oldest queue entry at array index 0
    function dequeueN(n: number): T[] {
        if (n > count) {
            throw createError('UQ-DEQN');
        }

        return new Array(n).fill(null).map(_ => dequeue());
    }

    function clear(): void {
        first = null;
        last = null;
        count = 0;
    }

    return {
        enqueue,
        enqueueN,
        dequeue,
        dequeueN,
        size: () => count,
        isEmpty: () => count === 0,
        clear
    };
}
