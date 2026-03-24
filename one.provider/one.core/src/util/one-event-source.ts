/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2019
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Helper function that creates an object that can serve as an event source that is used in an
 * API-object property.
 *
 * Events are all over the place in Javascript, with several major themes:
 *
 * - Specific DOM on- event handlers (e.g. onopen, onerror, onclose, onmessage, onclick,...)<br>
 *   See {@link https://developer.mozilla.org/en-US/docs/Web/Guide/Events/Event_handlers}
 *
 * - Generalized DOM events (EventTarget: addEventListener, removeEventListener, dispatchEvent)<br>
 *   See {@link https://developer.mozilla.org/en-US/docs/Web/API/EventTarget}
 *
 * - Generalized node.js events (EventEmitter: on, once, emit, removeListener,... - a large API)<br>
 *   See {@link https://nodejs.org/dist/latest-v11.x/docs/api/events.html}
 *
 * We only need a very limited subset of those features. Nether things like event bubbling nor
 * lots of different API functions to subscribe and control events are necessary. The
 * specialized (exactly one per event type) "on-" event handlers, without event names (i.e. they
 * are implicitly named by the property they are made available under) comes closest, but is
 * *too* limited, since 1) it allows only one handler, 2) accidentally overwriting an existing
 * handler is possible, making some kinds of code errors harder to find.
 *
 * Instead, we use an event source that allows more than one event handler, but which does not use a
 * special `Event` class and has only a limited set of API functions. In addition, each event
 * source (object) will be responsible for exactly one kind of event only, just like the
 * specialized DOM "on-" event types.
 *
 * The goal is to expose an appropriately named event source object with methods to subscribe
 * and unsubscribe to events for that event. The method to emit events should not be available
 * on the event source object exposed as part of an API, but remain visible only to the code
 * hidden behind that API.
 *
 * @example
 *
 * function createSomethingAsynchronous () {
 *     // The two OneEventSource objects REMAIN PRIVATE
 *     const onDataEventSource = createEventSource();
 *     const onErrorEventSource = createEventSource();
 *
 *     // If this functionality is needed
 *     onDataEventSource.onListenerChange = (oldSize, newSize) => {
 *         // Start a process as soon as there is at least one listener
 *         // Stop a process if there is no listener
 *     };
 *
 *     function receiveAsynchronousResults(data, err) {
 *         if (err) {
 *             return onErrorEventSource.dispatch(err);
 *         }
 *
 *         onDataEventSource.dispatch(data);
 *     }
 *
 *     ...
 *     // Do something that periodically calls receiveAsynchronousResults()
 *     ...
 *
 *     // The two OneEventSourceConsumer objects ARE EXPORTED
 *     return {
 *         onData: onDataEventSource.consumer,
 *         onError: onErrorEventSource.consumer
 *     };
 * }
 *
 * const someObj = createSomethingAsynchronous();
 *
 * someObj.onData.addListener(data => processData(data));
 * someObj.onError.addListener(error => console.log(error));
 *
 * @module
 */

/**
 * Event handler callback functions
 * @global
 * @typedef {Function} EventHandlerCb
 * @param {T} data
 * @returns {(undefined|Promise<undefined>)}
 */
export type EventHandlerCb<T> = (param: T) => void | Promise<void>;

/**
 * Object with functions for the intended consumer of events.
 * This object is part of the {@link OneEventSource} object type created by the
 * {@link util/event-source.module:ts.createEventSource|`util/event-source.createEventSource`}
 * method.
 * @global
 * @typedef {object} OneEventSourceConsumer
 * @property {function(EventHandlerCb):function():void} OneEventSource.consumer.addListener - Add
 * an event handler function, unless this exact function is already subscribed, in which case an
 * error is thrown. The function returns a function that removes this listener function.
 * @property {function(EventHandlerCb):void} OneEventSource.consumer.removeListener - Remove an
 * event handler function, unless the given function is not subscribed, in which case an error
 * is thrown
 */
export interface OneEventSourceConsumer<T> {
    addListener: (cb: EventHandlerCb<T>) => () => void;
    removeListener: (cb: EventHandlerCb<T>) => void;
}

/**
 * Object type created by the
 * {@link util/event-source.module:ts.createEventSource|`util/event-source.createEventSource`}
 * method.
 * @global
 * @typedef {object} OneEventSource
 * @property {OneEventSourceConsumer} consumer - Object with functions for the intended consumer of
 * events. This object can be exposed on API-object property appropriately named to reflect the
 * event type, e.g. "onData", "onError".
 * @property {null|function(number,number,EventHandlerCb):void} onListenerChange - WRITABLE &mdash;
 * Default is `null`. Assign an event handler function that gets called every time a listener
 * function is added or removed. The event handler receives the old and the new number of
 * listeners as arguments, as well as the event handler function that was added or removed (in that
 * order).
 * @property {function(*):void} dispatch - A non-public function to send an event to all subscribed
 * listeners. Any arguments given to the function are given as-is to all event handler functions.
 * @property {function(*):Promise<Array<*>>} dispatchAsync - A non-public function to send an event
 * to all subscribed listeners and await and return the possibly Promise-based return values. Any
 * arguments given to the function are given as-is to all event handler functions.
 */
export interface OneEventSource<T> {
    consumer: OneEventSourceConsumer<T>;
    onListenerChange: null | ((oldCount: number, newCount: number, cb: EventHandlerCb<T>) => void);
    dispatch: (param: T) => void;
    dispatchAsync: (param: T) => Promise<unknown[]>;
}

import {createError} from '../errors.js';
import {isFunction} from './type-checks-basic.js';

/**
 * Creates an {@link OneEventSource} with an {@link OneEventSourceConsumer} object with public
 * methods for consumers of the event, and non-public methods for the code that is the source of
 * the events and is publishing the interface.
 * @static
 * @returns {OneEventSource} Returns an {@link OneEventSource} object
 */
export function createEventSource<T extends unknown = unknown>(): OneEventSource<T> {
    const listeners: Set<EventHandlerCb<T>> = new Set();

    function addListener(fn: EventHandlerCb<T>): () => void {
        if (listeners.has(fn)) {
            throw createError('EVS-CR1');
        }

        listeners.add(fn);

        if (isFunction(API.onListenerChange)) {
            API.onListenerChange(listeners.size - 1, listeners.size, fn);
        }

        return () => removeListener(fn);
    }

    function removeListener(fn: EventHandlerCb<T>): void {
        if (!listeners.has(fn)) {
            throw createError('EVS-CR2');
        }

        listeners.delete(fn);

        if (API.onListenerChange !== null) {
            API.onListenerChange(listeners.size + 1, listeners.size, fn);
        }
    }

    function dispatch(data: T): void {
        listeners.forEach(fn => fn(data));
    }

    async function dispatchAsync(data: T): Promise<unknown[]> {
        return await Promise.all([...listeners.values()].map(fn => fn(data)));
    }

    const API: OneEventSource<T> = {
        consumer: {
            addListener,
            removeListener
        },
        onListenerChange: null,
        dispatch,
        dispatchAsync
    };

    return API;
}
