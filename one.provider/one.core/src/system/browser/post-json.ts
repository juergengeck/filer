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
 * Post a JSON string to a remote location via HTTPRequest (POST)
 * @internal
 * @static
 * @async
 * @param {string} url - A URL to a remote location. If relative, it is relative to the loaded
 * app if this is called from a browser.
 * @param {string} jsonContent - Already stringified JSON
 * @returns {Promise<void>}
 */
export async function postJson(url: string, jsonContent: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();

        request.onerror = function () {
            reject(createError('PJ-PJ4', {url}));
        };

        request.onload = function () {
            // Only checking code 200 and 201 should be okay for POST
            // https://stackoverflow.com/a/69952759/544779
            if (request.status === 200 || request.status === 201) {
                resolve();
            } else {
                reject(createError('PJ-PJ2', {code: request.status, text: request.responseText}));
            }
        };

        request.open('POST', url, true);
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(jsonContent);
    });
}
