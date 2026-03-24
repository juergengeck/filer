/* eslint-disable no-await-in-loop */
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

import {PROTOCOL_VERSION} from './chum-base.js';
import {ExporterClient} from './chum-importer-exporterclient.js';
import {createError, type ErrorWithCode} from './errors.js';
import {createMessageBus} from './message-bus.js';
import type {
    BLOB,
    CLOB,
    OneIdObjectTypes,
    OneObjectTypes,
    OneVersionedObjectTypes,
    VersionNode
} from './recipes.js';
import {CREATION_STATUS, type AnyObjectCreation} from './storage-base-common.js';
import {getObject} from './storage-unversioned-objects.js';
import {
    getIdObject,
    getLastNodeFromArray,
    MERGE_AS,
    mergeVersionWithCurrent
} from './storage-versioned-objects.js';
import type {IdFileCreation} from './storage-versioned-objects.js';
import {exists} from './system/storage-base.js';
import type {
    AccessibleIdObject,
    AccessibleUnversionedObject,
    AccessibleVersionedObject,
    AccessibleVersionNode
} from './util/determine-accessible-hashes.js';
import {determineChildren, determineChildrenForIdObject} from './util/determine-children.js';
import type {ChildObject} from './util/determine-children.js';
import {calculateIdHashOfObj} from './util/object.js';
import {retry, wait} from './util/promise.js';
import type {SHA256Hash, SHA256IdHash} from './util/type-checks.js';
import type {WebsocketPromisifierAPI} from './websocket-promisifier.js';
import {UNKNOWN_SERVICE} from './websocket-request-handler.js';

/**
 * Options for the chum importer.
 *
 * @private
 * @typedef {object} ChumImporterOptions
 * @property {WebsocketPromisifierAPI} ws - Websocket-promisifier API-object
 * @property {boolean} [keepRunning=false] - If true, then the importer will wait for new data
 * after the initial sync
 * @property {number} [pollInterval=5000] - KeepRunning interval between polls (in ms)
 * @property {function(SHA256Hash):void} onBlobSaved - Emitted after a blob was imported
 * @property {function(SHA256Hash):void} onClobSaved - Emitted after a clob was imported
 * @property {function(SHA256IdHash):void} onIdObjectSaved - Emitted after an id-object was imported
 * @property {function(SHA256Hash):void} onObjectSaved  - Emitted after an object was imported
 * @property {function(Error):void} onError - Emitted on error. Importer does not necessarily
 *                                            terminate
 */
export interface ChumImporterOptions {
    ws: WebsocketPromisifierAPI;
    keepRunning?: boolean;
    pollInterval?: number;
    onFirstSync?: () => void;
    onObjectSaved: (hash: SHA256Hash) => void;
    onIdObjectSaved: (hash: SHA256IdHash) => void;
    onBlobSaved: (hash: SHA256Hash<BLOB>) => void;
    onClobSaved: (hash: SHA256Hash<CLOB>) => void;
    onError: (err: ErrorWithCode) => void;
}

const MessageBus = createMessageBus('chum-importer');

/**
 * Function that creates a ChumImporter instance.
 *
 * ## End conditions
 *
 * 1. Loss of connection (connection error state does not matter)
 * 2. A full synchronization means there is nothing left to do - if keepRunning === false
 * 3. Any error ends the importer (incl. errors in detached functions)
 *
 * @static
 * @async
 * @param {ChumImporterOptions} options - An object with options
 * @returns {Promise<number>} Returns the time on the remote instance as milliseconds since
 * 1/1/1970 timestamp before which we have all top level accessible objects
 */
