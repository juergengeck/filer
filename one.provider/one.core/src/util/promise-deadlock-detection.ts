/**
 * @author Erik Haßlmeyer <erik@refinio.net>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 *
 * This file provides functions for deadlock detection in serializeWithType. If enabled every
 * call is recorded in a map (with call timestamp and stacktrace) and removed when the call
 * finishes. This way you can see function calls that do not finish.
 */

/**
 * @module
 */

// #### Private interface ####

/**
 * Map that stores statistics during the call of a serialized function.
 *
 * @type {Map<string, DeadlockStatistics>}
 */
const internalDeadlockDetectionStatistics: Map<string, DeadlockStatistics> = new Map();

/**
 * Enabled / disabled state of deadlock detection.
 *
 * @type {boolean}
 */
let deadlockDetectionEnabled = false;

// #### Public interface ####

/**
 * Statistics stored for the deadlock detection.
 */
export interface DeadlockStatistics {
    stack: string;
    time: number;
}

/**
 * Enable / Disable acquiring the deadlock statistics - disabled by default.
 *
 * @param {boolean} enable - if true, enable. If false disable.
 */
export function enableDeadlockDetection(enable: boolean): void {
    deadlockDetectionEnabled = enable;
}

/**
 * Check if deadlock detection is enabled.
 *
 * @returns {boolean}
 */
export function isDeadlockDetectionEnabled(): boolean {
    return deadlockDetectionEnabled;
}

/**
 * Get the statistics.
 *
 * Each entry in the map is a currently running serilaized function. If a function deadlocks it
 * will stay in this list forever. The time in the statistics will help you to distinguish
 * deadlocked calls from still alive calls.
 *
 * @returns {Map<string, DeadlockStatistics>} - The key of the map is the 'type' of the
 * serializeWithType call, the second parameter are statistics that are useful in order to
 * ascertain if a deadlock happens (start time of serialization, stack trace).
 */
export function deadlockDetectionStatistics(): Map<string, DeadlockStatistics> {
    return internalDeadlockDetectionStatistics;
}

/**
 * This function is used in serializeWithType in order to create the deadlock statistics.
 *
 * @param {string} type - Type parameter of serilaizeWithType
 * @param {Array<function(*):Promise>} functions - Functions parameter of
 * serializeWithType
 * @returns {Array<function(*):Promise>} - If deadlock detection is enabled,
 * a wrapper around the original functions is returned, if not it just returns the functions
 * parameter.
 */
export function wrapFunctionsWithDeadlockDetection<T>(
    type: string,
    functions: ReadonlyArray<(...args: any[]) => Promise<T>>
): ReadonlyArray<(...args: any[]) => Promise<T>> {
    if (!deadlockDetectionEnabled) {
        return functions;
    }

    const stack = new Error('dummy').stack;
    return functions.map(f => {
        return async (...args: any[]) => {
            if (internalDeadlockDetectionStatistics.has(type)) {
                // eslint-disable-next-line no-console
                console.error(
                    'Serialize did not correctly serialize. There are two functions of same type running in parallel!',
                    type
                );
            }

            internalDeadlockDetectionStatistics.set(type, {
                stack: stack === undefined ? 'no stack available' : stack,
                time: Date.now()
            });

            let ret;

            try {
                ret = await f(...args);
            } finally {
                internalDeadlockDetectionStatistics.delete(type);
            }

            return ret;
        };
    });
}
