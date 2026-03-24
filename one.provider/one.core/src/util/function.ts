/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Various utility functions, some of them, e.g. `flat()` or `memoize()`, generic and not ONE
 * specific, so that they could be used for other purposes too.
 * @module
 */

/**
 * The generic type "Function" was deprecated, but having a simple word is much more
 * readable than the complex syntax that is supposed to be used instead. That is why we
 * create our own alias name.
 * @private
 * @typedef {Function} AnyFunction
 */
export type AnyFunction = (...args: any[]) => any;

/**
 * The same as {@link AnyFunction} but the function must return a promise.
 * @private
 * @typedef {Function} AnyAsyncFunction
 * @returns {Promise<*>} Returns a promise
 */
export type AnyAsyncFunction = (...args: any[]) => Promise<any>;

/**
 * The function returned by calling the {@link NeverFailAsyncErrorWrapper} function returned by
 * {@link util/function.module:ts.createNeverFailAsyncErrorWrapper|`util/function.createNeverFailAsyncErrorWrapper`}. For an in-depth explanation see
 * {@link util/function.module:ts.createNeverFailAsyncErrorWrapper|`util/function.createNeverFailAsyncErrorWrapper`}
 * @global
 * @typedef {Function} NeverFailAsyncErrorWrappedFn
 * @returns {Promise<undefined>} Returns a promise that always resolves with `undefined` and
 * *never rejects*.
 */
export type NeverFailAsyncErrorWrappedFn<F extends AnyAsyncFunction> = (
    ...args: Parameters<F>
) => Promise<void>;

/**
 * The function returned by
 * {@link function.module:ts.createNeverFailAsyncErrorWrapper|`util/function.createNeverFailAsyncErrorWrapper`} For an in-depth explanation see
 * {@link function.module:ts.createNeverFailAsyncErrorWrapper|`util/function.createNeverFailAsyncErrorWrapper`}
 * @global
 * @typedef {Function} NeverFailAsyncErrorWrapper
 * @param {Function} fn
 * @returns {NeverFailAsyncErrorWrappedFn} Returns a {@link NeverFailAsyncErrorWrappedFn} function
 * that takes a function and wraps it
 */
export type NeverFailAsyncErrorWrapper = <F extends AnyAsyncFunction>(
    fn: F
) => NeverFailAsyncErrorWrappedFn<F>;

/**
 * The function returned by calling the {@link RethrowingAsyncErrorWrapper} function returned by
 * {@link function.module:ts.createRethrowingAsyncErrorWrapper|`util/function.createRethrowingAsyncErrorWrapper`}. For an in-depth explanation see
 * {@link function.module:ts.createRethrowingAsyncErrorWrapper|`util/function.createRethrowingAsyncErrorWrapper`}
 * @global
 * @typedef {Function} RethrowingAsyncErrorWrappedFn
 * @returns {Promise<*>} Returns a promise that resolves either with the return value of the
 * wrapped function, or it resolves with `undefined` if an error was thrown.
 */
export type RethrowingAsyncErrorWrappedFn<F extends AnyFunction> = (
    ...args: Parameters<F>
) => Promise<ReturnType<F>>;

/**
 * The function returned by
 * {@link function.module:ts.createRethrowingAsyncErrorWrapper|`util/function.createRethrowingAsyncErrorWrapper`} For an in-depth explanation see
 * {@link function.module:ts.createRethrowingAsyncErrorWrapper|`util/function.createRethrowingAsyncErrorWrapper`}
 * @global
 * @typedef {Function} RethrowingAsyncErrorWrapper
 * @param {Function} fn
 * @returns {RethrowingAsyncErrorWrappedFn} Returns a {@link RethrowingAsyncErrorWrappedFn}
 * function that takes a function and wraps it
 */
export type RethrowingAsyncErrorWrapper = <F extends AnyFunction>(
    fn: F
) => RethrowingAsyncErrorWrappedFn<F>;

