/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

/**
 * Type describing the resolve() callback function received by the `new Promise()` creation
 * callback function.
 * Copied from TypeScript's lib.es2015.promise.d.ts
 * @typedef {Function} PromiseResolveCb
 * @param {Promise<T>|T} [value] - The value the promise will be resolved with
 * @returns {undefined} Returns `undefined`
 */
export type PromiseResolveCb<T> = (value?: T | PromiseLike<T>) => void;

/**
 * Type describing the reject() callback function received by the new Promise() creation
 * callback function.
 * Copied from TypeScript's lib.es2015.promise.d.ts
 * @typedef {Function} PromiseRejectCb
 * @param {Error} reason - The error the promise is rejected with
 * @returns {undefined} Returns `undefined`
 */
export type PromiseRejectCb = (reason?: any) => void;

/**
 * See {@link util/promise.module:ts.createTrackingPromise|util/promise.createTrackingPromise}
 * @global
 * @typedef {object} TrackingPromiseObj
 * @property {Promise<T>} promise - The tracking promise
 * @property {PromiseResolveCb<T>} resolve - The method that resolves the tracking promise
 * @property {PromiseRejectCb} reject - The method that rejects the tracking promise
 */
export interface TrackingPromiseObj<T> {
    promise: Promise<T>;
    resolve: PromiseResolveCb<T>;
    reject: PromiseRejectCb;
}

/**
 * Return value of promises passed through
 * [`Promise.allSettled`](https://github.com/tc39/proposal-promise-allSettled)
 * The `status` is 'fulfilled' and there is `value` with the value the promise resolved with, or
 * the `status` is 'rejected' and there is a `reason` with the value of the promise's rejection,
 * usually an `Error` object.
 * @global
 * @typedef {object} AllSettled
 * @property {*} [value] - The value of the individual settled promise if it was fulfilled
 * @property {Error} [reason] - Should be an `Error` object as a *best practice*, but not mandatory
 * @property {('fulfilled'|'rejected')} status
 */
export type AllSettled<T> = {value: T; status: 'fulfilled'} | {reason: Error; status: 'rejected'};

import {createError, type ErrorWithCode} from '../errors.js';
import {createMessageBus} from '../message-bus.js';
import {wrapFunctionsWithDeadlockDetection} from './promise-deadlock-detection.js';
import {isFunction, isObject} from './type-checks-basic.js';

/**
 * The possible string constant values of {@link AllSettled|`Promise.allSettled` results}.
 * It is made available as export from
 * {@link util/promise.module:ts|`util/promise`}
 * to avoid inline repetition of these constants.
 * @global
 * @typedef {object} AllSettledStatus
 * @property {'fulfilled'} FULFILLED
 * @property {'rejected'} REJECTED
 */
export const AllSettledStatus = {
    FULFILLED: 'fulfilled',
    REJECTED: 'rejected'
} as const;

const MessageBus = createMessageBus('util/promise');

/**
 * This function returns a promise that resolves after `delay` milliseconds. It resolves with
 * the `passThroughArg`, if one is supplied, or undefined if none is supplied. Example use
 * case: In an IMAP message retrieval application we use this function to create a delay between
 * retries after disconnects from the IMAP server to avoid triggering an alert on the server for
 * too many and too frequent connections.
 * @static
 * @async
 * @param {number} [delay=0] - Delay in milliseconds before the returned promise resolves. If this
 * parameter is omitted, a value of 0 is used, meaning execute "immediately", or more
 * accurately, as soon as possible. Note that in either case, the actual delay may be longer
 * than intended (it uses `setTimeout` which does not make any guarantees).
 * @param {T} [passThroughArg] - Pass-through argument to resolve with, can be used to insert
 * "wait()" in a chain to pass through a value to the next promise function.
 * @returns {Promise<T>}
 */
export function wait<T>(delay: number = 0, passThroughArg?: T): Promise<T> {
    return new Promise(resolve => {
        setTimeout(resolve, delay, passThroughArg);
    });
}

