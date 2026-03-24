/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2021
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The settings store is a key-value store used to store instance settings that cannot or should
 * not be stored in the usual ONE storage places.
 * The browser implementation uses `localStorage` and the node.js version stores a file with the
 * settings ina JSON.stringified object in the "private" storage space.
 * @private
 * @module
 */

import type {SettingStoreApi} from '../storage-base-common.js';
import type {AnyObject} from '../util/object.js';
import {ensurePlatformLoaded} from './platform.js';

type SsBrowser = typeof import('./browser/settings-store.js');
type SsNode = typeof import('./nodejs/settings-store.js');

let SS: SsBrowser | SsNode;

export function setPlatformForSs(exports: SsBrowser | SsNode): void {
    SS = exports;
}

export const SettingsStore: SettingStoreApi = {
    getItem: (key: string): Promise<string | AnyObject | undefined> => {
        ensurePlatformLoaded();
        return SS.SettingsStore.getItem(key);
    },
    setItem: (key: string, value: string | AnyObject): Promise<void> => {
        ensurePlatformLoaded();
        return SS.SettingsStore.setItem(key, value);
    },
    removeItem: (key: string): Promise<void> => {
        ensurePlatformLoaded();
        return SS.SettingsStore.removeItem(key);
    },
    clear: (): Promise<void> => {
        ensurePlatformLoaded();
        return SS.SettingsStore.clear();
    }
};
