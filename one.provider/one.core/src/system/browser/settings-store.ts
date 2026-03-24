/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2021
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The settings store is a key-value store used to store instance settings that cannot or should
 * not be stored in the usual ONE storage places.
 * The browser implementation uses `localStorage`.
 * @private
 * @module
 */

import type {SettingStoreApi} from '../../storage-base-common.js';
import type {AnyObject} from '../../util/object.js';
import {wait} from '../../util/promise.js';
import {stringify} from '../../util/sorted-stringify.js';

/**
 * Settings storage for {@link PLATFORMS.BROWSER}
 * @internal
 */
export const SettingsStore: SettingStoreApi = {
    // This is async because the node.js API is asynchronous
    getItem: async (key: string) => {
        const item = localStorage.getItem(key);

        if (item === null) {
            return undefined;
        }

        return JSON.parse(item);
    },
    // This is async because the node.js API is asynchronous. Also, localStorage gives no
    // guarantee about the value having been written to disk, so we give it a minimum amount
    // of time to be somewhat more sure (of course we cannot check from Javascript).
    setItem: async (key: string, value: string | AnyObject) => {
        localStorage.setItem(key, stringify(value));
        await wait(1);
    },
    // This is async because the node.js API is asynchronous. Also, localStorage gives no
    // guarantee about the value having been written to disk, so we give it a minimum amount
    // of time to be somewhat more sure (of course we cannot check from Javascript).
    removeItem: async (key: string) => {
        localStorage.removeItem(key);
        await wait(1);
    },
    // This is async because the node.js API is asynchronous. Also, localStorage gives no
    // guarantee about the value having been written to disk, so we give it a minimum amount
    // of time to be somewhat more sure (of course we cannot check from Javascript).
    clear: async (): Promise<void> => {
        localStorage.clear();
        await wait(1);
    }
};
