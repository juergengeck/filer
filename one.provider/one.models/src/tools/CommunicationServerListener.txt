import yargs from 'yargs';
import tweetnacl from 'tweetnacl';
import {decryptWithPublicKey, encryptWithPublicKey} from '@refinio/one.core/lib/instance-crypto';
import WebSocketWS from 'isomorphic-ws';
import CommunicationServerListener, {
    CommunicationServerListenerState
} from '../misc/CommunicationServerListener';
import * as Logger from '@refinio/one.core/lib/logger';
import fs from 'fs';
import readline from 'readline';
import EncryptedConnetion_Server from '../misc/EncryptedConnection_Server';
import {wslogId} from '../misc/LogUtils';
import type EncryptedConnection from '../misc/EncryptedConnection';
import type WebSocketPromiseBased from '../misc/WebSocketPromiseBased';

/**
 * Main function. This exists to be able to use await here.
 */
async function main(): Promise<void> {
    const argv =
        // Evaluate
        yargs

            // Url of communication server
            .alias('u', 'url')
            .describe('u', 'Url of communication server.')
            .default('u', 'ws://localhost:8000')

            // Spare connections
            .alias('s', 'sparecount')
            .describe('s', 'Number of spare connections to use.')
            .default('s', 1)

            // Reconnect timeout
            .describe('t', 'Reconnect timeout')
            .default('t', 5000)

            // Write public key
            .describe('p', 'Write public key to public.key file')
            .boolean('p')

            // Logger
            .describe('l', 'Enable logger')
            .boolean('l').argv;

    if (argv.l) {
        Logger.start({types: ['log']});
    }

    // Generate public / private keypair and write it to file if requested
    const keyPair = tweetnacl.box.keyPair();
    if (argv.p) {
        await new Promise<void>(resolve => {
            fs.writeFile('public.key', keyPair.publicKey, () => {
                resolve();
            });
        });
    }

    // The websocket that is connected to the console
    let consoleWs: EncryptedConnection | null = null;

    // Create commserver listener and register callbacks
    const listener = new CommunicationServerListener(argv.s, argv.t);
    listener.onChallenge((challenge: Uint8Array, pubkey: Uint8Array): Uint8Array => {
        const decryptedChallenge = decryptWithPublicKey(pubkey, challenge, keyPair.secretKey);
        for (let i = 0; i < decryptedChallenge.length; ++i) {
            decryptedChallenge[i] = ~decryptedChallenge[i];
        }
        return encryptWithPublicKey(pubkey, decryptedChallenge, keyPair.secretKey);
    });
    listener.onConnection(async (ws: WebSocketPromiseBased): Promise<void> => {
        try {
            console.log(`${wslogId(ws.webSocket)}: Accepted connection.`);
            const conn = new EncryptedConnetion_Server(ws);
            const request = await conn.waitForUnencryptedMessage('communication_request');
            if (tweetnacl.verify(request.targetPublicKey, keyPair.publicKey)) {
                // Sending to the client that we accept his connection
                console.log(`${wslogId(ws.webSocket)}: Send communication_accept message.`);
                await conn.sendCommunicationReadyMessage();

                // Release old connection
                if (consoleWs) {
                    consoleWs.webSocket.close(1000, 'New client connected');
                }

                // Setup encryption
                console.log(`${wslogId(ws.webSocket)}: Setup encryption.`);
                await conn.exchangeKeys(
                    (text): Uint8Array => {
                        return encryptWithPublicKey(
                            request.sourcePublicKey,
                            text,
                            keyPair.secretKey
                        );
                    },
                    cypher => {
                        return decryptWithPublicKey(
                            request.sourcePublicKey,
                            cypher,
                            keyPair.secretKey
                        );
                    }
                );

                // Connect the websocket to the console
                console.log(
                    `${wslogId(
                        ws.webSocket
                    )}: Connect websocket to console. You can now type stuff.`
                );
                consoleWs = conn;
                consoleWs.webSocket.addEventListener('error', e => {
                    const message =
                        (e as unknown as {message: string | undefined}) && 'unknown error';
                    console.log(message);
                });
                consoleWs.webSocket.addEventListener('close', e => {
                    if (e.reason !== 'New client connected') {
                        consoleWs = null;
                    }
                    console.log(`${wslogId(ws.webSocket)}: Connection closed: ${e.reason}`);
                });

                // Wait for messages
                while (conn.webSocket.readyState === WebSocketWS.OPEN) {
                    console.log(await conn.waitForMessage());
                }
            } else {
                conn.close('Request public key does not match this public key.');
                throw new Error('Request public key does not match this public key.');
            }
        } catch (e) {
            console.log(`${wslogId(ws.webSocket)}: ${e}`);
        }
    });

    listener.onStateChange(
        (
            newState: CommunicationServerListenerState,
            oldState: CommunicationServerListenerState
        ) => {
            console.log(`State change from '${oldState}' to '${newState}'`);
        }
    );

    // Start comm server
    listener.start(argv.u, keyPair.publicKey);

    // ######## CONSOLE I/O ########

    // Setup console for communication with the other side
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Stop everything at sigint
    function sigintHandler() {
        listener.stop();
        if (consoleWs) {
            if (consoleWs.webSocket.readyState === WebSocketWS.OPEN) {
                consoleWs.close();
            }
        }
        rl.close();
    }
    rl.on('SIGINT', sigintHandler);
    process.on('SIGINT', sigintHandler);

    // Read from stdin
    for await (const line of rl) {
        if (!consoleWs) {
            console.log('Error: Not connected to any client.');
        } else {
            // TODO: check this never error
            // @ts-ignore
            await consoleWs.sendMessage(line);
        }
    }
}

// Execute main function
main().catch(e => {
    console.log('Error happened: ' + e.toString());
});