/**
 * This function delivers a rejection if a given promise does not resolve or reject within the
 * given time. The advantage of using this function over using a Promise.race() of ones promise
 * against the promise-helper wait() function above is that it cancels the timer if the promise
 * resolves before the timer fires. While a lingering timer has no influence on the value of the
 * promise a program won't end as long as there are timers still running - so if you have a
 * long-running timeout your app will be running for at least that long, even if it is actually
 * finished a split second later. Canceling the timer prevents that problem with negligible
 * effort and no other side-effects.
 *
 * **IMPORTANT:** A timeout does not cancel the function that created the promise! It merely
 * returns the rejection from the timeout instead of waiting for the result of the original promise.
 * @static
 * @async
 * @param {number} [delay=Infinity] - Timeout in milliseconds. If the promise from the function
 * has not resolved by then we return a rejected promise. If this parameter is omitted the
 * promise is returned as-is because we assume "Infinity" as default delay value so that it is
 * useless to even start the timer.<br>
 * **Note #1:** A timeout of 0 is not allowed and will result in an error because that value is
 * unpredictable. Does it mean to fail right away? If it really does is not certain because it
 * depends on which task is in front of the JS runtime internal microtask- or in the event loop
 * queue. We don't know where the promise we received will end up, it may already be resolved, or
 * it may be scheduled later in the event queue.<br>
 * **Note #2:** The actual delay may be longer than intended (it uses `setTimeout` which does not
 * make any guarantees).
 * @param {Promise<T>} promise - The promise that the timeout (if one is given) is applied to.
 * @param {string} [txt='[${delay} ms]'] - Text to include in the Error message after a timeout
 * @returns {Promise<T>} Returns the promise resulting from `Promise.race`-ing the received promise
 * against (or with) a timeout promise. Whichever of the two is fulfilled first wins. If the
 * timeout promise wins the returned promise is rejected with an `Error` whose `name` is
 * "TimeoutError".
 */
export async function timeout<T>(
    delay: number = Infinity,
    promise: Promise<T>,
    txt: string = `[${delay} ms]`
): Promise<T> {
    if (delay === 0) {
        // If the given promise fails we would end up with an uncaught promise rejection since
        // this function is supposed to do the error-catching (Promise.race does that even if
        // the timeout wins). We ignore any promise error because 1) we don't have to the to
        // wait for it (this local error here is immediate, the promise may take an
        // indeterminate amount of time), and 2) the local error has precedence.
        promise.catch(_ => undefined);
        throw createError('UPR-TO1');
    }

    if (delay === Infinity) {
        return await promise;
    }

    return await Promise.race([
        promise,
        wait(delay).then(() => Promise.reject(createError('UPR-TO', {name: 'TimeoutError', txt})))
    ]);
}

/*
 * CURRENTLY UNUSED
 *
 * Promises are missing an "any" function that resolves with the first success of the given
 *  promises, and fails if all promises fail.
 * Note: I tried "fancier" versions of Promise.any that can be found on the web. They had issues
 * and were less readable. I create an additional promise which is a bit of waste, but I prefer
 * that for clarity, time is no issue anyway since async code is used for slow I/O
 * operations.
 * @static
 * @async
 * @param {Promise[]} promises An array of promises only one of which needs to succeed for overall
 * success.
 * @returns {Promise<*>} Returns a promise that resolves with the result of the first resolving
 * promise, or rejects once all of them have rejected. In the rejected case the individual
 * rejections remain hidden, we instead return our own generic reject reason.
 */
// export function anyPromise (promises: Array<Promise<*>>): Promise<*> {
//     return new Promise((resolve, reject): void => {
//         // By counting _down_ I can easily compare with 0 instead of triggering a computation
//         // for the .length property. A micro-optimization that really does not matter because
//         // using a native Promise is slow compared to that, and the loop will likely always be a
//         // very short one.
//         let pending = promises.length;
//
//         promises.forEach((promise: Promise<*>): void => {
//             promise
//             // Key to how this works: Only the *first* call to resolve or reject matters, any
//             // subsequent calls have no effect. Also: keep in mind that this resolve() function
//             // is the one from the promise created in this function, the one the caller of
//             // anyPromise() is holding. So if *any* of the promises in array "promises" succeeds
//             // then the local promise's resolve() is called.
//             .then(resolve)
//             // On the other hand, reject() is basically disabled by the countDown,
//             // and can only be called if each one of the promises in the given array fails.
//             .catch((err: Error) => {
//                 pending -= 1;
//                 if (pending === 0) {
//                     // Create a new error message - because which one of the failed promises
//                     // would we use instead? Collect them? Probably useless effort, so instead
//                     // just create our own error message. Using this function shows errors are
//                     // expected, so knowing the message(s) is unlikely to have any benefit.
//                     // ERROR TEXT 'Cannot get fulfillment value from any promise'
//                     reject(createError('UP-ANY-P1'));
//                 }
//             });
//         });
//     });
// }

