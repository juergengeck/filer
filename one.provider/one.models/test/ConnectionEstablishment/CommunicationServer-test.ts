import {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import CommunicationServer from '../../lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';
import CommunicationServerListener, {
    CommunicationServerListenerState
} from '../../lib/misc/ConnectionEstablishment/communicationServer/CommunicationServerListener.js';
import tweetnacl from 'tweetnacl';
import WebSocket from 'isomorphic-ws';
import {expect} from 'chai';
import {wait} from '@refinio/one.core/lib/util/promise.js';
import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import Connection from '../../lib/misc/Connection/Connection.js';
import PromisePlugin from '../../lib/misc/Connection/plugins/PromisePlugin.js';
import {createKeyPair} from '@refinio/one.core/lib/crypto/encryption.js';

/*import * as Logger from '@refinio/one.core/lib/logger.js';
Logger.start();*/

/**
 * Test for testing the communication server.
 *
 * TODO: As you can see it is quite an effort to setup a simple connection for talking to the comm server.
 *       The reason seems to be, that the protocol for speaking with the server is not isolated good enough in a
 *       separate class. This can be seen  for the 'communication_request' message. There are two functions that
 *       format it right: EncryptedConnection_Client and CommunicationServerConnection_Server have a
 *       sendCommunicationRequestMessage, but they don't really fit for this task, so you have to do it manually
 *       bypassing the type checks for this command.
 *       This should be cleaned up so that it is easier to understand the code of the low level tests!
 */
describe('communication server tests', () => {
    let commServer: CommunicationServer | null = null;

    before('Start comm server', async () => {
        commServer = new CommunicationServer();
        await commServer.start('localhost', 8080);
    });

    // todo needs fixing why isn't it closing
    after(async () => {
        if (commServer) {
            return await commServer.stop();
        }
    });

    it('Register client open connection to commserver and exchange messages', async function () {
        // Setup the listening connection - it mirrors the messages back
        let listenerFailure: any = null;
        const listenerKeyPair = createKeyPair();
        const cryptoApi = new CryptoApi(listenerKeyPair);
        const commServerListener = new CommunicationServerListener(cryptoApi, 1, 1000);
        commServerListener.onConnection(async (connection: Connection) => {
            if (connection.websocketPlugin().webSocket === null) {
                throw new Error('ws.webSocket is null');
            }
            try {
                while (connection.websocketPlugin().webSocket!.readyState === WebSocket.OPEN) {
                    connection.send(await connection.promisePlugin().waitForMessage(1000));
                }
            } catch (e) {
                // This will also fail on a closing connection, but this is okay, because the listenerFailure
                // will only be evaluated before the closing of connections happens.
                listenerFailure = e;
            }
        });
        commServerListener.start('ws://localhost:8080');

        try {
            // Wait until the state changes to listening.
            let retryCount = 0;
            while (commServerListener.state !== CommunicationServerListenerState.Listening) {
                await wait(500);
                ++retryCount;
                if (++retryCount >= 5) {
                    throw new Error('Registering at comm server timed out.');
                }
            }

            // Setup outgoing connection and send something
            const clientKeyPair = tweetnacl.box.keyPair();
            const clientConn = new Connection(createWebSocket('ws://localhost:8080'));
            clientConn.addPlugin(new PromisePlugin());

            try {
                await clientConn.waitForOpen(1000);

                // MESSAGE1 SEND: Send the communication request message that will tell the comm server where to forward the connection to
                clientConn.send(
                    JSON.stringify({
                        command: 'communication_request',
                        sourcePublicKey: uint8arrayToHexString(clientKeyPair.publicKey),
                        targetPublicKey: uint8arrayToHexString(listenerKeyPair.publicKey)
                    })
                );

                // MESSAGE1 RECEIVE: Wait for the mirrored communication request message
                const msg1 = await clientConn.promisePlugin().waitForJSONMessage(1000);
                expect(msg1.command).to.be.equal('communication_request');
                expect(msg1.sourcePublicKey).to.be.equal(
                    uint8arrayToHexString(clientKeyPair.publicKey)
                );
                expect(msg1.targetPublicKey).to.be.equal(
                    uint8arrayToHexString(listenerKeyPair.publicKey)
                );

                // MESSAGE2 SEND:
                clientConn.send('Hello Friend!');

                // MESSAGE2 RECEIVE:
                const msg2 = await clientConn.promisePlugin().waitForMessage();
                expect(msg2).to.be.equal('Hello Friend!');

                // Check if the listener had any errors
                expect(listenerFailure).to.be.null;
            } finally {
                // Cleanup of everything
                clientConn.close();
            }
        } finally {
            commServerListener.stop();
        }
    }).timeout(10000);
});
