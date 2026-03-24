import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {hexToUint8Array} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import {ensurePublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import {getPublicKeys} from '@refinio/one.core/lib/keychain/key-storage-public.js';
import {
    createCryptoApiFromDefaultKeys,
    getDefaultKeys
} from '@refinio/one.core/lib/keychain/keychain.js';
import type LeuteModel from '../../../models/Leute/LeuteModel.js';
import type Connection from '../../Connection/Connection.js';
import type {Keys, Person, PersonId} from '@refinio/one.core/lib/recipes.js';
import tweetnacl from 'tweetnacl';
import {sendPeerMessage, waitForPeerMessage} from './CommunicationInitiationProtocolMessages.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {getIdObject, storeIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';

/**
 * This process exchanges and verifies person keys.
 *
 * The verification checks the following:
 * - Does the peer have the private key to the corresponding public key
 * - Does the peer use the same key as the last time (key lookup in storage)
 *   -> skipped if skipLocalKeyCompare is true
 * - Does the person id communicated by the peer match the expected person id
 *   -> Only checked if matchRemotePersonId is specified
 *
 * @param leute
 * @param conn - The connection used to exchange this data
 * @param localPersonId - The local person id (used for getting keys)
 * @param initiatedLocally
 * @param matchRemotePersonId - It is verified that the transmitted person id matches this one.
 * @param skipLocalKeyCompare - Skips the comparision of local keys. Defaults to false. Use
 *                              with care!
 * @returns
 */
export async function verifyAndExchangePersonId(
    leute: LeuteModel,
    conn: Connection,
    localPersonId: SHA256IdHash<Person>,
    initiatedLocally: boolean,
    matchRemotePersonId?: SHA256IdHash<Person>,
    skipLocalKeyCompare?: boolean
): Promise<{
    isNew: boolean;
    personId: SHA256IdHash<Person>;
    personPublicKey: PublicKey;
}> {
    // Initialize the crypto stuff
    const crypto = await createCryptoApiFromDefaultKeys(localPersonId);

    // Exchange keys and person object
    const personIds = await exchangePersonIdObjects(conn, localPersonId);
    const keys = await exchangeDefaultKeysObjects(conn, localPersonId);

    // Sanity check the keys object
    if (keys.remotePersonKeys.owner !== personIds.remotePersonId) {
        throw new Error('Received keys object does not belong to the transmitted person id object');
    }

    // Challenge remote person keys and respond to challenge for own keys
    // The person who initiates the connection has to prove that he has the key first.
    if (initiatedLocally) {
        await challengeRespondPersonKey(conn, keys.remotePersonKey, crypto);
        await challengePersonKey(conn, keys.remotePersonKey, crypto);
    } else {
        await challengePersonKey(conn, keys.remotePersonKey, crypto);
        await challengeRespondPersonKey(conn, keys.remotePersonKey, crypto);
    }

    // Verify that the remote person id is the same as the one we have from the callback
    if (matchRemotePersonId && personIds.remotePersonId !== matchRemotePersonId) {
        throw new Error('The person id does not match the one we have on record.');
    }

    // Determine whether the remote person is new by different tests.
    let isNewPerson = true;
    let keyComparisionResult: 'nomatch' | 'exception' | 'success' = 'nomatch';
    try {
        // This will throw if person was never seen before.
        await getIdObject(personIds.remotePersonId);

        // Verify that the transmitted key matches the one we already have
        const remoteEndpoints = await leute.findAllOneInstanceEndpointsForPerson(
            personIds.remotePersonId
        );

        for (const remoteEndpoint of remoteEndpoints) {
            if (remoteEndpoint.personKeys === undefined) {
                continue;
            }

            try {
                const endpointKeys = await getPublicKeys(remoteEndpoint.personKeys);

                // The person is known when we have a single key for that person
                // TODO: Think about only using trusted keys in order to prevent DOS attacks by
                // distributing fake profiles with fake keys
                isNewPerson = false;

                if (tweetnacl.verify(keys.remotePersonKey, endpointKeys.publicEncryptionKey)) {
                    keyComparisionResult = 'success';
                    break;
                }
            } catch (_e) {
                keyComparisionResult = 'exception';
                break;
            }
        }
    } catch (_e) {
        // This should only happen if the getIdObject fails which means that we have a new person
        // isNewPerson is set to 'true' by default, so we do not have to do anything
    }

    // Throw error when key comparison failed.
    if (keyComparisionResult === 'exception') {
        throw new Error(`Failed to load keys object for person ${personIds.remotePersonId}`);
    }

    if (!isNewPerson && keyComparisionResult === 'nomatch' && !skipLocalKeyCompare) {
        throw new Error('Key does not match your previous visit');
    }

    if (isNewPerson) {
        await storeIdObject(personIds.remotePersonIdObject);

        // We somehow have to define that we trust in this key and probably store it in a
        // default profile in leute ...
        // await storeUnversionedObject(keys.remotePersonKeys);
    }

    return {
        isNew: isNewPerson,
        personId: personIds.remotePersonId,
        personPublicKey: keys.remotePersonKey
    };
}

/**
 * Exchange default key objects with the other side.
 *
 * @param conn
 * @param localPersonId
 */
async function exchangeDefaultKeysObjects(
    conn: Connection,
    localPersonId: SHA256IdHash<Person>
): Promise<{
    localPersonKeys: Keys;
    localPersonKey: PublicKey;
    remotePersonKeys: Keys;
    remotePersonKey: PublicKey;
}> {
    // Get my own person key
    const localPersonKeysHash = await getDefaultKeys(localPersonId);
    const localPersonKeys = await getObject(localPersonKeysHash);
    const localPersonKey = ensurePublicKey(hexToUint8Array(localPersonKeys.publicKey));

    // Exchange person keys
    sendPeerMessage(conn, {
        command: 'keys_object',
        obj: localPersonKeys
    });
    const remotePersonKeys = (await waitForPeerMessage(conn, 'keys_object')).obj;
    const remotePersonKey = ensurePublicKey(hexToUint8Array(remotePersonKeys.publicKey));

    return {
        localPersonKeys,
        localPersonKey,
        remotePersonKeys,
        remotePersonKey
    };
}

/**
 * Exchange person-id objects with the other side.
 *
 * @param conn
 * @param localPersonId
 */
async function exchangePersonIdObjects(
    conn: Connection,
    localPersonId: SHA256IdHash<Person>
): Promise<{
    localPersonId: SHA256IdHash<Person>;
    localPersonIdObject: PersonId;
    remotePersonId: SHA256IdHash<Person>;
    remotePersonIdObject: PersonId;
}> {
    const localPersonIdObject = await getIdObject(localPersonId);
    sendPeerMessage(conn, {
        command: 'person_id_object',
        obj: localPersonIdObject
    });
    const remotePersonIdObject = (await waitForPeerMessage(conn, 'person_id_object')).obj;
    const remotePersonId = await calculateIdHashOfObj(remotePersonIdObject);

    return {
        localPersonId,
        localPersonIdObject,
        remotePersonId,
        remotePersonIdObject
    };
}

/**
 * Challenge the remote peer for proving that he has the private key
 *
 * @param conn
 * @param remotePersonPublicKey
 * @param crypto
 */
async function challengePersonKey(
    conn: Connection,
    remotePersonPublicKey: PublicKey,
    crypto: CryptoApi
): Promise<void> {
    // Send the challenge
    const challenge = tweetnacl.randomBytes(64);
    const encryptedChallenge = crypto.encryptAndEmbedNonce(challenge, remotePersonPublicKey);
    conn.send(encryptedChallenge);
    for (let i = 0; i < challenge.length; ++i) {
        challenge[i] = ~challenge[i];
    }

    // Wait for response
    const encryptedResponse = await conn.promisePlugin().waitForBinaryMessage();
    const response = crypto.decryptWithEmbeddedNonce(encryptedResponse, remotePersonPublicKey);
    if (!tweetnacl.verify(challenge, response)) {
        conn.close();
        throw new Error('Failed to authenticate connection.');
    }
}

/**
 * Wait for a challenge and prove that we have the private key.
 *
 * @param conn
 * @param remotePersonPublicKey
 * @param crypto
 */
async function challengeRespondPersonKey(
    conn: Connection,
    remotePersonPublicKey: PublicKey,
    crypto: CryptoApi
): Promise<void> {
    // Wait for challenge
    const encryptedChallenge = await conn.promisePlugin().waitForBinaryMessage();
    const challenge = crypto.decryptWithEmbeddedNonce(encryptedChallenge, remotePersonPublicKey);
    for (let i = 0; i < challenge.length; ++i) {
        challenge[i] = ~challenge[i];
    }
    const encryptedResponse = crypto.encryptAndEmbedNonce(challenge, remotePersonPublicKey);
    conn.send(encryptedResponse);
}
