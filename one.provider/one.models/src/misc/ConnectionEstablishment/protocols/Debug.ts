import {isAccessibleBy, isIdAccessibleBy} from '@refinio/one.core/lib/accessManager.js';
import type {HashTypes} from '@refinio/one.core/lib/recipes.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {fileSize, readUTF8TextFile} from '@refinio/one.core/lib/system/storage-base.js';
import {isString} from '@refinio/one.core/lib/util/type-checks-basic.js';
import {isHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type LeuteModel from '../../../models/Leute/LeuteModel.js';
import type {OneInstanceEndpoint} from '../../../recipes/Leute/CommunicationEndpoints.js';
import type Connection from '../../Connection/Connection.js';
import {connectToInstanceWithOneInstanceEndpoint} from './ConnectToInstance.js';
import type {AccessibleObject} from './Debug/determineAccessibleHashes.js';
import {determineAccessibleObjects} from './Debug/determineAccessibleHashes.js';

export async function acceptDebugRequest(
    conn: Connection,
    remotePersonId: SHA256IdHash<Person>
): Promise<void> {
    const protocol = await waitForDebugMessage(conn, 'start_protocol');

    if (protocol.protocol === 'getAccessibleObjects') {
        if (protocol.version !== '1.0') {
            conn.close('Protocol version not supported. Only 1.0 is supported');
            return;
        }

        const accessibleObjects = await determineAccessibleObjects(remotePersonId);

        sendDebugMessage(conn, {
            type: 'accessible_objects',
            objects: accessibleObjects
        });

        conn.close('Debug protocol "getAccessibleObjects" finished');
    }

    if (protocol.protocol === 'getData') {
        if (protocol.version !== '1.0') {
            conn.close('Protocol version not supported. Only 1.0 is supported');
            return;
        }

        const request = await waitForDebugMessage(conn, 'request_data');

        // Check access
        switch (request.hashType) {
            case 'blob':
            case 'clob':
            case 'object':
                if (
                    !(await isAccessibleBy(remotePersonId, request.hash as SHA256Hash<HashTypes>))
                ) {
                    conn.close('You do not have permission to access this file');
                }
                break;
            case 'id':
                if (!(await isIdAccessibleBy(remotePersonId, request.hash as SHA256IdHash))) {
                    conn.close('You do not have permission to access this id file');
                }
                break;
        }

        // Send data
        switch (request.hashType) {
            case 'blob':
                sendDebugMessage(conn, {
                    type: 'data',
                    data: `File size: ${await fileSize(request.hash)}`
                });
                break;
            case 'clob':
            case 'id':
            case 'object':
                sendDebugMessage(conn, {
                    type: 'data',
                    data: await readUTF8TextFile(request.hash)
                });
                break;
        }

        conn.close('Debug protocol "getData" finished');
    }
}

export async function connectRequestingAccessibleObjects(
    oneInstanceEndpoint: OneInstanceEndpoint,
    leuteModel: LeuteModel,
    myPersonId?: SHA256IdHash<Person>
): Promise<AccessibleObject[]> {
    const {conn} = await connectToInstanceWithOneInstanceEndpoint(
        oneInstanceEndpoint,
        leuteModel,
        'debug',
        myPersonId
    );

    try {
        sendDebugMessage(conn, {
            type: 'start_protocol',
            protocol: 'getAccessibleObjects',
            version: '1.0'
        });

        const accessibleObjectsMessage = await waitForDebugMessage(conn, 'accessible_objects');
        return accessibleObjectsMessage.objects;
    } catch (e) {
        conn.close(e.message);
        throw e;
    }
}

export type DataRequestHashType = 'blob' | 'clob' | 'id' | 'object';
export type DataRequestHash = SHA256Hash<HashTypes> | SHA256IdHash;

export async function connectRequestingData(
    hash: DataRequestHash,
    hashType: DataRequestHashType,
    oneInstanceEndpoint: OneInstanceEndpoint,
    leuteModel: LeuteModel,
    myPersonId?: SHA256IdHash<Person>
): Promise<string> {
    const {conn} = await connectToInstanceWithOneInstanceEndpoint(
        oneInstanceEndpoint,
        leuteModel,
        'debug',
        myPersonId
    );

    try {
        sendDebugMessage(conn, {
            type: 'start_protocol',
            protocol: 'getData',
            version: '1.0'
        });

        sendDebugMessage(conn, {
            type: 'request_data',
            hashType,
            hash
        });

        const dataMessage = await waitForDebugMessage(conn, 'data');
        return dataMessage.data;
    } catch (e) {
        conn.close(e.message);
        throw e;
    }
}

// #### Low level protocol / messages ... ####

type DebugProtocols = 'getAccessibleObjects' | 'getData';
const DebugProtocolsList = ['getAccessibleObjects', 'getData'];

type StartProtocolMessage = {
    type: 'start_protocol';
    protocol: DebugProtocols;
    version: string;
};

type AccessibleObjectsMessage = {
    type: 'accessible_objects';
    objects: AccessibleObject[];
};

type RequestDataMessage = {
    type: 'request_data';
    hashType: DataRequestHashType;
    hash: DataRequestHash;
};

type DataMessage = {
    type: 'data';
    data: string;
};

export interface DebugMessages {
    start_protocol: StartProtocolMessage;
    accessible_objects: AccessibleObjectsMessage;
    request_data: RequestDataMessage;
    data: DataMessage;
}

export type DebugMessageTypes = DebugMessages[keyof DebugMessages];

/**
 * Check whether the argument is a debug message of specified type.
 *
 * @param arg - The argument to check
 * @param type - The type of the message to check against.
 */
export function isDebugMessage<T extends keyof DebugMessages>(
    arg: any,
    type: T
): arg is DebugMessages[T] {
    if (arg.type !== type) {
        return false;
    }

    if (type === 'start_protocol') {
        return DebugProtocolsList.includes(arg.protocol) && typeof arg.version === 'string';
    }

    if (type === 'accessible_objects') {
        return Array.isArray(arg.objects);
    }

    if (type === 'request_data') {
        return ['blob', 'clob', 'id', 'object'].includes(arg.hashType) && isHash(arg.hash);
    }

    if (type === 'data') {
        return isString(arg.data);
    }

    return false;
}

/**
 * Send a debug message
 *
 * @param conn
 * @param message - The message to send
 */
export function sendDebugMessage<T extends DebugMessageTypes>(conn: Connection, message: T): void {
    conn.send(JSON.stringify(message));
}

/**
 * Wait for a debug message
 *
 * @param conn
 * @param type - the command to wait for
 * @returns
 */
export async function waitForDebugMessage<T extends keyof DebugMessages>(
    conn: Connection,
    type: T
): Promise<DebugMessages[T]> {
    const message = await conn.promisePlugin().waitForJSONMessageWithType(type);

    if (isDebugMessage(message, type)) {
        return message;
    }

    throw Error(`Received data does not match the data expected for message type "${type}"`);
}
