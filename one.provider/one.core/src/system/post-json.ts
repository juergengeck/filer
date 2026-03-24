/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {ensurePlatformLoaded} from './platform.js';

/**
 * @module
 */

type PjBrowser = typeof import('./browser/post-json.js');
type PjNode = typeof import('./nodejs/post-json.js');

let PJ: PjBrowser | PjNode;

export function setPlatformForPj(exports: PjBrowser | PjNode): void {
    PJ = exports;
}

/**
 * Post a JSON string to a remote location via HTTPRequest (POST)
 * @param {string} url - A URL to a remote location. If relative, it is relative to the loaded
 * app if this is called from a browser.
 * @param {string} jsonContent - Already stringified JSON
 * @returns {Promise<void>}
 */
export function postJson(url: string, jsonContent: string): Promise<void> {
    ensurePlatformLoaded();
    return PJ.postJson(url, jsonContent);
}
