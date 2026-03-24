/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import type {PromiseRejectCb, PromiseResolveCb} from './promise.js';

interface SemItem {
    resolve: PromiseResolveCb<void>;
    reject: PromiseRejectCb;
}

export class Semaphore {
    private _awaiters: SemItem[];

    constructor() {
        this._awaiters = [];
    }

    private get _all(): SemItem[] {
        const awaiters = [...this._awaiters];
        this._awaiters = [];
        return awaiters;
    }

    public async wait(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this._awaiters.push({resolve, reject});
        });
    }

    public signal(...args: any[]): void {
        const awaiter = this._awaiters.shift();

        if (!awaiter) {
            return;
        }

        awaiter.resolve(...args);
    }

    public broadcast(...args: any[]): void {
        this._all.forEach(({resolve}) => resolve(...args));
    }

    public reject(error: Error): void {
        this._all.forEach(({reject}) => reject(error));
    }
}