/**
 * An API-object interface to a `Map<K, V[]>` object created by
 * {@link util/function.module:ts.createArrayValueMap|`util/function.createArrayValueMap`} (also
 * see the description there) whose values are arrays of values of type `<V>`. Provides a
 * function to add values to the array identified by a given key.
 * The purpose is to serve as an accumulator of values under a set of keys, with 1...n values
 * per key (0 values means no entry, i.e. no key, there is no key with no value).
 * @global
 * @template K,V
 * @typedef {object} ArrayValueMap
 * @property {Map<K,Array<V>>} mapObj - The underlying Map object exposed - the `ArrayValueMap` is
 * not meant to be an encapsulating abstraction but a convenience function layer providing two
 * additional functions for `Map` objects
 * @property {function(K,V):void} add - Add a new value for a given key. If there is no entry in the
 * `Map` for this key yet, a new Array with the new value in it is created for the key. If there
 * already is an entry - which is an Array - the value is added to it.
 * @property {function(function(K,V):U):Map<K,U>} map - A function of type `<U> (fn: (K, V[]) => U):
 * Map<K, U>` that creates a `Map` object with the same keys by applying the given callback
 * function to each value in the map. The callback function receives the key and the array of
 * values as arguments. The key and the value returned by the callback are used to build the new
 * `Map` object (not wrapped as `ArrayValueMap`, just the plain `Map`).
 * @property {function(function(*,*):Promise<*>):Promise<Map>} mapAsync - Same as the `map`
 * function but for callback functions that return a promise. The new (plain) `Map` object is
 * available through the returned promise.
 */
export interface ArrayValueMap<K, V> {
    mapObj: Map<K, V[]>;
    add: (a: K, b: V) => void;
    map: <U>(fn: (a: K, b: V[]) => U) => Map<K, U>;
    mapAsync: <U>(fn: (a: K, b: V[]) => Promise<U>) => Promise<Map<K, U>>;
}

/**
 * Function helper
 * {@link util/function.module:ts.throttleWithFixedDelay|`util/function.throttleWithFixedDelay`}
 * returns a function to cancel a timer and prevent queued delayed execution of a throttled
 * function, and the throttled function wrapper function itself.
 * @global
 * @typedef {object} ThrottledFunction
 * @property {function():void} cancel - Cancel any active timers that will run the throttled
 * function.
 * @property {function():void} throttled - The original function wrapped into a throttled function.
 */
export interface ThrottledFunction {
    cancel: () => void;
    throttled: () => void;
}

import type {ErrorWithCode} from '../errors.js';
import {isFunction} from './type-checks-basic.js';