/**
 * Make sure the given functions are executed **sequentially**. It will work for any
 * function. The first function gets executed immediately, the rest is chained one by one and -
 * since these are promises - each of the functions executes in a different iteration of the
 * Javascript event loop even if the given functions are synchronous.
 * *Note:* If any promise in the chain is rejected (directly or by throwing an error)
 * *subsequent functions are not impacted and will still be run*! The serializer's function
 * merely is to ensure that none of the given functions are ever being executed at the same time.
 * @private
 * @param {function(Promise):undefined} onPromiseBeforeFirstCall - This callback will be called
 * right
 * before the first function will be called with the promise that will later be returned by this
 * function.
 * @param {...Function} functions - Functions that return promises or values, in the latter case
 * the values are wrapped in a promise.
 * @returns {Promise} Returns the last promise added to the chain. Anything attached via
 * .then(..) to the returned promise is guaranteed to execute only after everything in the chain
 * has been executed.
 */
function serialize<T>(
    onPromiseBeforeFirstCall: (p: Promise<any>) => void,
    ...functions: Array<(...args: any[]) => Promise<T>>
): Promise<T> {
    // Get and EXECUTE the first function to make it the start of the chain. If it does not return
    // a promise the returned value will be turned into one below.
    const fn = functions.shift();

    if (fn === undefined) {
        throw createError('UP-SER1');
    }

    // We need a promise here that we can use before calling the first function.
    // This only makes sense if you look at serializeWithType - it needs a promise before
    // the first function is called, because the first function might again call
    // serializeWithType. This is a classic race condition between the side effect of the first
    // function and this function returning. So the caller can obtain the returned promise
    // through the onPromiseBeforeFirstCall callback before the call of the first function is made.
    let resolveReturnedPromise: PromiseResolveCb<any>;
    let rejectReturnedPromise: PromiseRejectCb;
    const returnedPromise = new Promise<T>((resolveInner, rejectInner) => {
        resolveReturnedPromise = resolveInner;
        rejectReturnedPromise = rejectInner;
    });

    onPromiseBeforeFirstCall(returnedPromise);

    // Types: At this point Promise<T>, but below we convert rejections to values, and
    // rejections should always be Error (convention, the type is wrong if somebody
    let p: Promise<Error | T> = fn();

    // If the function did not produce a "thenable", convert its result to a promise. Checking for
    // "object" first solves the problem of the user function returning a falsy value.
    if (!isObject(p) || !isFunction(p.then)) {
        p = Promise.resolve(p);
    }

    // We will return the actual (promise-) value *before* possible rejections are stripped
    // below: Stripping rejections is essential when we get multiple functions, since we
    // declared the purpose of serialization merely is to ensure they are not executed at the
    // same time - the functions themselves are *not* considered a chain though! The
    // serialization often is for technical reasons, not logical ones. Therefore, we will not
    // stop the chain we produce for serialization when a member rejects!
    let lastPromise: Promise<any> = p;

    // We cannot let a rejected promise interrupt the entire chain: Serialization is meant to
    // ensure those operations happen in sequence and not in parallel, but the functions
    // (promises) may be otherwise completely unrelated. For example, they may all be using the
    // same resource (e.g. storage) but come from completely different "threads". So ignoring
    // rejected promises here has nothing to do with what goes on where those promises are
    // actually created and used, which is why we insert the catch() only here, internally. The
    // promises returned by the serializer remain uncaught!
    p = p.catch((err: Error) => err);

    while (functions.length > 0) {
        p = p.then(functions.shift());

        // See the comment above the same statement just above the while-loop for the same
        // statements.
        lastPromise = p;
        p = p.catch(err => err);
    }

    // We now connect the last promise with the one that we returned earlier with the
    // onPromiseBeforeFirstCall callback and that we will return at the end of this function.
    lastPromise
        .then(result => resolveReturnedPromise(result))
        .catch(err => rejectReturnedPromise(err));

    return returnedPromise;
}

/**
 * Store a promise for a given type (string). All promises of the same type are chained to the
 * previous one.
 * @private
 * @type {Map<string, Promise<*>>}
 */
