import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import {getPublicKeys} from '@refinio/one.core/lib/keychain/key-storage-public.js';
import {createCryptoApiFromDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type LeuteModel from '../../../models/Leute/LeuteModel.js';
import type {OneInstanceEndpoint} from '../../../recipes/Leute/CommunicationEndpoints.js';
import type Connection from '../../Connection/Connection.js';
import {getLocalInstanceOfPerson} from '../../instance.js';
import {connectWithEncryption} from './EncryptedConnectionHandshake.js';
import {exchangeConnectionGroupName} from './ExchangeConnectionGroupName.js';
import {exchangeInstanceIdObjects, type InstanceId} from './ExchangeInstanceIds.js';
import {verifyAndExchangePersonId} from './ExchangePersonIds.js';
import {sync} from './Sync.js';

const MessageBus = createMessageBus('ConnectToInstanceProtocol');

export type ConnectionInfo = {
    conn: Connection;
    personInfo: {
        isNew: boolean;
        personId: SHA256IdHash<Person>;
        personPublicKey: PublicKey;
    };
    instanceInfo: {
        localInstanceId: SHA256IdHash<Instance>;
        localInstanceIdObject: InstanceId;
        remoteInstanceId: SHA256IdHash<Instance>;
        remoteInstanceIdObject: InstanceId;
    };
};

export async function connectToInstance(
    url: string,
    remotePublicEncryptionKey: PublicKey,
    leuteModel: LeuteModel,
    connectionGroupName: string,
    myPersonId?: SHA256IdHash<Person>
): Promise<ConnectionInfo> {
    if (myPersonId === undefined) {
        myPersonId = await leuteModel.myMainIdentity();
    }

    // FIX: Use instance ID for CryptoApi, not person ID
    // The invitation contains instance keys, so we must use matching instance keys here
    const myInstanceId = await getLocalInstanceOfPerson(myPersonId);
    const cryptoApi = await createCryptoApiFromDefaultKeys(myInstanceId);

    // #### Encrypted connection handshake ####
    // Other side is implemented in IncomingConnectionManager.acceptConnection

    // Connect to target
    const connInfo = await connectWithEncryption(
        url,
        cryptoApi.createEncryptionApiWithKeysAndPerson(remotePublicEncryptionKey)
    );

    const conn = connInfo.connection;

    // #### Step Connection Group Name (like 'chum' or 'video' or 'debug' ####
    // Other side is implemented in ConnectionRouteManager.acceptConnection

    MessageBus.send('log', `${conn.id}: connectUsingInvitation: exchangeConnectionGroupName`);

    await exchangeConnectionGroupName(conn, connectionGroupName);

    MessageBus.send('log', `${conn.id}: connectUsingInvitation: sync`);

    // Have a sync step (misusing the success message at the moment), so that the
    // connection initiator does not emit the event if the other side does not want to
    // connect.
    await sync(conn, true);

    // #### Step Identity exchange ####
    // Other side is implemented in LeuteConnectionModule.acceptConnection

    MessageBus.send('log', `${conn.id}: connectUsingInvitation: verifyAndExchangePersonId`);

    const personInfo = await verifyAndExchangePersonId(leuteModel, conn, myPersonId, true);

    MessageBus.send('log', `${conn.id}: connectUsingInvitation: exchangeInstanceIdObjects`);

    const instanceInfo = await exchangeInstanceIdObjects(conn, myInstanceId);

    return {conn, personInfo, instanceInfo};
}

export async function connectToInstanceWithOneInstanceEndpoint(
    oneInstanceEndpoint: OneInstanceEndpoint,
    leuteModel: LeuteModel,
    connectionGroupName: string,
    myPersonId?: SHA256IdHash<Person>
): Promise<ConnectionInfo> {
    if (oneInstanceEndpoint.url === undefined) {
        throw new Error('Url of one instance endpoint is undefined!');
    }

    return connectToInstance(
        oneInstanceEndpoint.url,
        (await getPublicKeys(oneInstanceEndpoint.instanceKeys)).publicEncryptionKey,
        leuteModel,
        connectionGroupName,
        myPersonId
    );
}