/**
 * This function creates an asynchronous wrapper (function) that catches exceptions thrown by the
 * function and reports them through a callback function. Optionally it rethrows the intercepted
 * exception.
 *
 * ### Two different use cases
 *
 * 1. A t-pipe (like
 *    {@link https://en.wikipedia.org/wiki/Tee_(command)|the "tee" Unix command})
 *    where we intercept the exception to send it to a 3rd party that otherwise would not see the
 *    error through a callback function, but then rethrow the exception so that the function's
 *    parent (caller) does not notice the interception.
 *
 * 2. Functions that run decoupled from the code that were started through `setTimeout`, for
 *    example. They have no parent, if they throw the exception would immediately end up with
 *    the runtime. The wrapper catches the exception and redirects the error object to a callback.
 *
 * ### Explanation
 *
 * The structure of this function is a function that returns a function that returns a function:
 *
 * ```javascript
 * ((Error) => void, ?boolean) => (Function) => (...args: any[]) => any
 * ```
 *
 * The first function takes a callback to be invoked each time there is an error, which receives
 * the `Error` object as its single argument.
 *
 * 1. The second function receives the function that should be wrapped.
 *
 * 2. The first function is the wrapped function, which is used in place of the original function.
 *
 * 3. Those three steps are potentially located in very different places/modules.
 *
 * Functions returning functions are a method to cross-connect different places in modules
 * independent of their lexical hierarchy. Imagine a traveler wandering to different places,
 * collecting data and learning new methods, and at the end, after coming back home, putting it
 * all together, using the new methods learned on the journey and the information collected in
 * the many places they visited to create something new in the final location.
 *
 * Our scenario is that you have one error callback function to collect errors from several
 * functions that you don't invoke but that you control. For example, our chum-exporter service
 * functions are even invoked from an external 3rd party, but the exporter as the "manager" of
 * the "employees" (the service functions) should be informed, not the "customer" who placed
 * an order, i.e. the remote instance.
 *
 * That single callback is used to collect errors from several functions, and each of the
 * functions are expected to be called many times.
 *
 * Our scenario would look like this:
 *
 * 1. ONE TIME: The onError callback is provided (you get a new function for step 2). Since this
 *    step is performed only once you get one partially applied function back that can now be
 *    used for all service functions.
 *
 *    ```javascript
 *    // Create a wrapper and an error callback function one time
 *    const errorWrapper = FunctionUtils.createNeverFailAsyncErrorWrapper(
 *        error => console.log(error)
 *    );
 *    ```
 *
 * 2. MANY TIMES: You can use the error wrapper function created in step 1. many times, for as
 *    many functions as you like. The function that is to be watched for errors is provided as
 *    the single argument for the 2nd step. This yields a wrapped function that functions just
 *    like an unwrapped one, except that errors are sent to the `onError` function provided in
 *    step 1., after which they are rethrown if `rethrow` was set to `true`.
 *
 *    ```javascript
 *    // Apply the wrapper to many functions
 *    const wrappedFunction1 = errorWrapper(myFunction1);
 *    const wrappedFunction2 = errorWrapper(myFunction2);
 *    ```
 *
 * 3. MANY, MANY(!) TIMES: The respective wrapped function is called many times (in our
 *    chum-exporter service function example, to respond to requests by the remote instance,
 *    e.g. to send a file). Only if there is an error does the presence of the wrapper around the
 *    original function have any impact.
 *
 *    ```javascript
 *    // Use the wrapped functions many, many times
 *    myArray1.map(val => wrappedFunction1(val));
 *    ...
 *    const someResult1 = wrappedFunction2(...arguments1);
 *    const someResult2 = wrappedFunction2(...arguments2);
 *    ```
 *
 * ### Example of usage in One
 *
 * Module {@link chum-exporter.ts|chum-exporter's} service functions provided to a remote
 * instance through a websocket-promisifier controlled connection. The caller of the function is
 * the websocket-promisifier, which when it gets a rejected promise returns a generic error message
 * to the remote instance. We create a T-pipe like mechanism to also send the error to the main
 * exporter function's promise, which in turn is used to inform the overall Chum parent module
 * that a service requested by the remote instance had a problem.
 *
 * @static
 * @function
 * @param {function(Error):void} onError - Callback function to receive the error object
 * @returns {NeverFailAsyncErrorWrapper} Returns a {@link NeverFailAsyncErrorWrapper} function
 * that takes a function as argument, which is then wrapped by a try/catch and returns a
 * {@link NeverFailAsyncErrorWrappedFn} function. The wrapped function returns the return value of
 * the function it wraps **or `undefined`** in case of an error, unless `rethrow` is `true`.
 */
export function createNeverFailAsyncErrorWrapper(
    onError: (err: Error) => void
): NeverFailAsyncErrorWrapper {
    return function neverFailAsyncErrorWrapper<F extends AnyAsyncFunction>(
        fn: F
    ): NeverFailAsyncErrorWrappedFn<F> {
        return async function neverFailAsyncErrorWrappedFunc(
            ...args: Parameters<F>
        ): Promise<void> {
            try {
                await fn(...args);
            } catch (err) {
                onError(err);
            }
        };
    };
}

/**
 * This function is *almost* the same as {@link createNeverFailAsyncErrorWrapper} --
 * but the vital difference is that this wrapper 1) rethrows the error and 2) on success returns
 * the value returned by the wrapped function, instead of always returning `undefined` no matter
 * what.
 *
 * This version of the error wrapper is meant for scenarios where the error handling and the
 * invocation belong to different scopes. An example is the chum-exporter: It's service
 * functions are invoked by the websocket-promisifier reacting to network requests, but exceptions
 * should be handled in the context of the chum-exporter. The calling modules still wants to
 * receive all the values, and at least know if there is an exception to inform the remote
 * instance, even if it does not do any error handling for it.
 * @static
 * @function
 * @param {function(Error):void} onError - Callback function to receive the error object
 * @returns {RethrowingAsyncErrorWrapper} Returns a {@link RethrowingAsyncErrorWrapper} function
 * that takes a function as argument, which is then wrapped by a try/catch and returns a
 * {@link NeverFailAsyncErrorWrappedFn} function. The wrapped function returns the return value of
 * the function it wraps **or `undefined`** in case of an error, unless `rethrow` is `true`.
 */
