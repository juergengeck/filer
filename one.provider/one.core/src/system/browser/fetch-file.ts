/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import {createError} from '../../errors.js';

/**
 * Fetch a file from remote location via HTTPRequest (GET)
 * @internal
 * @static
 * @async
 * @param {string} url - A URL to a remote location. If relative, it is relative to the loaded
 * app if this is called from a browser.
 * @returns {Promise<string>}
 */
export async function fetchFile(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();

        request.onerror = function () {
            reject(createError('PJ-PJ3', {url}));
        };

        request.onload = function () {
            // Just 200 should be okay, all the other 2xx and 304 don't apply for a simple get call.
            if (request.status === 200) {
                resolve(request.responseText);
            } else {
                reject(createError('PJ-PJ2', {code: request.status, text: request.responseText}));
            }
        };

        request.open('GET', url, true);
        request.send();
    });
}