const promiseTypes: Map<string, Promise<any>> = new Map();

/**
 * Make sure the given functions are executed **sequentially**. The "type" argument means we
 * can add functions later, even much later and from a completely different location in the
 * code. The purpose may be to coordinate access to a shared external resource without having to
 * know which part of the code uses it.
 * We remember the chain we build for that given type string. If there is more than one function
 * in the argument list we serialize them in the specified order.
 * *Note:* If any promise in the chain is rejected (directly or by throwing an error)
 * *subsequent functions are not impacted and will still be run*! The serializer's function
 * merely is to ensure that none of the given functions are ever being executed at the same time.
 * @static
 * @async
 * @param {string} type - The given promise-producing functions are serialized together with any
 * other ones we may already have serialized previously under the given `type` string.
 * @param {...Function} functions - List of arguments of type `(...args) => Promise<T>` &mdash;
 * Functions that return promises or values, in the latter case the values are wrapped in a
 * promise to be serializable. That means that **synchronous functions will become asynchronous.**
 * @returns {Promise<T>} Returns the last promise added to the chain. Anything attached via
 * .then(..) to the returned promise is guaranteed to execute only after the chain is completed.
 */
export async function serializeWithType<T>(
    type: string,
    ...functions: ReadonlyArray<(...args: any[]) => Promise<T>>
): Promise<T> {
    const functionsWrapped = wrapFunctionsWithDeadlockDetection(type, functions);

    if (functionsWrapped.length === 0) {
        throw createError('UP-SERWT1');
    }

    let p = promiseTypes.get(type);

    if (p instanceof Promise) {
        // Add new elements to an existing serialization chain's last promise-producing element.
        // They may all have resolved already or not, the promises take care of that for us.
        // "serialize" expects only functions, so we have to wrap the last promise in one - it
        // will immediately be unwrapped by serialize(), which executes the first function, before
        // adding the new function(s) to the chain. This function-returning function fixes p in
        // its scope, so that the function it creates always returns the current value of p.
        p = serialize(
            pp => promiseTypes.set(type, pp),
            (
                pp => () =>
                    pp
            )(p),
            ...functionsWrapped
        );
    } else {
        // There are no previous elements in this chain.
        // Note: this code had a race condition previously, because the "promiseTypes.set(type,
        // p)" was done after the serialize function returned - which is too late. The first
        // function was already called which might call another serializeWithType with the same
        // type. The race condition was now that sometimes a nested call will deadlock, but
        // most often it will execute it in parallel.
        // With the current solution we can set the value in the map before the first function
        // is called and it will always deadlock - which is way better that spurious deadlocks.
        p = serialize(pp => promiseTypes.set(type, pp), ...functionsWrapped);
    }

    // Ensure that the Map does not grow endlessly: Each new "type" string creates a new entry.
    // If (ID or object) hashes are used over time more and more unused entries would
    // accumulate. To prevent that from happening, when the promise we just added is fulfilled
    // (one way or the other) we remove it - *if and only if* it still is the last entry for the
    // given type.
    // This creates a new dangling promise which would cause an "uncaught promise rejection" if
    // the original promise rejects, so we have to catch and ignore that case.
    p.finally(() => {
        if (promiseTypes.get(type) === p) {
            promiseTypes.delete(type);
        }
    }).catch(() => undefined);

    return await p.catch(err => {
        // ENABLE ASYNC. STACK TRACE (esp. V8 runtime)
        // In those runtimes that support zero-cost async stack traces with async/await, the
        // serializer interrupts the chain. Since it's really cheap and easy and with no cost
        // for the happy path we help this process along. This might end up being called
        // multiple times. The stack trace in each case will consist of the section of the call
        // chain that lies between the original call and the call to the serializer. Here we
        // assemble them into one stack trace.
        // Example for the scenario I just described:
        //
        // FileNotFoundError: SB-READ2: File not found: 5e93...06d8 [vheads]
        // at createError (lib/errors.js:264:15)
        // at /home/mha/Projects/core/lib/system/storage-base.js:127:37
        // at async readUTF8TextFile (lib/system/storage-base.js:125:10)
        // at async getNthLineSerializedCb (lib/version-map-query.js:29:21)
        // Error: FileNotFoundError: SB-READ2: File not found: 5e93...06d8 [vheads]
        // at /home/mha/Projects/core/lib/util/promise.js:102:15
        // at async serializeWithType (lib/util/promise.js:101:10)
        // at async getNthVersionMapEntry (lib/version-map-query.js:54:17)
        // at async getObjectByIdHash (lib/storage-versioned-objects.js:90:7)
        // at async getObjectByIdObj (lib/storage-versioned-objects.js:103:10)
        // at async loadModuleFromOneStorage (lib/module-loader.js:79:7)
        // at async loadModule (lib/module-loader.js:150:16)
        // Error: FileNotFoundError: SB-READ2: File not found: 5e93...06d8 [vheads]
        // at /home/mha/Projects/core/lib/util/promise.js:102:15
        // at async serializeWithType (lib/util/promise.js:101:10)
        // at async load (lib/module-loader.js:177:10)
        // at async Context.testFn (test/microdata-exploder-test.js:216:25)
        const e = new Error(err);

        Object.assign(e, err, {
            stack: `${err.stack}\n${e.stack}`
        });

        throw e;
    });
}