export async function createChumImporter(options: ChumImporterOptions): Promise<void> {
    const {keepRunning, pollInterval, ws} = options;
    let onFirstSyncDone = false;

    // #### a few local helpers ####

    const newAccessibleRoot = (): void => {
        // eslint-disable-next-line no-console
        console.log('IMPORTER: NEW DATA AVAILABLE');
    };

    function logError(err: ErrorWithCode): void {
        MessageBus.send('log', `[${exporterClient.connId}] BAD REQUEST`, err);
    }

    let connected = true;

    function handleDisconnect(): void {
        connected = false;
    }

    // #### Exporter client ####

    const exporterClient = new ExporterClient(ws);
    exporterClient.onBlobStored = options.onBlobSaved;
    exporterClient.onClobStored = options.onClobSaved;
    exporterClient.onIdObjectStored = options.onIdObjectSaved;
    exporterClient.onObjectStored = options.onObjectSaved;
    exporterClient.onNewAccessibleRoot = newAccessibleRoot;
    exporterClient.onError = logError;
    exporterClient.onDisconnect = handleDisconnect;
    exporterClient.start();

    MessageBus.send('log', `[${exporterClient.connId}] EXPORTER STARTED`);

    try {
        await waitForRemoteExporterAndCheckProtocolVersions(exporterClient);

        while (connected) {
            const accessibleRootObjects = await exporterClient.getAccessibleRoots();

            MessageBus.send(
                'log',
                `[${ws.connId}] Received root hashes: ${JSON.stringify(accessibleRootObjects)}`
            );

            // separate version nodes by dataIdHash
            const versionNodesMap = new Map<SHA256IdHash, AccessibleVersionNode[]>();

            for (const root of accessibleRootObjects.values()) {
                MessageBus.send(
                    'debug',
                    `[${ws.connId}] Import root hash: ${JSON.stringify(root)}`
                );

                try {
                    if (root.type === 'unversioned') {
                        await processUnversionedObject(exporterClient, root);
                    } else if (root.type === 'versioned') {
                        await processVersionedObject(exporterClient, root);
                    } else if (root.type === 'id') {
                        await processIdObject(exporterClient, root);
                    } else if (root.type === 'version_node') {
                        const dataIdHash = root.dataIdHash;

                        if (!versionNodesMap.has(dataIdHash)) {
                            versionNodesMap.set(dataIdHash, []);
                        }
                        versionNodesMap.get(dataIdHash)?.push(root);
                    }
                } catch (e) {
                    // Do not stop the importer because the remote sent wrong hashes
                    options.onError(e);
                }
            }

            // process version nodes in parallel
            await Promise.all(
                Array.from(versionNodesMap.values()).map(nodes => {
                    try {
                        return processVersionNodes(exporterClient, nodes);
                    } catch (e) {
                        // Do not stop the importer because the remote sent wrong hashes
                        options.onError(e);
                    }

                    return Promise.resolve();
                })
            );

            if (!onFirstSyncDone) {
                options.onFirstSync && options.onFirstSync();
                onFirstSyncDone = true;
            }

            if (keepRunning) {
                await wait(pollInterval);
            } else {
                await exporterClient.sendFin();
                break;
            }
        }

        MessageBus.send('log', `[${ws.connId}] IMPORTER ENDED GRACEFULLY`);
    } catch (err) {
        MessageBus.send('log', `[${ws.connId}] IMPORTER ENDED WITH ERROR`, err);
        throw err;
    } finally {
        exporterClient.stop();
    }
}

// #### Private process functions ####

async function processUnversionedObject(
    exporterClient: ExporterClient,
    root: AccessibleUnversionedObject
): Promise<void> {
    if (await exists(root.hash)) {
        return;
    }

    await fetchObjectWithChildren(exporterClient, root.hash, root.oneType);
}

async function processVersionedObject(
    exporterClient: ExporterClient,
    root: AccessibleVersionedObject
): Promise<void> {
    // TODO Superfluous? ID object should be created by storeVersionedObject?
    if (!(await exists(root.idHash))) {
        await fetchIdObjectWithChildren(exporterClient, root.idHash, root.oneType);
    }

    if (!(await exists(root.hash))) {
        await fetchObjectWithChildren(exporterClient, root.hash, root.oneType);
    }
}

