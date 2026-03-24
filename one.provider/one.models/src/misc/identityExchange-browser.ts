import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {fetchFile} from '@refinio/one.core/lib/system/fetch-file.js';

import type {Identity} from './IdentityExchange.js';
import {convertIdentityToOneInstanceEndpoint, isIdentity} from './IdentityExchange.js';
import type {OneInstanceEndpoint} from '../recipes/Leute/CommunicationEndpoints.js';

// ######## Identity I/O ########

/**
 * Read identity from a file.
 *
 * @param url - A url to a remote location. If relative, it is relative to the loaded app.
 */
export async function readIdentityFile(url: string): Promise<Identity> {
    const data = JSON.parse(await fetchFile(url));

    if (!isIdentity(data)) {
        throw new Error('Format of identity file with secrets is wrong.');
    }

    return data;
}

// ######## Identity I/O using one objects ########

/**
 * Import an identity as OneInstanceEndpoint.
 *
 * This also signs the keys with our own key, so that they are considered trusted keys.
 *
 * @param url - The url to the file. The path is relative to the root of the loaded app.
 */
export async function importIdentityFileAsOneInstanceEndpoint(
    url: string
): Promise<UnversionedObjectResult<OneInstanceEndpoint>> {
    const identity = await readIdentityFile(url);
    return convertIdentityToOneInstanceEndpoint(identity);
}
