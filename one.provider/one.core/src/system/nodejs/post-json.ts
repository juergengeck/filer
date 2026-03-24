/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2023
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @module
 */

import {request as httpRequest} from 'http';
import {request as httpsRequest} from 'https';

import {createError} from '../../errors.js';

/**
 * Post json to a remote location via `http(s).request` (POST)
 * @internal
 * @param {string} url - A URL to a remote location.
 * @param {string} jsonContent - Already stringified JSON
 * @returns {Promise<void>}
 */
export async function postJson(url: string, jsonContent: string): Promise<void> {
    const {protocol, hostname, port, pathname} = new URL(url);

    if (protocol !== 'https:' && protocol !== 'http:') {
        throw createError('PJ-PJ1', {protocol, url});
    }

    const request = protocol === 'https:' ? httpsRequest : httpRequest;

    await new Promise<void>((resolve, reject) => {
        const options = {
            hostname: hostname,
            port: port,
            path: pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = request(options, async (res: any) => {
            let data = '';

            for await (const chunk of res) {
                data += chunk;
            }

            // Only checking code 200 and 201 should be okay for POST
            // https://stackoverflow.com/a/69952759/544779
            if (res.statusCode === 200 || res.statusCode === 201) {
                resolve();
            } else {
                reject(createError('PJ-PJ2', {code: res.statusCode, text: data}));
            }
        });

        req.on('error', (error: any) => {
            reject(createError('PJ-PJ3', error));
        });

        req.write(jsonContent);
        req.end();
    });
}
