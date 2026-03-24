/**
 * Protocol that defines messages used to initiate communication / routing of connections.
 */
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type Connection from '../../Connection/Connection.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Keys, Person} from '@refinio/one.core/lib/recipes.js';
import type {Identity} from '../../IdentityExchange.js';
import {isIdentity} from '../../IdentityExchange.js';
import {isHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {OneIdObjectInterfaces} from '@OneObjectInterfaces';

// ######## Message / command definition ########

/**
 * Protocols that are supported by the StartProtocolMessage
 */
export type Protocols =
    | 'chum'
    | 'chum_onetimeauth_withtoken'
    | 'chumAndPkExchange_onetimeauth_withtoken'
    | 'chum_one_time'
    | 'pairing'
    | 'accessGroup_set';

/**
 * This request is sent by a client to request communication with somebody that has the specified public key.
 *
 * The target of this message can either be a communication server or an instance that accepts direct connections.
 */
export interface CommunicationRequestMessage {
    command: 'communication_request';
    sourcePublicKey: HexString;
    targetPublicKey: HexString;
}

/**
 * This response is sent after the final target of the communication_request message is ready to process data.
 *
 * This message exists, because after the communication_request is sent, a routing to the target needs to be
 * established, and this can take some time. This command then signals that the routing has been established. If
 * the sender of the request would immediately start sending data after the communication_request, we
 * would have to be extra careful not to loose any data while the handover is taking place.
 *
 * In short: The communication_ready message is sent by the final destination to signal 'I am ready'.
 */
export interface CommunicationReadyMessage {
    command: 'communication_ready';
}

/**
 * Message used by one side to tell the other side that a special protocol flow with a certain version shall be started.
 */
export interface StartProtocolMessage {
    command: 'start_protocol';
    protocol: Protocols;
    version: string;
}

/**
 * Message for exchanging person information like person id and keys.
 */
export interface PersonInformationMessage {
    command: 'person_information';
    personId: SHA256IdHash<Person>;
    personPublicKey: HexString;
}

/**
 * Message that transports a authentication tag.
 */
export interface AuthenticationTokenMessage {
    command: 'authentication_token';
    token: string;
}

/**
 * Message that transports a authentication tag.
 */
export interface EncryptedAuthenticationTokenMessage {
    command: 'encrypted_authentication_token';
    token: HexString;
}

/**
 * Message that transports a person object.
 */
export interface PersonObjectMessage {
    command: 'person_object';
    obj: Person;
}

/**
 * Message that transports a person id object.
 */
export interface PersonIdObjectMessage {
    command: 'person_id_object';
    obj: OneIdObjectInterfaces['Person'];
}

/**
 * Message that transports a person id object.
 */
export interface InstanceIdObjectMessage {
    command: 'instance_id_object';
    obj: OneIdObjectInterfaces['Instance'];
}

/**
 * Message that transports a key object.
 */
export interface KeysObjectMessage {
    command: 'keys_object';
    obj: Keys;
}

/**
 * Message that transports a profile object.
 */
export interface IdentityMessage {
    command: 'identity';
    obj: Identity;
}

/**
 * Message for exchanging private person information like person id and private keys.
 */
export interface PrivatePersonInformationMessage {
    command: 'private_person_information';
    personId: SHA256IdHash<Person>;
    personPublicKey: HexString;
    personPublicSignKey: HexString;
    personPrivateKey: HexString;
    personPrivateSignKey: HexString;
}

/**
 * Message that transports persons for access groups.
 */
export interface AccessGroupMembersMessage {
    command: 'access_group_members';
    persons: string[]; // these are the emails of the person objects, so that we can build the person objects from scratch
}

/**
 * Just a message that signals success.
 */
export interface SuccessMessage {
    command: 'success';
}

// ######## Message to Role (Client / Server) Mapping ########

/**
 * Those are messages that are sent by the initiator of the communication.
 */
export interface UnencryptedClientMessages {
    communication_request: CommunicationRequestMessage;
}

/**
 * Those are messages that are sent by the acceptor of the communication.
 */
export interface UnencryptedServerMessages {
    communication_ready: CommunicationReadyMessage;
}

/**
 * Those messages are sent by both peering partners (in a later stage both sides act as the same)
 */
export interface EncryptedPeerMessages {
    start_protocol: StartProtocolMessage;
    person_information: PersonInformationMessage;
    private_person_information: PrivatePersonInformationMessage;
    authentication_token: AuthenticationTokenMessage;
    encrypted_authentication_token: EncryptedAuthenticationTokenMessage;
    person_object: PersonObjectMessage;
    person_id_object: PersonIdObjectMessage;
    instance_id_object: InstanceIdObjectMessage;
    keys_object: KeysObjectMessage;
    identity: IdentityMessage;
    access_group_members: AccessGroupMembersMessage;
    success: SuccessMessage;
}

export type UnencryptedClientMessageTypes =
    UnencryptedClientMessages[keyof UnencryptedClientMessages];
export type UnenctryptedServerMessageTypes =
    UnencryptedServerMessages[keyof UnencryptedServerMessages];
export type EncryptedPeerMessageTypes = EncryptedPeerMessages[keyof EncryptedPeerMessages];

/**
 * Check whether the argument is a client message of specified type / command.
 *
 * @param arg - The argument to check
 * @param command - The command / type of the message to check against.
 * @returns
 */
export function isUnencryptedClientMessage<T extends keyof UnencryptedClientMessages>(
    arg: any,
    command: T
): arg is UnencryptedClientMessages[T] {
    if (arg.command !== command) {
        return false;
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
export function isUnencryptedServerMessage<T extends keyof UnencryptedServerMessages>(
    arg: any,
    command: T
): arg is UnencryptedServerMessages[T] {
    if (arg.command !== command) {
        return false;
    }

    if (command === 'communication_ready') {
        return true;
    }

    return false;
}

/**
 * Check whether the argument is a peer message of specified type / command.
 *
 * @param arg - The argument to check
 * @param command - The command / type of the message to check against.
 */
export function isPeerMessage<T extends keyof EncryptedPeerMessages>(
    arg: any,
    command: T
): arg is EncryptedPeerMessages[T] {
    if (arg.command !== command) {
        return false;
    }

    if (command === 'start_protocol') {
        return typeof arg.protocol === 'string' && typeof arg.version === 'string';
    }

    if (command === 'person_information') {
        return arg.personId && arg.personPublicKey; // Make this better by checking for length of person id and it being a hash
    }

    if (command === 'private_person_information') {
        return (
            typeof arg.personId === 'string' &&
            typeof arg.personPublicKey === 'string' &&
            typeof arg.personPublicSignKey === 'string' &&
            typeof arg.personPrivateKey === 'string' &&
            typeof arg.personPrivateSignKey === 'string' &&
            typeof arg.anonPersonId === 'string' &&
            typeof arg.anonPersonPublicKey === 'string' &&
            typeof arg.anonPersonPublicSignKey === 'string' &&
            typeof arg.anonPersonPrivateKey === 'string' &&
            typeof arg.anonPersonPrivateSignKey === 'string'
        );
    }

    if (command === 'authentication_token') {
        return typeof arg.token === 'string';
    }

    if (command === 'encrypted_authentication_token') {
        return typeof arg.token === 'string';
    }

    if (command === 'person_object') {
        return arg.obj && arg.obj.$type$ === 'Person';
    }

    if (command === 'person_id_object') {
        return arg.obj && arg.obj.$type$ === 'Person';
    }

    if (command === 'instance_id_object') {
        return arg.obj && arg.obj.$type$ === 'Instance';
    }

    if (command === 'keys_object') {
        return arg.obj && arg.obj.$type$ === 'Keys';
    }

    if (command === 'identity') {
        return arg.obj && isIdentity(arg.obj);
    }

    if (command === 'access_group_members') {
        if (arg && arg.persons && Array.isArray(arg.persons)) {
            for (const person of arg.persons) {
                if (typeof person !== 'string') {
                    return false;
                }
            }

            return true;
        }

        return false;
    }

    if (command === 'success') {
        return true;
    }

    return false;
}

/**
 * Send an unencrypted message (only used for setting up the encryption).
 *
 * @param connection
 * @param message - The message to send
 */
export async function sendUnencryptedServerMessage(
    connection: Connection,
    message: UnenctryptedServerMessageTypes
): Promise<void> {
    await connection.waitForOpen();
    connection.send(JSON.stringify(message));
}

/**
 * Wait for an unencrypted message (only used for setting up the encryption)
 *
 * @param connection
 * @param command - the command to wait for
 */
export async function waitForUnencryptedServerMessage<T extends keyof UnencryptedServerMessages>(
    connection: Connection,
    command: T
): Promise<UnencryptedServerMessages[T]> {
    const message = await connection.promisePlugin().waitForJSONMessageWithType(command, 'command');

    if (isUnencryptedServerMessage(message, command)) {
        return message;
    }
    throw Error("Received data does not match the data expected for command '" + command + "'");
}

/**
 * Send an unencrypted message (only used for setting up the encryption).
 *
 * @param connection
 * @param message - The message to send
 */
export async function sendUnencryptedClientMessage(
    connection: Connection,
    message: UnencryptedClientMessageTypes
): Promise<void> {
    await connection.waitForOpen();
    connection.send(JSON.stringify(message));
}

/**
 * Wait for an unencrypted message (only used for setting up the encryption)
 *
 * @param connection
 * @param command - the command to wait for
 */
export async function waitForUnencryptedClientMessage<T extends keyof UnencryptedClientMessages>(
    connection: Connection,
    command: T
): Promise<UnencryptedClientMessages[T]> {
    const message = await connection.promisePlugin().waitForJSONMessageWithType(command, 'command');

    if (isUnencryptedClientMessage(message, command)) {
        return message;
    }
    throw Error("Received data does not match the data expected for command '" + command + "'");
}

/**
 * Send a peer message
 *
 * @param conn
 * @param message - The message to send
 */
export function sendPeerMessage<T extends EncryptedPeerMessageTypes>(
    conn: Connection,
    message: T
): void {
    conn.send(JSON.stringify(message));
}

/**
 * Wait for a peer message
 *
 * @param conn
 * @param command - the command to wait for
 * @returns
 */
export async function waitForPeerMessage<T extends keyof EncryptedPeerMessages>(
    conn: Connection,
    command: T
): Promise<EncryptedPeerMessages[T]> {
    const message = await conn.promisePlugin().waitForJSONMessageWithType(command, 'command');
    if (isPeerMessage(message, command)) {
        return message;
    }
    throw Error("Received data does not match the data expected for command '" + command + "'");
}
