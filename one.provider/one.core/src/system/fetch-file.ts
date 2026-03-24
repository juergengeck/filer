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

type FfBrowser = typeof import('./browser/fetch-file.js');
type FfNode = typeof import('./nodejs/fetch-file.js');

let FF: FfBrowser | FfNode;

export function setPlatformForFf(exports: FfBrowser | FfNode): void {
    FF = exports;
}

/**
 * Fetch a file from remote location via HTTPRequest (GET)
 * @param {string} url - A URL to a remote location. If relative, it is relative to the loaded
 * app if this is called from a browser.
 * @returns {Promise<string>}
 */
export function fetchFile(url: string): Promise<string> {
    ensurePlatformLoaded();
    return FF.fetchFile(url);
}
