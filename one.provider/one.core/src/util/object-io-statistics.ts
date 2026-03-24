/**
 * @author Erik Haßlmeyer <erik@refinio.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import type {OneEventSource, OneEventSourceConsumer} from './one-event-source.js';
import {createEventSource} from './one-event-source.js';

/**
 * Type representing statistics
 */
export interface CallStatistics {
    // Total number of write / read calls made
    totalCalls: number;

    // Functions that were called
    functionStats: Array<{
        functionName: string;
        // Total calls of this function
        callCount: number;
        // Number of individual call stacks calling this function
        callStackCount: number;
    }>;

    // Individual call stacks sorted by number of calls that happened
    callStackStats: Array<{
        callStack: string;
        count: number;
        functionName: string;
        types: Map<string, number>;
    }>;
}

class StatisticsLogger {
    enabled: boolean = true;
    total: number = 0;
    private statistics = new Map<
        string,
        {count: number; functionName: string; types: Map<string, number>}
    >();

    append(functionName: string, callStack: string, type?: string): void {
        let entry = this.statistics.get(callStack);

        if (entry === undefined) {
            entry = {
                count: 0,
                functionName,
                types: new Map(type === undefined ? [] : [[type, 1]])
            };
            this.statistics.set(callStack, entry);
        }

        if (type !== undefined) {
            entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
        }

        ++entry.count;
        ++this.total;
    }

    clear(): void {
        this.statistics.clear();
        this.total = 0;
    }

    empty(): boolean {
        return this.total === 0;
    }

    getStatistics(): CallStatistics {
        const data = [...this.statistics.entries()];
        data.sort((a, b) => b[1].count - a[1].count);

        // Build function based call statistic

        const functionMap = new Map<
            string,
            {
                callCount: number;
                callStackCount: number;
            }
        >();

        for (const [_callStack, stats] of data) {
            let e = functionMap.get(stats.functionName);

            if (e === undefined) {
                e = {
                    callCount: 0,
                    callStackCount: 0
                };
                functionMap.set(stats.functionName, e);
            }

            e.callCount += stats.count;
            e.callStackCount += 1;
        }

        return {
            totalCalls: this.total,
            functionStats: [...functionMap.entries()].map(([functionName, stats]) => ({
                functionName,
                ...stats
            })),
            callStackStats: data.map(([callStack, stats]) => ({
                callStack,
                ...stats
            }))
        };
    }

    print(): void {
        const stats = this.getStatistics();

        // eslint-disable-next-line no-console
        console.log(`###### STATISTICS (total: ${this.total}) ######`);

        for (const s of stats.functionStats) {
            // eslint-disable-next-line no-console
            console.log(
                `  ${s.functionName.padEnd(20, ' ')} - calls ${s.callCount}, unique call stacks: ${
                    s.callStackCount
                }`
            );
        }

        // #### Build call stacks ####

        // eslint-disable-next-line no-console
        console.log(
            `###### Call stacks (call stack count: ${stats.callStackStats.length}, call count: ${stats.totalCalls}) ######`
        );

        for (const s of stats.callStackStats) {
            // eslint-disable-next-line no-console
            console.log(` - ${s.functionName}\n${s.callStack}`, s.count, [...s.types.entries()]);
        }

        // eslint-disable-next-line no-console
        console.log('###### STATISTICS - END ######');
    }
}

// If false, no statistics will be generated (global switch, for more efficiency when off)
let enabled = false;

// Collection of all active loggers (active means enabled, or they have data)
const loggers = new Map<string, StatisticsLogger>();

const enableChangedEvent = createEventSource<void>();

export const onStatisticsEnabledChanged = enableChangedEvent.consumer;

/**
 * Logs a call.
 *
 * Needs to be called by the getObject functions on each call.
 *
 * @param {string} functionName - Name of the function to log
 * @param {string} type - Type of the object that was read
 */
export function logCall(functionName: string, type?: string): void {
    if (!enabled) {
        return;
    }

    let callStack = new Error().stack;

    if (callStack === undefined) {
        callStack = '<none>';
    }

    const callStackArr = callStack.split('\n');
    callStackArr.splice(0, 2);

    const callStackWithoutDuplictes = callStackArr
        // Filter duplicates (recursive calls)
        .filter((elem, index, arr) => {
            if (index === 0) {
                return true;
            }

            return arr[index - 1] !== elem;
        })

        // Remove Promise.all indices
        .map(elem => {
            const index = elem.indexOf('Promise.all');

            if (index > -1) {
                return elem.slice(0, index + 11);
            } else {
                return elem;
            }
        })
        .join('\n');

    for (const [_id, logger] of loggers) {
        if (!logger.enabled) {
            continue;
        }

        logger.append(functionName, callStackWithoutDuplictes, type);
    }
}

/**
 * Enables statistics recording.
 *
 * @param {boolean} e - If true enabled, if false disabled.
 * @param {string} id
 */
export function enableStatistics(e = true, id = 'default'): void {
    const logger = loggers.get(id);

    if (e) {
        if (logger === undefined) {
            loggers.set(id, new StatisticsLogger());
        } else {
            logger.enabled = true;
        }
    } else if (logger !== undefined) {
        if (logger.empty()) {
            loggers.delete(id);
        } else {
            logger.enabled = false;
        }
    }

    // Update global enables state
    enabled = [...loggers.values()].some(l => l.enabled);

    enableChangedEvent.dispatch();
}

/**
 * Disables statistics recording.
 *
 * @param {boolean} d - If true disabled, if false enabled.
 * @param {string} id
 */
export function disableStatistics(d = true, id = 'default'): void {
    enableStatistics(!d, id);
}

/**
 * Check if statistics recording is enabled.
 *
 * @param {string} id
 * @returns {boolean}
 */
export function areStatisticsEnabled(id = 'default'): boolean {
    const logger = loggers.get(id);

    if (logger === undefined) {
        return false;
    } else {
        return logger.enabled;
    }
}

/**
 * Reset the recorded statistics.
 * @param {string} id
 */
export function resetStatistics(id = 'default'): void {
    const logger = loggers.get(id);

    if (logger === undefined) {
        return;
    }

    logger.clear();

    if (!logger.enabled) {
        loggers.delete(id);
    }
}

/**
 * Print statistics
 * @param {string} id
 */
export function printStatistics(id = 'default'): void {
    const logger = loggers.get(id);

    if (logger === undefined) {
        return;
    }

    logger.print();
}

/**
 * Print statistics
 * @param {string} id
 * @returns {CallStatistics}
 */
export function getStatistics(id = 'default'): CallStatistics {
    const logger = loggers.get(id);

    if (logger === undefined) {
        return {
            totalCalls: 0,
            functionStats: [],
            callStackStats: []
        };
    }

    return logger.getStatistics();
}

/**
 * Get all ids of loggers that are either enabled or have data.
 *
 * @returns {string[]}
 */
export function getActiveStatisticLoggerIds(): string[] {
    return [...loggers.keys()];
}

/**
 * Shutdown all loggers by wiping and disabling everything.
 */
export function shudownAll(): void {
    loggers.clear();
    enabled = false;
}
