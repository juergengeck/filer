import {expect} from 'chai';
import {WebSocketServer} from 'ws';
import {createWebSocket} from '@refinio/one.core/lib/system/websocket.js';
import Connection from '../../lib/misc/Connection/Connection.js';
import EncryptionPlugin from '../../lib/misc/Connection/plugins/EncryptionPlugin.js';
import tweetnacl from 'tweetnacl';
import PromisePlugin from '../../lib/misc/Connection/plugins/PromisePlugin.js';
import {PingPlugin, PongPlugin} from '../../lib/misc/Connection/plugins/PingPongPlugin.js';
import {wait} from '@refinio/one.core/lib/util/promise.js';
import WebSocketServerPromiseBased from '../../lib/misc/ConnectionEstablishment/webSockets/WebSocketServerPromiseBased.js';
//import {start} from '@refinio/one.core/lib/logger.js';
//start({includeTimestamp: true});

describe('Connection test', () => {
    let webSocketServer: WebSocketServerPromiseBased;
    let connClient: Connection;
    let connServer: Connection;

    beforeEach('Setup connections', async function () {
        // Create the server
        webSocketServer = new WebSocketServerPromiseBased(new WebSocketServer({port: 8080}));

        // Setup connections
        connClient = new Connection(createWebSocket('ws://localhost:8080'));
        await connClient.waitForOpen();
        connServer = new Connection(await webSocketServer.waitForConnection());
        await connServer.waitForOpen();
    });

    afterEach('Shutdown Connections', async function () {
        connClient.close();
        connServer.close();
        await new Promise<void>((resolve, reject) => {
            if (webSocketServer.webSocketServer) {
                webSocketServer.webSocketServer.close((err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    });

    it('simple connection', async function () {
        const pClientMessage = new Promise(resolve => {
            connClient.onMessage(msg => {
                resolve(msg);
            });
        });
        const pServerMessage = new Promise(resolve => {
            connServer.onMessage(msg => {
                resolve(msg);
            });
        });
        connClient.send('HELLO Server!');
        connServer.send('HELLO Client!');
        expect(await pClientMessage).to.be.equal('HELLO Client!');
        expect(await pServerMessage).to.be.equal('HELLO Server!');
    });

    it('simple connection with encryption', async function () {
        const sharedKey = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);

        connClient.addPlugin(new EncryptionPlugin(sharedKey, true));
        connServer.addPlugin(new EncryptionPlugin(sharedKey, false));

        const pClientMessage = new Promise(resolve => {
            connClient.onMessage(msg => {
                resolve(msg);
            });
        });
        const pServerMessage = new Promise(resolve => {
            connServer.onMessage(msg => {
                resolve(msg);
            });
        });
        connClient.send('HELLO Server!');
        connServer.send('HELLO Client!');
        expect(await pClientMessage).to.be.equal('HELLO Client!');
        expect(await pServerMessage).to.be.equal('HELLO Server!');
    });

    it('promise plugin', async function () {
        const sharedKey = tweetnacl.randomBytes(tweetnacl.secretbox.keyLength);

        connClient.addPlugin(new PromisePlugin());
        connServer.addPlugin(new PromisePlugin());
        connClient.send('HELLO Server!');
        connServer.send('HELLO Client!');
        expect(await connClient.promisePlugin().waitForStringMessage()).to.be.equal(
            'HELLO Client!'
        );
        expect(await connServer.promisePlugin().waitForStringMessage()).to.be.equal(
            'HELLO Server!'
        );
    });
});

describe('Connection test - with promises', () => {
    let webSocketServer: WebSocketServerPromiseBased;
    let connClient: Connection;
    let connServer: Connection;

    beforeEach('Setup connections', async function () {
        // Create the server
        webSocketServer = new WebSocketServerPromiseBased(new WebSocketServer({port: 8080}));

        // Setup connections
        connClient = new Connection(createWebSocket('ws://localhost:8080'));
        connClient.addPlugin(new PromisePlugin(10, 500));
        await connClient.waitForOpen();
        connServer = new Connection(await webSocketServer.waitForConnection());
        connServer.addPlugin(new PromisePlugin(10, 500));
        await connServer.waitForOpen();
    });

    afterEach('Shutdown Connections', async function () {
        connClient.close();
        connServer.close();
        await new Promise<void>((resolve, reject) => {
            if (webSocketServer.webSocketServer) {
                webSocketServer.webSocketServer.close((err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    });

    it('tests waitForMessage: no failures in 4 messages', async function () {
        connClient.send('DATA1');
        expect(await connServer.promisePlugin().waitForMessage()).to.be.equal('DATA1');
        connClient.send('DATA2');
        expect(await connServer.promisePlugin().waitForMessage()).to.be.equal('DATA2');

        connServer.send('DATA3');
        expect(await connClient.promisePlugin().waitForMessage()).to.be.equal('DATA3');
        connServer.send('DATA4');
        expect(await connClient.promisePlugin().waitForMessage()).to.be.equal('DATA4');
    });

    it('tests waitForMessage: wait for message timeout', async function () {
        try {
            await connServer.promisePlugin().waitForMessage();
            expect.fail('Should not succeed');
        } catch (e) {
            expect(e.toString()).to.not.be.equal(undefined);
        }

        try {
            await connServer.promisePlugin().waitForMessage(100);
            expect.fail('Should not succeed');
        } catch (e) {
            expect(e.toString()).to.not.be.equal(undefined);
        }
    });

    it('tests waitForMessageWitType: no failures in two messages', async function () {
        const message1 = {
            type: 'mytype1',
            message: 'XYZ'
        };
        connClient.send(JSON.stringify(message1));
        expect(await connServer.promisePlugin().waitForJSONMessageWithType('mytype1')).to.be.eql(
            message1
        );

        const message2 = {
            type: 'mytype2',
            message: 'ABC'
        };
        connClient.send(JSON.stringify(message2));
        expect(await connServer.promisePlugin().waitForJSONMessageWithType('mytype2')).to.be.eql(
            message2
        );
    });

    it('tests waitForMessageWitType: wrong type', async function () {
        const message1 = {
            type: 'mytype1',
            message: 'XYZ'
        };
        connClient.send(JSON.stringify(message1));

        try {
            await connServer.promisePlugin().waitForJSONMessageWithType('mytype2');
            expect.fail('Should not succeed');
        } catch (e) {
            expect(e.toString()).to.be.match(/Received unexpected type/);
        }
    });
});

describe('Connection test - with promises', () => {
    let webSocketServer: WebSocketServerPromiseBased;
    let connClient: Connection;
    let connServer: Connection;

    beforeEach('Setup connections', async function () {
        // Create the server
        webSocketServer = new WebSocketServerPromiseBased(new WebSocketServer({port: 8080}));

        // Setup connections
        connClient = new Connection(createWebSocket('ws://localhost:8080'));
        connClient.addPlugin(new PongPlugin(500, 100));
        connClient.addPlugin(new PromisePlugin());
        await connClient.waitForOpen();
        connServer = new Connection(await webSocketServer.waitForConnection());
        connServer.addPlugin(new PingPlugin(500, 100));
        connServer.addPlugin(new PromisePlugin());
        await connServer.waitForOpen();
    });

    afterEach('Shutdown Connections', async function () {
        connClient.close();
        connServer.close();
        await new Promise<void>((resolve, reject) => {
            if (webSocketServer.webSocketServer) {
                webSocketServer.webSocketServer.close((err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            }
        });
    });

    it('client should close because server ping pong is not enabled', async function () {
        await connServer.pingPlugin().disable();
        expect(connClient.state.currentState).to.be.equal('open');
        await wait(1000);
        expect(connClient.state.currentState).not.to.be.equal('open');
    });

    it('server should close because client ping pong is not enabled', async function () {
        connClient.pongPlugin().disable();
        expect(connServer.state.currentState).to.be.equal('open');
        await wait(1000);
        expect(connServer.state.currentState).not.to.be.equal('open');
    });

    /*it('should be alive trough Ping/Pong running', async function () {
        // close both current connections
        if (connClient.webSocket) {
            connClient.webSocket.close();
        }
        if (connServer.webSocket) {
            connServer.webSocket.close();
        }

        // setup con with 3000ms ping interval
        connClient = new WebSocketPromiseBased(
            createWebSocket('ws://localhost:8080'),
            undefined,
            500,
            250
        );
        await connClient.waitForOpen();

        // Start a connServer connection to answer the pings.
        // This should lead to the connClient still being alive after the 5000ms wait
        connServer = new WebSocketPromiseBased(await webSocketServer.waitForConnection());
        await connServer.waitForOpen();

        // Would force connClient into Pong Timeout if no connServer connection existed
        await wait(1000);

        if (connClient.webSocket) {
            // 1 means open
            expect(connClient.webSocket.readyState === 1);
        }
    });*/
});
