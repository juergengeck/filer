/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2021
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * The settings store is a key-value store used to store instance settings that cannot or should
 * not be stored in the usual ONE storage places.
 * The node.js version stores a file with the settings ina JSON.stringified object in the
 * "private" storage space.
 * @private
 * @module
 */

import {readFile, unlink, writeFile} from 'fs/promises';
import {join} from 'path';

import {createError} from '../../errors.js';
import type {SettingStoreApi} from '../../storage-base-common.js';
import type {AnyObject} from '../../util/object.js';
import {stringify} from '../../util/sorted-stringify.js';
import {getBaseDirOrName} from '../storage-base.js';

const SETTINGS_FILE = 'SettingsStore';

/**
 * Retrieves all the Store entries.
 *
 * It is an error (`SB-INIT1`) if the storage has not yet been initialized, since we may be
 * missing an actually existing SettingsStore file.
 *
 * it is **not** an error if that file does not exist.
 * @returns {Promise<AnyObject>}
 */
async function readSettings(): Promise<AnyObject> {
    const content = await readFile(join(getBaseDirOrName(), SETTINGS_FILE), 'utf8').catch(
        (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                return '{}';
            }

            throw createError('SET-READ', err);
        }
    );

    return JSON.parse(content);
}

/**
 * Retrieves SettingsStore item by key.
 * @param {string} key
 * @returns {Promise<string|undefined>}
 */
async function getItem(key: string): Promise<string | AnyObject | undefined> {
    try {
        const entries = await readSettings();
        return entries[key];
    } catch (error) {
        throw createError('SET-GET', {reason: error.message});
    }
}

// "setItem" and "removeItem" read, then modify, then save the file. This must be locked or two
// simultaneous operations could lead to an operation getting overwritten.
// DESIGN DECISION: We report an error instead of trying to serialize writes. This is a very
// rare niche operation and callers should just make sure that there never is more than one in
// progress.
let G_LOCK = false;

/**
 * Sets Store item by key & value.
 * @param {string} key
 * @param {string} value
 */
async function setItem(key: string, value: string | AnyObject): Promise<void> {
    if (G_LOCK) {
        throw createError('SET-LOCK1', {key});
    }

    G_LOCK = true;

    try {
        const entries = await readSettings();
        entries[key] = value;
        await writeFile(join(getBaseDirOrName(), SETTINGS_FILE), stringify(entries), {
            flag: 'w'
        });
    } catch (error) {
        throw createError('SET-SET', {reason: error.message});
    } finally {
        G_LOCK = false;
    }
}

/**
 * Removes Store's entry by the given key.
 * @param {string} key
 */
async function removeItem(key: string): Promise<void> {
    if (G_LOCK) {
        throw createError('SET-LOCK1', {key});
    }

    G_LOCK = true;

    try {
        const entries = await readSettings();
        delete entries[key];
        await writeFile(join(getBaseDirOrName(), SETTINGS_FILE), stringify(entries), {
            flag: 'w'
        });
    } catch (error) {
        throw createError('SET-RMV', {reason: error.message});
    } finally {
        G_LOCK = false;
    }
}

/**
 * Removes the Settings Store file entirely.
 */
async function clear(): Promise<void> {
    await unlink(join(getBaseDirOrName(), SETTINGS_FILE)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
            throw createError('SET-CLR', err);
        }
    });
}

/**
 * Settings storage for {@link PLATFORMS.NODE_JS}
 * @internal
 */
export const SettingsStore: SettingStoreApi = {
    getItem,
    setItem,
    removeItem,
    clear
};
