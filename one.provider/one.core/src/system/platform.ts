/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {createError} from '../errors.js';

/**
 * @module
 */

/* eslint-disable @typescript-eslint/no-implied-eval */

// "new Function" is used to work around TypeScript errors for all the unknown symbols

export const isBrowser: boolean = new Function(
    'return typeof window !== "undefined" && typeof window.document !== "undefined"'
)();

export const isWebWorker: boolean = new Function(
    'return typeof WorkerGlobalScope !== "undefined" && ' +
        'typeof importScripts === "function" && ' +
        'self instanceof WorkerGlobalScope;'
)();

export const isNode: boolean = new Function(
    'return typeof process === "object" && ' +
        'typeof process.versions === "object" && ' +
        'typeof process.versions.node === "string";'
)();

// We're not running in Expo/React Native - this is desktop Electron
export const isExpo: boolean = false;

export const SYSTEM = isNode ? 'nodejs' : 'browser';

let platform = false;

export function setPlatformLoaded(pl: undefined | typeof SYSTEM): void {
    if ((isBrowser && pl !== 'browser') || (isNode && pl !== 'nodejs')) {
        throw createError('PL-SPL1', {SYSTEM, pl});
    }

    platform = true;
}

export function ensurePlatformLoaded(): void {
    if (!platform) {
        throw createError('PL-CPL1');
    }
}