/**
 * @private
 * @param {Function} fn - A function returning a promise
 * @param {number} [delay=600] - Delay between retries in milliseconds
 * @param {number} [delayMultiplier=1] - The delay is multiplied by this number at each attempt
 * @param {number} [retries=3] - How many times to retry
 * @param {function(Error):boolean} [shouldRetry]
 * @returns {Promise<*>}
 */
async function retryFn<T>(
    fn: (...args: any[]) => Promise<T>,
    delay: number,
    delayMultiplier: number,
    retries: number,
    shouldRetry: (err: ErrorWithCode) => boolean
): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        if (retries > 0 && shouldRetry(err)) {
            MessageBus.send('debug', `Retries left: ${String(retries - 1)} because of ${err}`);
            await wait(delay * delayMultiplier);
            return await retryFn(
                fn,
                delay * delayMultiplier,
                delayMultiplier,
                retries - 1,
                shouldRetry
            );
        }

        throw err;
    }
}

/**
 * The function returning a promise is executed again when the promise rejects until it either
 * resolves or the maximum number of retries is reached.
 * @static
 * @async
 * @param {function(*):Promise<T>} fn - A function of type `(...args) => Promise<T>`
 * @param {object} [options]
 * @param {number} [options.delay=600] - Delay between retries in milliseconds
 * @param {number} [options.retries=3] - How many times to retry
 * @param {function(Error):boolean} [options.shouldRetry] - This optional function can return
 * `false` after checking the `Error` object to prevent additional retries
 * @param {number} [options.delayMultiplier=1] - The delay is multiplied by this number at each
 * attempt
 * @returns {Promise<T>} Resolves with whatever the given function fn returns
 */
export async function retry<T>(
    fn: (...args: any[]) => Promise<T>,
    {
        // Defaults when an object is provided but not all properties
        delay = 600,
        retries = 3,
        delayMultiplier = 1,
        shouldRetry = () => true
    }: {
        delay?: number;
        retries?: number;
        delayMultiplier?: number;
        shouldRetry?: (err: ErrorWithCode) => boolean;
    } = {
        // Defaults when no object is provided at all
        delay: 600,
        retries: 3,
        delayMultiplier: 1,
        shouldRetry: () => true
    }
): Promise<T> {
    // Deliberately outside the promise: This should happen during development only because this
    // is "static", not dependent on user data, and a forgotten catch() could lead to an error
    // raised inside the promise to be silently dropped depending on how the code was written.
    if (!isFunction(fn)) {
        throw createError('UP-RETR1', {type: typeof fn});
    }

    return await retryFn(fn, delay, delayMultiplier, retries, shouldRetry);
}