export function createRethrowingAsyncErrorWrapper(
    onError: (err: ErrorWithCode) => void
): RethrowingAsyncErrorWrapper {
    return function rethrowingAsyncErrorWrapper<F extends AnyFunction>(
        fn: F
    ): RethrowingAsyncErrorWrappedFn<F> {
        return async function rethrowingAsyncErrorWrappedFunc(
            ...args: Parameters<F>
        ): Promise<ReturnType<F>> {
            try {
                return await fn(...args);
            } catch (err) {
                onError(err);
                throw err;
            }
        };
    };
}

/**
 * Convenience wrapper for "accumulator Map objects" where new entries are added per each key
 * into an array to accumulate the entries for that key. Since this is only for conveniently
 * adding entries the underlying Map object is fully exposed and only an "add" method is
 * supplied to be used instead of the one on the `Map` object itself. It also provides a "`map`"
 * function that creates a new `Map` object by applying a given callback function to each array
 * value. This can be used to condense the array to a single value, for example.
 * @static
 * @param {Map<*,Array<*>>} [mapObj] - An existing `Map` object can be provided, if not a new one
 * is created
 * @returns {ArrayValueMap} Returns an {@link ArrayValueMap} API-object
 */
export function createArrayValueMap<K, V>(mapObj: Map<K, V[]> = new Map()): ArrayValueMap<K, V> {
    /**
     * @see {@link ArrayValueMap}
     * @param {*} itemprop
     * @param {*} newValue
     * @returns {undefined}
     */
    function add(itemprop: K, newValue: V): void {
        const arrayOfValues = mapObj.get(itemprop);

        if (arrayOfValues === undefined) {
            mapObj.set(itemprop, [newValue]);
        } else {
            arrayOfValues.push(newValue);
        }
    }

    /**
     * @see {@link ArrayValueMap}
     * @template U, K, V
     * @param {function(K,Array<V>):U} fn
     * @returns {Map<K,U>}
     */
    function map<U>(fn: (key: K, value: V[]) => U): Map<K, U> {
        return new Map(Array.from(mapObj).map(([key, values]): [K, U] => [key, fn(key, values)]));
    }

    /**
     * @see {@link ArrayValueMap}
     * @template U,K,V
     * @param {function(K,Array<V>):Promise<U>} fn
     * @returns {Promise<Map<K,U>>}
     */
    async function mapAsync<U>(fn: (key: K, value: V[]) => Promise<U>): Promise<Map<K, U>> {
        return new Map(
            await Promise.all(
                Array.from(mapObj).map(
                    async ([key, values]): Promise<[K, U]> => [key, await fn(key, values)]
                )
            )
        );
    }

    return {
        mapObj,
        add,
        map,
        mapAsync
    };
}

/**
 * Common methods to flatten an array in Javascript are
 * - arr.reduce((accumulator, currentValue) => accumulator.concat(currentValue), [])
 * - Array.prototype.concat.apply([], arr)
 * - for-loop and arr.push()
 * - Combination of the above with spread operator
 *
 * We have found that for small arrays Array.prototype.concat.apply is the fastest, but it fails
 * on large arrays with "RangeError: Maximum call stack size exceeded". This loop is only
 * slightly slower but won't fail for large arrays. push(...arr) worked even for very large
 * arrays. Using concat() would create a new array and is exactly what we want to avoid (even
 * though inside the JS runtime engine a new array may very well have to be allocated if the
 * reserved space is exhausted, still, this was faster in our tests).
 * @private
 * @param {Array<*>} arr
 * @param {number} depth
 * @param {number} [currentDepth=0]
 * @returns {Array<*>}
 */
function flatten<T>(arr: ReadonlyArray<T[] | T>, depth: number, currentDepth: number = 0): T[] {
    const result: T[] = [];

    for (const value of arr) {
        if (Array.isArray(value) && currentDepth < depth) {
            result.push(...flatten(value, depth, currentDepth + 1));
        } else {
            // The types are not quite exact when we get here and "value" is an T[] because of
            // the depth iteration restriction. We ignore this problem for typing.
            result.push(value as T);
        }
    }

    return result;
}

/**
 * Flatten an array that contains values and arrays. Default behavior is to flatten a single
 * level deep.
 * @static
 * @param {Array<*>} arr - The array to be flattened remains unchanged
 * @param {number} [depth=1]
 * @returns {Array<*>} Returns a new array that is the flattened version of the input array
 */
