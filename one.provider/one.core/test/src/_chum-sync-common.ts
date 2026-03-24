/* eslint-disable no-console, arrow-parens */

import type {ChumApi, ChumSyncOptions} from '../../lib/chum-sync.js';
import {createChum} from '../../lib/chum-sync.js';
import type {Instance, Person} from '../../lib/recipes.js';
import {exists} from '../../lib/system/storage-base.js';
import {retry} from '../../lib/util/promise.js';
import {ensureHash} from '../../lib/util/type-checks.js';

// WARNING: In BROWSER tests logging too much causes significant slowdown due to many added
// HTML elements,which also leads to test failures.
// ['log', 'alert', 'error', 'debug']
export const ENABLED_LOG_LVLS = ['error'] as const;

export const SERVICE = {
    log: 100, // Reverse: Bob => Alice
    error: 101, // Reverse: Bob => Alice
    init: 1,
    deleteTestDB: 2,
    emptyChum: 3,
    onGoingChum: 4,
    grantAccess: 5,
    checkExistence: 6,
    waitForObject: 7,
    createObj: 8,
    reportMemoryUsage: 10
} as const;

export const CONFIGURATION = {
    testConnection: {
        host: 'localhost',
        port: 8000
    },
    alice: {
        person: {
            $type$: 'Person',
            email: 'alice@mail.com',
            name: 'Alice'
        } as Person,
        instance: {
            $type$: 'Instance',
            name: 'MainAlice'
        } as Instance,
        initialDataObj: {
            email: 'alice@mail.com',
            instanceName: 'MainAlice'
        }
    },
    bob: {
        person: {
            $type$: 'Person',
            email: 'bob@mail.com',
            name: 'Bob'
        } as Person,
        instance: {
            $type$: 'Instance',
            name: 'MainBob'
        } as Instance,
        initialDataObj: {
            email: 'bob@mail.com',
            instanceName: 'MainBob'
        }
    }
} as const;

// Mimics one.models startChum() function's try/catch of chum-sync, specifically that it closes
// the connection if the chum promise rejects
export function startTestChum(options: ChumSyncOptions): ChumApi {
    const chum = createChum(options);

    chum.promise.catch(err => {
        options.connection.close(String(err));
    });

    return chum;
}

export const RETRY_DELAY = 200;

export function ensureInteger(data: unknown): number {
    if (!Number.isInteger(data)) {
        throw new TypeError(`Not an integer but ${typeof data}: ${data}`);
    }

    return data as number;
}

const NOT_FOUND_ERROR = new Error('Not yet');

export async function waitForObject(hash: unknown, maxWait: unknown = 5000): Promise<boolean> {
    try {
        return await retry(
            async () => {
                if (await exists(ensureHash(hash))) {
                    return true;
                }

                throw NOT_FOUND_ERROR;
            },
            {
                delay: RETRY_DELAY,
                retries: ensureInteger(maxWait) / RETRY_DELAY
            }
        );
    } catch (err) {
        // Convert a final "Not FoUnd" error to the expected boolean result
        if (err === NOT_FOUND_ERROR) {
            return false;
        }

        throw err;
    }
}