/**
 * This function creates a "passive tracking promise".
 *
 * ## Usage
 *
 * This function returns the promise as well as its resolve/reject callbacks, normally hidden
 * inside the promise and used by code normally run through the promise, which a tracking
 * promise does not have.
 *
 * You keep the promise and give the resolve/reject callbacks to the function that you want to
 * track, where previously you would have gotten an event emitter to subscribe to or given a
 * callback function to. That code, instead of emitting an event or calling your callback
 * function, now calls the resolve or the reject callback of the promise.
 *
 * ## Explanation
 *
 * Normally promises control all the code that produces their success or failure result. This
 * tracking promise however does not.
 *
 * Tracking promises are useful when a "3rd party" otherwise not involved with direct control
 * wants to know the final outcome of an asynchronous procedure. For example, if we have a
 * stream the code controlling the stream will not use a promise. There may however be a third
 * party that only wants to know when the stream ends but does not care what happens during the
 * stream.
 *
 * While we could expose the details of the stream, the "error" event and the "finish" (or
 * "end") events, for example, we find it much more convenient and also a nice abstraction
 * across more than just streams to use this *tracking promise* device.
 *
 * **In addition, unlike event handlers the promise keeps the state once it has been set, so
 * subscribing after the state-changing event already happened still gives the correct result.**
 * If we rely on event handlers instead we would have to have an additional public property or
 * method to access the current state.
 *
 * Errors reported through the tracking promise also may not be the actual errors but a generic
 * one, after all, code using the tracking promise is not involved in any details.
 *
 * The procedure to create a tracking promise is bloody: The visceral functions usually hidden
 * deep inside the promise's peritoneum are forcefully exposed to the outside, one might say the
 * whole promise is turned inside out. We know this is not "standard" but after giving it a lot
 * of thought we still find the concept appealing for the given use case.
 *
 * ## Default rejection handler
 *
 * Tracking promises receive a default rejection `catch()` handler that discards and ignores any
 * errors.
 *
 * **This has no influence if any handler, for rejection or for success, is attached to the
 * promise at all.**
 *
 * It is used only in case the tracking promise is not used, if nothing is attached to it. This
 * can happen, for example, if a tracking promise is an optional property in an API-object to
 * indicate overall end with failure or success of a process. We use it for file streams on the
 * system level, for example.
 *
 * If the promise is used this default handler has no function and does not influence the
 * behavior of the promise. That means any rejection handler will still catch the rejection, and
 * any success handler creates a new promise that might reject if the underlying promise rejects
 * and therefore always needs to be coupled with a rejection handler as usual, see
 * {@link https://stackoverflow.com/questions/42460039/promise-reject-causes-uncaught-in-promise-warning} for an explanation.
 *
 * ## Reasons for a tracking promise:
 *
 * - Hide internals: Is it an event based process like a stream, or something completely custom?
 *   It does not matter, if it fits the pattern "some async. process we are not involved in but
 *   would like to know when it ends - transmitting a result or failure is an additional feature.
 *
 * - Code that already uses promises or async/await to coordinate asynchronous activities can
 *   seamlessly use the promise instead of having extra (non-promise) code mixed with the
 *   promise-based one.
 *
 * - Tracking promises are used in place of events (error, end) or callbacks. When the asynchronous
 *   process uses those, but the code that wants either or both of 1) synchronization and 2) the
 *   result (success value, error) without controlling the process (in which case there would be
 *   no choice) may prefer a promise.
 *
 * ## When *not* to use a tracking promise:
 *
 * - The code that wants to use a tracking promise is actually directly responsible for the
 *   asynchronous process. In that case it should use the actual constructs (e.g. events).
 *
 * - When it doesn't feel right :-)
 * @static
 * @returns {TrackingPromiseObj<T>} Returns an object with the tracking promise and its `resolve`
 * and `reject` methods
 */
export function createTrackingPromise<T>(): TrackingPromiseObj<T> {
    // The variables will immediately be assigned to just below when the newly created promise
    // synchronously executes the function it is given. Reminder: Promise creation itself is
    // synchronous - only the resolution and of course any asynchronous functions are
    // asynchronous. If we were to wait for the resolution of the promise it would not happen in
    // this "tick" of the Javascript runtime even if the promise contained no asynchronous code,
    // but the promise function itself is run synchronously in the current tick!
    let resolver;
    let rejecter;

    // TRACKING PROMISE (passive)
    // Note that the promise is "bare metal", it does not have any code apart from what is
    // needed to export its internal resolve/reject callbacks.
    const promise = new Promise<T>((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
    });

    // Prevent "Unhandled promise rejection" errors if the "promise" property is not used (i.e. the
    // tracking promise was created in vain, but the code that uses it to signal something might
    // still reject it)
    promise.catch(_ => undefined);

    return {
        promise,
        // Type casts: We know that the PROMISE CREATION ABOVE IS SYNCHRONOUS!
        resolve: resolver as unknown as PromiseResolveCb<T>,
        reject: rejecter as unknown as PromiseRejectCb
    };
}