export function flat<T>(arr: ReadonlyArray<T[] | T>, depth: number = 1): T[] {
    // https://tc39.github.io/proposal-flatMap/
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/flat
    if (isFunction(Array.prototype.flat)) {
        return arr.flat(depth) as T[];
    }

    // Fastest but does not work for very large arrays, and it becomes slow when used over and
    // over recursively because it creates a new array each time, so we use it only for the special
    // (but most common) case. In tests in Chrome, node.js, Firefox and IE 100,000 elements
    // could still be handled but a common limit of earlier versions was 65535 elements.
    // The maximum size varies greatly between JS engines, this should be a safe upper limit for
    // the "happy path".
    // Also see https://stackoverflow.com/a/11211669/544779 and
    // https://stackoverflow.com/q/22747068/544779
    if (arr.length < 65535 && depth === 1) {
        return Array.prototype.concat.apply([], arr as any);
    }

    return flatten(arr, depth);
}

// HACK: I could not get TypeScript to accept arguments of different types. It would infer what
// it thinks is the final type from the type of the first argument and then raise an error when
// another item in the array parameter list had a different type. Here we allow TypeScript to
// create a union for up to 6 different parameters with different types.
/*
 * Spreading into a new array using `[...arr1, ...ar2]` syntax still is unreliable. Example:
 * {@link https://github.com/Moddable-OpenSource/moddable/issues/140}
 * In addition, unlike spread syntax this function allows individual values and `undefined`. The
 * latter is filtered out when it is a direct argument, if it is a value in one of the given
 * arrays it will be included in the result array.
 * The function returns a new array.
 */
export function concatArrays<T>(...array: T[][]): T[];
export function concatArrays<T>(array1: T[] | T | undefined | void | null): T[];
export function concatArrays<T1, T2>(
    array1: T1[] | T1 | undefined | void | null,
    array2: T2[] | T2 | undefined | void | null
): Array<T1 | T2>;
export function concatArrays<T1, T2, T3>(
    array1: T1[] | T1 | undefined | void | null,
    array2: T2[] | T2 | undefined | void | null,
    array3: T3[] | T3 | undefined | void | null
): Array<T1 | T2 | T3>;
export function concatArrays<T1, T2, T3, T4>(
    array1: T1[] | T1 | undefined | void | null,
    array2: T2[] | T2 | undefined | void | null,
    array3: T3[] | T3 | undefined | void | null,
    array4: T4[] | T4 | undefined | void | null
): Array<T1 | T2 | T3 | T4>;
export function concatArrays<T1, T2, T3, T4, T5>(
    array1: T1[] | T1 | undefined | void | null,
    array2: T2[] | T2 | undefined | void | null,
    array3: T3[] | T3 | undefined | void | null,
    array4: T4[] | T4 | undefined | void | null,
    array5: T5[] | T5 | undefined | void | null
): Array<T1 | T2 | T3 | T4 | T5>;
export function concatArrays<T1, T2, T3, T4, T5, T6>(
    array1: T1[] | T1 | undefined | void | null,
    array2: T2[] | T2 | undefined | void | null,
    array3: T3[] | T3 | undefined | void | null,
    array4: T4[] | T4 | undefined | void | null,
    array5: T5[] | T5 | undefined | void | null,
    array6: T6[] | T6 | undefined | void | null
): Array<T1 | T2 | T3 | T4 | T5 | T6>;

/**
 * Spreading into a new array using `[...arr1, ...ar2]` syntax still is unreliable. Example:
 * {@link https://github.com/Moddable-OpenSource/moddable/issues/140}
 * In addition, unlike spread syntax this function allows individual values and `undefined`. The
 * latter is filtered out when it is a direct argument, if it is a value in one of the given
 * arrays it will be included in the result array.
 * @param {...(T[]|T)} arrays - List of arrays and/or individual elements to be concatenated
 * into one new array (in the given order)
 * @returns {T[]} Returns a new array
 */
export function concatArrays<T>(...arrays: Array<T[] | T | undefined | void | null>): T[] {
    return Array.prototype.concat.apply(
        [],
        arrays.filter(arr => arr !== undefined && arr !== null)
    );
}

