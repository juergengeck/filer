import {isHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {CommunicationRequestMessage} from '../protocols/CommunicationInitiationProtocolMessages.js';

/**
 * Protocol that defines messages used for communication between communication server and registering clients.
 */
// ######## Message / command definition ########

/**
 * Registers a listening connection at the comm server.
 */
export type RegisterMessage = {
    command: 'register';
    publicKey: HexString;
};

/**
 * Requests authentication from the client that is registering.
 */
export type AuthenticationRequestMessage = {
    command: 'authentication_request';
    publicKey: HexString;
    challenge: HexString;
};

/**
 * Authentication message from the client.
 */
export type AuthenticationResponseMessage = {
    command: 'authentication_response';
    response: HexString;
};

/**
 * Confirmation of successful authentication.
 *
 * If authentication was not successful, the connection is just severed.
 */
export type AuthenticationSuccessMessage = {
    command: 'authentication_success';
    pingInterval: number;
    clientIp?: string;
    clientPort?: number;
};

/**
 * Signals that an incoming connection is handed over to a registered client.
 */
export type ConnectionHandoverMessage = {
    command: 'connection_handover';
};

/**
 * Ping message used for keeping alive spare registered connections.
 */
export type PingMessage = {
    command: 'comm_ping';
};

/**
 * Pong messages used for keeping alive spare registered connections.
 */
export type PongMessage = {
    command: 'comm_pong';
};

// ######## Message to Role (Client / Server) Mapping ########

/**
 * Those are messages that are sent by the comm server client.
 */
export interface ClientMessages {
    register: RegisterMessage;
    authentication_response: AuthenticationResponseMessage;
    comm_pong: PongMessage;
    communication_request: CommunicationRequestMessage;
}

/**
 * Those are messages that are sent by the comm server.
 */
export interface ServerMessages {
    authentication_request: AuthenticationRequestMessage;
    authentication_success: AuthenticationSuccessMessage;
    connection_handover: ConnectionHandoverMessage;
    comm_ping: PingMessage;
    communication_request: CommunicationRequestMessage;
}

export type ClientMessageTypes = ClientMessages[keyof ClientMessages];
export type ServerMessageTypes = ServerMessages[keyof ServerMessages];

/**
 * Check whether the argument is a client message of specified type / command.
 *
 * @param arg - The argument to check
 * @param command - The command / type of the message to check against.
 * @returns
 */
export function isClientMessage<T extends keyof ClientMessages>(
    arg: any,
    command: T
): arg is ClientMessages[T] {
    if (arg.command !== command) {
        return false;
    }

    if (command === 'register') {
        return arg.publicKey !== undefined;
    }
    if (command === 'authentication_response') {
        return arg.response !== undefined;
    }
    if (command === 'comm_pong') {
        return true;
    }
    if (command === 'communication_request') {
        return (
            typeof arg.sourcePublicKey === 'string' &&
            isHexString(arg.sourcePublicKey) &&
            typeof arg.targetPublicKey === 'string' &&
            isHexString(arg.targetPublicKey)
        );
    }
    return false;
}

/**
 * Check whether the argument is a server message of specified type / command.
 *
 * @param arg - The argument to check
 * @param command - The command / type of the message to check against.
 * @returns
 */
export function isServerMessage<T extends keyof ServerMessages>(
    arg: any,
    command: T
): arg is ServerMessages[T] {
    if (arg.command !== command) {
        return false;
    }

    if (command === 'authentication_request') {
        return arg.publicKey !== undefined && arg.challenge !== undefined;
    }
    if (command === 'authentication_success') {
        return arg.pingInterval !== undefined;
    }
    if (command === 'connection_handover') {
        return true;
    }
    if (command === 'comm_ping') {
        return true;
    }
    if (command === 'communication_request') {
        return (
            typeof arg.sourcePublicKey === 'string' &&
            isHexString(arg.sourcePublicKey) &&
            typeof arg.targetPublicKey === 'string' &&
            isHexString(arg.targetPublicKey)
        );
    }
    return false;
}