async function processVersionNodes(
    exporterClient: ExporterClient,
    nodes: AccessibleVersionNode[]
): Promise<void> {
    if (nodes.length === 0) {
        return;
    }

    const nodeObjs: VersionNode[] = [];

    for (const node of nodes) {
        if (await exists(node.node)) {
            continue;
        }

        const nodeObj = await fetchObjectWithChildren(
            exporterClient,
            node.node,
            undefined,
            async obj => {
                const object = await getObject(obj.data);
                const objectIdHash = await calculateIdHashOfObj(object);

                if (node.dataIdHash !== objectIdHash) {
                    throw createError('CI-CCI1', {
                        dataIdHash: node.dataIdHash,
                        idHash: objectIdHash
                    });
                }

                const dataIdObject = await getIdObject(objectIdHash);

                if (node.dataType !== dataIdObject.$type$) {
                    throw createError('CI-CCI2', {
                        dataType: node.dataType,
                        type: dataIdObject.$type$
                    });
                }
            }
        );

        nodeObjs.push(nodeObj.obj);
    }

    if (nodeObjs.length === 0) {
        return;
    }

    const node = getLastNodeFromArray(nodeObjs);
    const data = await getObject(node.data);

    await mergeVersionWithCurrent({
        obj: data,
        idHash: await calculateIdHashOfObj(data),
        hash: node.data,
        status: CREATION_STATUS.EXISTS,
        timestamp: node.creationTime
    }, MERGE_AS.REMOTE);
}

async function processIdObject(
    exporterClient: ExporterClient,
    root: AccessibleIdObject
): Promise<void> {
    if (await exists(root.idHash)) {
        return;
    }

    MessageBus.send('log', `[${exporterClient.connId}] fetchIdObjectWithChildren: ${root.idHash}`);
    await fetchIdObjectWithChildren(exporterClient, root.idHash, root.oneType);
}

// #### Private fetch functions ####

/**
 * Fetch the object and all its children from the remote exporter.
 *
 * This will query the list of children and then iterate all of them bottom-up and store each
 * non-existing object until it reaches the root. This means that no holes in the object tree will
 * exist at any time
 *
 * @param {ExporterClient} client
 * @param {SHA256IdHash} hash
 * @param {OneObjectTypeNames} rootType
 * @param {Function} assertRootBeforeWrite
 * @returns {Promise<void>}
 */
async function fetchObjectWithChildren<T extends OneObjectTypes>(
    client: ExporterClient,
    hash: SHA256Hash<T>,
    rootType?: T['$type$'],
    assertRootBeforeWrite?: (obj: T) => Promise<void> | void
): Promise<AnyObjectCreation<T>> {
    MessageBus.send('log', `[${client.connId}] fetchObjectWithChildren: ${hash}`);

    const children = await client.getObjectChildren(hash);

    MessageBus.send(
        'debug',
        `[${client.connId}] children for ${hash}: ${JSON.stringify(children)}`
    );

    // Reverse the children list, so that the children deepest in the tree are fetched first.
    children.reverse();

    await fetchChildren(client, children);

    if (rootType === undefined) {
        return client.fetchObject(hash, async obj => {
            await assertChildrenOfObjInList(children.slice(0, children.length), obj);

            if (assertRootBeforeWrite) {
                await assertRootBeforeWrite(obj as T);
            }
        }) as Promise<AnyObjectCreation<T>>;
    } else {
        return client.fetchObjectWithType(hash, rootType, async obj => {
            await assertChildrenOfObjInList(children.slice(0, children.length), obj);

            if (assertRootBeforeWrite) {
                await assertRootBeforeWrite(obj);
            }
        });
    }
}

/**
 * Fetch the id object and all its children from the remote exporter.
 *
 * This will query the list of children and then iterate all of them bottom-up and store each
 * non-existing object until it reaches the root. This means that no holes in the object tree will
 * exist at any time
 *
 * @param {ExporterClient} client
 * @param {SHA256IdHash} idHash
 * @param {OneVersionedObjectTypeNames} rootType
 * @param {Function} assertRootBeforeWrite
 * @returns {Promise<void>}
 */
async function fetchIdObjectWithChildren<
    T extends OneVersionedObjectTypes = OneVersionedObjectTypes