/**
 * Takes a function and returns a wrapped function that caches the results of the given function.
 * @static
 * @param {Function} fn - The function whose results are to be cached
 * @param {Function} [keyFunc] - An optional function that receives the arguments as an array
 * parameter to create a key for the cache. By default, the first argument to the `fn` function
 * is used. Since the cache is a `Map` object types other than strings can be used, but if the
 * type is an object remember that it must be the exact same object (memory reference) to get
 * the cached result.
 * @returns {Function} Returns a function that returns the cached result if it is available,
 * otherwise it runs the supplied function
 */
export function memoize<T extends AnyFunction>(
    fn: T,
    keyFunc: (arr: readonly unknown[]) => unknown = args => args[0]
): T {
    const cache: Map<unknown, ReturnType<T>> = new Map();

    return function memoizedFunc(...args) {
        const hashKey = keyFunc(args);
        const cachedResult = cache.get(hashKey);

        if (cachedResult === undefined) {
            const result = fn(...args);
            cache.set(hashKey, result);
            return result;
        }

        return cachedResult;
    } as T;
}

// /**
//  * This is a throttle function with a "guaranteed and fixed delay since call" guarantee:
//  * Whenever the function gets called, its execution always takes place exactly `delay`
//  * milliseconds later. Any calls to the function between the first call and the execution are
//  * ignored. Any calls to the function after it executed again start the delayed execution. This
//  * means that there will *always* be an execution of the given function after any call to the
//  * throttled function, be it through the active timer or through setting up a new timer.
//  *
//  * **Unless you provide an `onError` callback the function should not throw any errors or return
//  * a promise that could be rejected.** It is executed through `setTimeout`, i.e. it has no
//  * parent to catch the error.
//  *
//  * **Arguments:** The throttled function does not take any arguments. The reason is that since
//  * calls to the function other than the ones that start the timer are discarded. Since it is
//  * unforeseeable which ones are discarded allowing the function to take arguments might lead to
//  * hard-to-debug errors in your code unless you design for that fact. Whatever the function
//  * needs should be provided from its environment, e.g. an array that accumulates data and is
//  * processed and emptied by the throttled function. The reference to the data should be bound or
//  * provided in the function's lexical scope before the throttled wrapper is created.
//  *
//  * @static
//  * @param {AnyFunction} fn - The function whose calls are to be throttled but with fixed delay
//  * execution guarantee. Its return values, if there are any, are lost.
//  * **NOTE:** If there is no `onError` function make sure the function does not throw or returns
//  * a rejected promise. The function must completely handle all its errors in that case.
//  * @param {number} delay - The fixed "best effort" delay in milliseconds. It is only as accurate
//  * as a Javascript timer can be, so slight deviations are to be expected (also depends on how
//  * full the Javascript event loop is at the time).
//  * @param {function(Error):void} [onError] - Since the function will be run through `setTimeout` it
//  * should not throw any errors or return a rejected promise. If an `onError` callback function
//  * is provided errors will be caught and reported through this callback.
//  * @returns {ThrottledFunction} Returns an object with the throttled function and a function to
//  * cancel the timer if it is running.
//  */
// export function throttleWithFixedDelay(
//     fn: AnyFunction,
//     delay: number,
//     onError?: (err: Error) => void
// ): ThrottledFunction {
//     let timeoutId: any;
//
//     function cancel(): void {
//         clearTimeout(timeoutId);
//         timeoutId = undefined;
//     }
//
//     function throttled(): void {
//         // The timer is already active and will execute the function. The function being called
//         // at this time neither delays nor hastens the calling of the function - any calls
//         // during this time are ignored.
//         if (timeoutId !== undefined) {
//             return;
//         }
//
//         // MAY CAUSE "UNHANDLED PROMISE REJECTION" ERROR - DELIBERATELY
//         timeoutId = setTimeout(async function throttledFunc() {
//             timeoutId = undefined;
//
//             try {
//                 // Works for both synchronous or asynchronous functions
//                 await fn();
//             } catch (err) {
//                 if (isFunction(onError)) {
//                     onError(err);
//                 } else {
//                     // Leads to "Unhandled promise rejection" error, no good other option
//                     throw createError('UFU-THROTT1', err);
//                 }
//             }
//         }, delay);
//     }
//
//     return {
//         cancel,
//         throttled
//     };
// }
