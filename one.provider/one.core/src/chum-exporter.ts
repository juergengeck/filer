/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

import {ExporterService} from './chum-exporter-service.js';
import type {ErrorWithCode} from './errors.js';
import {createMessageBus} from './message-bus.js';
import type {BLOB, CLOB, Person} from './recipes.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import type {WebsocketPromisifierAPI} from './websocket-promisifier.js';

/**
 * Options for the chum exporter.
 *
 * @private
 * @typedef {object} ChumExporterOptions
 * @property {WebsocketPromisifierAPI} ws - Websocket-promisifier API-object
 * @property {SHA256IdHash} remotePersonId - The ID hash of the owner of the remove instance the
 * @property {function(SHA256Hash):void} onBlobSent - Emitted after a blob was sent
 * @property {function(SHA256Hash):void} onClobSent - Emitted after a clob was sent
 * @property {function((SHA256IdHash)):void} onIdObjectSent - Emitted after an id-object was sent
 * @property {function((SHA256Hash)):void} onObjectSent - Emitted after an object was sent
 * @property {function(Error):void} onError - Emitted when a error happened usually the exporter
 *                                            does not terminate in such a case
 */
export interface ChumExporterOptions {
    ws: WebsocketPromisifierAPI;
    remotePersonId: SHA256IdHash<Person>;
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>;
    onBlobSent: (hash: SHA256Hash<BLOB>) => void;
    onClobSent: (hash: SHA256Hash<CLOB>) => void;
    onIdObjectSent: (hash: SHA256IdHash) => void;
    onObjectSent: (hash: SHA256Hash) => void;
    onError: (error: ErrorWithCode) => void;
}

const MessageBus = createMessageBus('chum-exporter');

/**
 * Function that creates a Chum exporter instance.
 *
 * The exporter provides a few services to the importer so that the importer can import objects.
 * The provided services can be seen in {@link ExporterService}.
 *
 * @param {ChumExporterOptions} options
 * @returns {Promise<void>} - Promise will resolve when the connection was lost or when the
 * importer sent the FIN command.
 */
export async function createChumExporter(options: ChumExporterOptions): Promise<void> {
    const {ws, remotePersonId, objectFilter} = options;

    const exporterService = new ExporterService(ws, remotePersonId, objectFilter);
    exporterService.onError = options.onError;
    exporterService.onBlobSent = options.onBlobSent;
    exporterService.onClobSent = options.onClobSent;
    exporterService.onIdObjectSent = options.onIdObjectSent;
    exporterService.onObjectSent = options.onObjectSent;

    const finPromise = new Promise<void>(resolve => {
        exporterService.onFin = resolve;
    });

    exporterService.start();

    try {
        MessageBus.send('log', `[${ws.connId}] EXPORTER STARTED`);

        const finReceived = await Promise.race([
            finPromise.then(() => true),
            ws.promise.catch(_ => undefined).then(() => false)
        ]);

        MessageBus.send(
            'log',
            `[${ws.connId}] EXPORTER ENDED GRACEFULLY: ${finReceived ? 'FIN' : 'CLOSE'}`
        );
    } catch (err) {
        MessageBus.send('log', `[${ws.connId}] EXPORTER ENDED WITH ERROR`, err);
    } finally {
        exporterService.stop();
    }
}
