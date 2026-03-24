import {wait} from '@refinio/one.core/lib/util/promise.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import {createKeyPair} from '@refinio/one.core/lib/crypto/encryption.js';
import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import ConnectionRouteManager from '../../lib/misc/ConnectionEstablishment/ConnectionRouteManager.js';
import type Connection from '../../lib/misc/Connection/Connection.js';

//import {start} from '@refinio/one.core/lib/logger.js';
//start({includeTimestamp: true, types: ['log', 'debug', 'alert', 'error']});

describe.skip('CommunicationModule test', () => {
    it('simple connection', async function () {
        const client = new ConnectionRouteManager(1000);
        const server = new ConnectionRouteManager(1000);

        client.onConnection(
            (
                conn: Connection,
                localPublicKey: PublicKey,
                remotePublicKey: PublicKey,
                connectionRoutesGroupName: string,
                initiatedLocally: boolean
            ) => {
                console.log(
                    `Established client connection from ${uint8arrayToHexString(
                        localPublicKey
                    )} to ${uint8arrayToHexString(
                        remotePublicKey
                    )} with connection group ${connectionRoutesGroupName}. Connection was initiated ${
                        initiatedLocally ? 'locally' : 'remotely'
                    }.`
                );
            }
        );

        client.onConnectionViaCatchAll(
            (
                conn: Connection,
                localPublicKey: PublicKey,
                remotePublicKey: PublicKey,
                connectionRoutesGroupName: string,
                initiatedLocally: boolean
            ) => {
                console.log(
                    `Established client connection from ${uint8arrayToHexString(
                        localPublicKey
                    )} to ${uint8arrayToHexString(
                        remotePublicKey
                    )} wit connection group ${connectionRoutesGroupName} over catch-all route. Connection was initiated ${
                        initiatedLocally ? 'locally' : 'remotely'
                    }.`
                );
            }
        );

        server.onConnection(
            (
                conn: Connection,
                localPublicKey: PublicKey,
                remotePublicKey: PublicKey,
                connectionRoutesGroupName: string,
                initiatedLocally: boolean
            ) => {
                console.log(
                    `Established server connection from ${uint8arrayToHexString(
                        localPublicKey
                    )} to ${uint8arrayToHexString(
                        remotePublicKey
                    )} wit connection group ${connectionRoutesGroupName}. Connection was initiated ${
                        initiatedLocally ? 'locally' : 'remotely'
                    }.`
                );
            }
        );

        server.onConnectionViaCatchAll(
            (
                conn: Connection,
                localPublicKey: PublicKey,
                remotePublicKey: PublicKey,
                connectionRoutesGroupName: string,
                initiatedLocally: boolean
            ) => {
                console.log(
                    `Established server connection from ${uint8arrayToHexString(
                        localPublicKey
                    )} to ${uint8arrayToHexString(
                        remotePublicKey
                    )} wit connection group ${connectionRoutesGroupName} over catch-all route. Connection was initiated ${
                        initiatedLocally ? 'locally' : 'remotely'
                    }.`
                );
            }
        );

        const clientKeys = createKeyPair();
        const clientKeys2 = createKeyPair();
        const serverKeys = createKeyPair();
        const serverKeys2 = createKeyPair();

        console.log(`Key C1 ${uint8arrayToHexString(clientKeys.publicKey)}`);
        console.log(`Key C2 ${uint8arrayToHexString(clientKeys2.publicKey)}`);
        console.log(`Key S1 ${uint8arrayToHexString(serverKeys.publicKey)}`);
        console.log(`Key S2 ${uint8arrayToHexString(serverKeys2.publicKey)}`);

        client.addOutgoingWebsocketRoute(
            new CryptoApi(clientKeys).createEncryptionApiWithKeysAndPerson(serverKeys.publicKey),
            'ws://localhost:8500',
            'low_bandwidth'
        );

        /*client.addOutgoingWebsocketRoute(
            clientKeys.publicKey,
            serverKeys.publicKey,
            (otherKey, text) =>
                tweetnacl.box(
                    text,
                    new Uint8Array(tweetnacl.box.nonceLength),
                    otherKey,
                    clientKeys.secretKey
                ),
            (otherKey, cypher) => {
                const e = tweetnacl.box.open(
                    cypher,
                    new Uint8Array(tweetnacl.box.nonceLength),
                    otherKey,
                    clientKeys.secretKey
                );
                if (e === null) {
                    throw new Error('Failed to decrypt');
                }
                return e;
            },
            'ws://localhost:8500',
            'high_bandwidth',
            1000
        );*/

        server.addIncomingWebsocketRouteCatchAll_Direct(
            new CryptoApi(serverKeys),
            'localhost',
            8500
        );

        server.addIncomingWebsocketRoute_Direct(
            new CryptoApi(serverKeys),
            clientKeys.publicKey,
            'localhost',
            8500,
            'high_bandwidth'
        );

        //await client.enableRoutesForTargetAndSource(clientKeys.publicKey, serverKeys.publicKey);
        //await server.enableAllRoutesForTargetAndSource(serverKeys.publicKey,
        // clientKeys.publicKey);
        await client.enableRoutes();
        await server.enableRoutes();
        client.debugDump('client.');
        server.debugDump('server.');

        console.log('WAIT');
        await wait(5000);
        client.debugDump('client2.');
        server.debugDump('server2.');
        await server.disableRoutes();
        await client.disableRoutes();
        await wait(5000);
        client.debugDump('client3.');
        server.debugDump('server3.');
        /*console.log('Disable client routes');
        const p1 = client.disableRoutes();
        await wait(5000);
        console.log('Disable server routes');
        const p2 = server.disableRoutes();

        console.log('WAIT DONE2');
        //client.closeConnections();
        console.log('WAIT DONE3');
        //server.closeConnections();
        console.log('WAIT DONE4');
        await p1;
        await p2;*/
    }).timeout(20000);
});