>(
    client: ExporterClient,
    idHash: SHA256IdHash<T>,
    rootType?: T['$type$'],
    assertRootBeforeWrite?: (obj: T) => Promise<void> | void
): Promise<IdFileCreation<T>> {
    MessageBus.send('log', `[${client.connId}] fetchIdObjectWithChildren: ${idHash}`);

    const children = await client.getIdObjectChildren(idHash);

    MessageBus.send(
        'debug',
        `[${client.connId}] children for ${idHash}: ${JSON.stringify(children)}`
    );

    // Reverse the children list, so that the children deepest in the tree are fetched first.
    children.reverse();

    await fetchChildren(client, children);

    if (rootType === undefined) {
        return client.fetchIdObject(idHash, async obj => {
            await assertChildrenOfIdObjInList(children.slice(0, children.length), obj);

            if (assertRootBeforeWrite) {
                await assertRootBeforeWrite(obj as T);
            }
        }) as Promise<IdFileCreation<T>>;
    } else {
        return client.fetchIdObjectWithType(idHash, rootType, async obj => {
            await assertChildrenOfIdObjInList(children.slice(0, children.length), obj);

            if (assertRootBeforeWrite) {
                await assertRootBeforeWrite(obj);
            }
        });
    }
}

/**
 * Fetch the list of children from the exporter in the list order.
 *
 * @param {ExporterClient} client
 * @param {ChildObject[]} children
 * @returns {Promise<void>}
 */
async function fetchChildren(client: ExporterClient, children: ChildObject[]): Promise<void> {
    for (let i = 0; i < children.length; ++i) {
        const child = children[i];

        if (await exists(child.hash)) {
            continue;
        }

        switch (child.type) {
            case 'blob':
                await client.fetchBLOB(child.hash);
                break;
            case 'clob':
                await client.fetchCLOB(child.hash);
                break;
            case 'id': {
                await client.fetchIdObject(
                    child.hash,
                    assertChildrenOfIdObjInList.bind(undefined, children.slice(0, i))
                );
                break;
            }
            case 'object': {
                await client.fetchObject(
                    child.hash,
                    assertChildrenOfObjInList.bind(undefined, children.slice(0, i))
                );
                break;
            }
        }
    }
}

// #### Assertion functions ####

async function assertChildrenOfObjInList(list: ChildObject[], obj: OneObjectTypes): Promise<void> {
    const children = await determineChildren(obj, false);

    await Promise.all(
        children.map(async child => {
            if (!list.find(elem => child.hash === elem.hash)) {
                throw createError('CI-ACO', {dep: child.hash, obj});
            }
        })
    );
}

async function assertChildrenOfIdObjInList(
    list: ChildObject[],
    obj: OneIdObjectTypes
): Promise<void> {
    const children = await determineChildrenForIdObject(obj, false);

    await Promise.all(
        children.map(async child => {
            if (!list.find(elem => child.hash === elem.hash)) {
                throw createError('CI-ACIDO', {dep: child.hash, obj});
            }
        })
    );
}

// #### Private other stuff ####

/**
 * Waits for the remote exporter to start and compares protocol versions.
 *
 * @param {ExporterClient} client
 * @returns {Promise<void>}
 */
async function waitForRemoteExporterAndCheckProtocolVersions(
    client: ExporterClient
): Promise<void> {
    // Retries until the remote exporter registered its services
    const remoteVersion = await retry(() => client.getProtocolVersion(), {
        delay: 300,
        retries: 15,
        shouldRetry: err => err.cause?.code === UNKNOWN_SERVICE
    });

    if (remoteVersion !== PROTOCOL_VERSION) {
        MessageBus.send(
            'alert',
            `[${client.connId}] CHUM PROTOCOL MISMATCH, local: ${PROTOCOL_VERSION}, remote: ${remoteVersion}`
        );

        throw createError('CS-MISMATCH', {
            connId: client.connId,
            local: PROTOCOL_VERSION,
            remote: remoteVersion
        });
    }
}
