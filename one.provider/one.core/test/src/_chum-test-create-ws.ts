/* eslint-disable no-console, arrow-parens, @typescript-eslint/no-unsafe-call */

import type {WebsocketPromisifierAPI} from '../../lib/websocket-promisifier.js';
import {createWebsocketPromisifier} from '../../lib/websocket-promisifier.js';
import {CONFIGURATION} from './_chum-sync-common.js';
import {createTestConnection} from './_websocket-connection.js';

/**
 * Create the "connection" property for the chum-sync modules {@link ChumSyncOptions} object.
 * @param {string} [personA]
 * @param {string} [personB]
 * @param {string} [spawn]
 * @returns {Promise<WebsocketPromisifierAPI>}
 */
export async function createWsPromiObj(
    personA: string = CONFIGURATION.alice.person.name || 'unknown',
    personB: string = CONFIGURATION.bob.person.name || 'unknown',
    spawn?: string
): Promise<WebsocketPromisifierAPI> {
    const connection = await createTestConnection(
        `ws://${CONFIGURATION.testConnection.host}:${CONFIGURATION.testConnection.port}`,
        `${personA}:${personB}`,
        3000,
        spawn
    ).catch(err => {
        console.log(err);
        throw err;
    });

    return createWebsocketPromisifier(connection);
}
