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
 * Read file from remote location via `http(s).request` (GET)
 * @internal
 * @param {string} url - A URL to a remote location.
 * @returns {Promise<string>}
 */
export async function fetchFile(url: string): Promise<string> {
    const {protocol, hostname, port, pathname} = new URL(url);

    if (protocol !== 'https:' && protocol !== 'http:') {
        throw createError('FF-FF1', {protocol, url});
    }

    return new Promise<string>((resolve, reject) => {
        const options = {
            hostname: hostname,
            port: port,
            path: pathname,
            method: 'GET'
        };

        const request = protocol === 'https:' ? httpsRequest : httpRequest;

        const req = request(options, async (res: any) => {
            let data = '';

            for await (const chunk of res) {
                data += chunk;
            }

            if (res.statusCode === 200) {
                resolve(data);
            } else {
                reject(createError('FF-FF2', {code: res.statusCode, text: data}));
            }
        });

        req.on('error', (error: any) => {
            reject(createError('FF-FF3', error));
        });

        req.end();
    });
}
