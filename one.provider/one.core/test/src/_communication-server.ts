#!/usr/bin/env node
'use strict';

/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2020
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * node.js server app through which ONE app communication is forwarded between clients that
 * usually are not directly accessible
 *
 * ## Usage:
 *
 * ```
 *   node ./test/_communication-server.js [-h for help]
 * ```
 *
 * or just
 *
 * ```
 *   ./test/_communication-server.js [-h for help]
 * ```
 * @module
 */

/* eslint-disable no-console */

import type {ChildProcess} from 'child_process';
import {fork, spawn} from 'child_process';
import {openSync} from 'fs';
import {dirname, join} from 'path';
import {fileURLToPath, pathToFileURL, URL} from 'url';
import type {default as WebSocket} from 'ws';
import {WebSocketServer} from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface RegistrationRequestMsg {
    self: string;
    other: string;
    spawn?: string;
}

/**
 * Keys are the names of the communication groups and values are their respective members'
 * WebSocket objects.
 * @private
 * @type {Map<string, Set<WebSocket>>}
 */
const Groups: Map<string, Set<WebSocket>> = new Map();

const Spawns: Set<ChildProcess> = new Set();

let wss: undefined | WebSocketServer = undefined;
let verbose = true;
let logMessages = false;

function isObject(thing: unknown): thing is Record<string, any> {
    return typeof thing === 'object' && thing !== null;
}

function isString(thing: unknown): thing is string {
    return typeof thing === 'string';
}

/**
 * @private
 * @param {...*} args
 * @returns {undefined}
 */
function log(...args: unknown[]): void {
    if (verbose) {
        console.log('CommServer:', ...args);
    }
}

/**
 * @private
 * @param {string} msg
 * @returns {Error}
 */
function createRegistrationError(msg: string): Error {
    const err = new Error(msg);
    err.name = 'RegistrationError';
    return err;
}

/**
 * @private
 * @param {*} thing
 * @returns {RegistrationRequestMsg}
 * @throws {Error} Throws an error if the given thing is not an object of type
 * RegistrationRequestMsg
 */
function ensureRegistrationMsg(thing: unknown): RegistrationRequestMsg {
    if (!isObject(thing)) {
        throw createRegistrationError('Received data is not an object');
    }

    if (!isString(thing.self)) {
        throw createRegistrationError('Expected "self" to be a string"');
    }

    if (!isString(thing.other)) {
        throw createRegistrationError('Expected "other" to be a string"');
    }

    if (thing.spawn !== undefined && !isString(thing.spawn)) {
        throw createRegistrationError('Expected "spawn" to be undefined or a string"');
    }

    return thing as unknown as RegistrationRequestMsg;
}

/**
 * @private
 * @param {WebSocket} ws
 * @param {*} msg
 * @returns {undefined|string} Returns the group name or undefined
 */
function registerNewClient(ws: WebSocket, msg: unknown): void | string {
    if (!isString(msg)) {
        log('Invalid message (expected a JSON string): ' + JSON.stringify(msg));
        return ws.close(4000, 'Invalid message (expected a JSON string)');
    }

    let msgObj: RegistrationRequestMsg;

    try {
        msgObj = ensureRegistrationMsg(JSON.parse(msg));
    } catch (err) {
        log(`Closing connection because of invalid JSON: ${err.message}`);

        if (err.name === 'RegistrationError') {
            return ws.close(4001, err.message);
        }

        if (err.name === 'SyntaxError') {
            return ws.close(4001, 'Invalid JSON');
        }

        return ws.close(4001, 'Registration failed');
    }

    log(`Registration msg: ${msg}`);

    if (isString(msgObj.spawn)) {
        if (msgObj.spawn === 'Bob') {
            log('Spawning Bob');

            const p = fork('./test/build/chum-sync-bob.js', undefined, {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc']
            });

            Spawns.add(p);

            p.on('exit', () => Spawns.delete(p));

            if (!isObject(p.stdout) || !isObject(p.stderr)) {
                throw new Error('No stdout and/or stderr on Bob');
            }

            p.stderr.on('data', data => {
                const buff = Buffer.from(data);
                process.stdout.write('BOB ERROR: ' + buff.toString('utf8'));
            });

            p.stdout.on('data', data => {
                const buff = Buffer.from(data);
                // It already is console.log() output when we receive it, so just dump it to stdout
                process.stdout.write(buff.toString('utf8'));
                // If we used yet another console.log we'd have to remove the trailing newline.
                // console.log(buff.toString('utf8').replace(/\n$/, ''));
            });
        }
    }

    const groupName = [msgObj.other, msgObj.self].sort().toString();

    const currentMembers: undefined | Set<WebSocket> = Groups.get(groupName);

    if (currentMembers === undefined) {
        log(`Add 1st member to group ${groupName}`);
        Groups.set(groupName, new Set([ws]));
        // Still waiting for the 2nd group member
        return groupName;
    }

    if (currentMembers.size === 2) {
        log(`Group full: ${currentMembers.size}`);
        return ws.close(
            4001,
            // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/close
            // A human-readable string explaining why the connection is closing. This string
            // must be no longer than 123 bytes of UTF-8 text (not characters).
            'Group full (2 members)'
        );
    }

    currentMembers.add(ws);

    log(`Add member nr. ${currentMembers.size} to group ${groupName}`);

    broadcastMessageToGroup(
        groupName,
        JSON.stringify({
            connected: true,
            groupSize: currentMembers.size
        })
    );

    return groupName;
}

/**
 * @private
 * @param {string} groupName
 * @param {*} message
 * @param {WebSocket} [msgOriginWs] - The WebSocket connection through which we received the
 * message, or undefined if we ourselves are the sender
 * @returns {undefined}
 */
function broadcastMessageToGroup(
    groupName: string,
    message: string | ArrayBuffer,
    msgOriginWs?: WebSocket
): void {
    const allMemberWs: undefined | Set<WebSocket> = Groups.get(groupName);

    if (!allMemberWs) {
        throw new Error(`No member Set object for group ${groupName}`);
    }

    if (logMessages) {
        log('Broadcast: ' + (isString(message) ? message : `ArrayBuffer [${message.byteLength}]`));
    }

    for (const memberWs of allMemberWs.values()) {
        // Don't send the message to the client that sent it in the first place - unless
        // "excludeWs" is false, in which case the broadcast goes to all group members.
        if (memberWs !== msgOriginWs && memberWs.readyState === memberWs.OPEN) {
            memberWs.send(message);
        }
    }
}

function onWssError(err: Error): void {
    console.error(err);
}

/**
 * @private
 * @param {WebSocket} ws
 * @returns {undefined}
 */
function onConnection(ws: WebSocket): void {
    log('A client connected.');

    // This variable is also used as "isConnected?" (to another party) flag
    let groupName: void | string;

    let isAlive = true;

    const interval = setInterval(() => {
        if (isAlive) {
            isAlive = false;
            return ws.ping();
        }

        log(`Terminate a client in group ${groupName}.`);

        ws.terminate();
    }, 10000);

    ws.on('pong', (): void => {
        isAlive = true;
    });

    ws.onclose = () => {
        log(`Client in group "${isString(groupName) ? groupName : '[no group]'}" disconnected.`);

        clearInterval(interval);

        if (isString(groupName)) {
            const currentMembers: undefined | Set<WebSocket> = Groups.get(groupName);

            if (!currentMembers) {
                throw new Error(`No member Set object for group ${groupName}`);
            }

            currentMembers.delete(ws);

            // PARTNER_DISCONNECT, see src/websocket-promisifier.js
            currentMembers.forEach((websocket: WebSocket) => websocket.close(4002));

            if (currentMembers.size === 0) {
                Groups.delete(groupName);
            }
        }
    };

    ws.onmessage = (ev: {data: WebSocket.Data; type: string; target: WebSocket}) => {
        const message = ev.data as any;

        if (isString(groupName)) {
            broadcastMessageToGroup(groupName, message, ws);
        } else {
            groupName = registerNewClient(ws, message);
        }
    };

    ws.onerror = (ev: {error: any; message: string; type: string; target: WebSocket}): void => {
        log('Client error:', ev);
        ws.close(4003);
    };
}

/**
 * Start the communication server
 * @static
 * @param {object} [options]
 * @param {number} options.port
 * @param {boolean} [options.silent=false]
 * @param {boolean} [options.logMsgs=false]
 * @returns {undefined}
 */
export function startCommServer({
    port = 8000,
    silent = false,
    logMsgs = false
}: {
    port?: number;
    silent?: boolean;
    logMsgs?: boolean;
} = {}): void {
    verbose = !silent;
    logMessages = logMsgs;

    log(`Starting WebSocket server at ${port}`);

    wss = new WebSocketServer({port});

    wss.on('error', onWssError);

    wss.on('connection', onConnection);
}

/**
 * Stops the comm. server
 * @static
 * @returns {undefined}
 */
export function stopCommServer(): void {
    if (wss !== undefined) {
        log('Closed WebSocket server');
        wss.close();
        wss = undefined;
    }
}

const defaultServerUrl = 'ws://localhost:8000';

function printUsage(): void {
    console.log(`
Usage: node test/_communication-server.js

Options:

  h | help | -h | --help    Show this usage text.
  -b                     Start in the background and detach
  -url [URL]             Communication server url,   Default: ${defaultServerUrl}
  -silent                Do not print any console status messages
  -logMessages           Print (console) every single message event (can be a lot)
`);
}

/**
 * For command line arguments with two parts like `./script.js -name value`, when given the name
 * this function returns the value string part of the given argument, or undefined if the name
 * is not part of the argument array.
 *
 * Example of argument array:
 *
 * ```
 * $  node ./script.js -b -url localhost:8000
 * [
 *   'C:\\Program Files\\nodejs\\node.exe',
 *   'C:\\Users\\user\\path\\script.js',
 *   '-b',
 *   '-url',
 *   'localhost:8000'
 ]
 * ```
 *
 * The result of calling `getArgValue('-url')` would be 'localhost:8000'.
 * @param {string} name
 * @returns {string | void}
 */
function getArgValue(name: string): string | void {
    if (process.argv.includes(name)) {
        const value = process.argv[process.argv.findIndex(arg => arg === name) + 1];

        if (value.startsWith('-')) {
            throw new Error(
                `Parameter for argument "${name}" mssing, instead found next argument "${value}"`
            );
        }

        return value;
    }
}

// For browser tests mostly, which cannot communicate with the comm.server to shut it down after
// the tests are done and the test index.html file is closed.
// The index.html page starts an unused WebSocket connection to the special WS server. If there
// is no "pong" reaction it means there is no connection to any client, and the comm.server will
// auto-shutdown after a while.
let autoExitTimeout: NodeJS.Timeout;

function resetAutoExitTimer(): void {
    clearTimeout(autoExitTimeout);
    autoExitTimeout = setTimeout(() => {
        stop();
        log('Background comm.server auto-exit timeout, now exiting.');
        process.exit(0);
    }, 60000);
}

function onKeepAliveConnection(ws: WebSocket): void {
    log('A keep-alive client connected.');

    const interval = setInterval(() => {
        ws.ping();
    }, 5000);

    ws.on('pong', (): void => {
        resetAutoExitTimer();
    });

    ws.onclose = () => {
        log('Keep-alive client disconnected.');
        clearInterval(interval);
    };

    ws.onerror = (ev: {error: any; message: string; type: string; target: WebSocket}): void => {
        log('Keep-alive client error:', ev);
        ws.close(4003);
    };
}

// https://stackoverflow.com/q/14031763/544779
// https://stackoverflow.com/a/31562361/544779
function cleanExit(): void {
    process.exit();
}

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
process.on('SIGUSR1', cleanExit);
process.on('SIGUSR2', cleanExit);
process.on('uncaughtException', cleanExit);
process.on('unhandledRejection', cleanExit);

process.on('exit', () => {
    Spawns.forEach(child => {
        if (child.exitCode === null) {
            child.kill();
        }
    });
});

// Started from the command line?
// https://stackoverflow.com/a/68848622/544779
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (
        process.argv.includes('h') ||
        process.argv.includes('-h') ||
        process.argv.includes('help') ||
        process.argv.includes('--help')
    ) {
        printUsage();
        process.exit(0);
    }

    const commServerUrl = getArgValue('-url') || defaultServerUrl;

    verbose = !process.argv.includes('-silent');
    logMessages = process.argv.includes('-logMessages');

    const backgroundLog = join(__dirname, 'comm-server.log');

    // Executed by the PARENT
    if (process.argv.includes('-b')) {
        log('Respawning in the background (output written to PROJECT_DIR/test/comm-server.log)...');

        const outLog = process.argv.includes('-b') ? openSync(backgroundLog, 'a') : undefined;

        const subprocess = spawn(
            'node',
            [
                __filename,
                `-url ${commServerUrl}`,
                verbose ? '' : '-silent',
                logMessages ? '-logMessages' : '',
                'background' // Flag for the spawn
            ],
            {
                detached: true,
                stdio: ['ignore', outLog, outLog]
            }
        );

        // Don't wait for the spawned process to exit
        subprocess.unref();

        process.exit(0);
    }

    const {hostname, port} = new URL(commServerUrl);

    if (hostname === '' || port === '') {
        throw new Error(`No hostname or port, ${hostname}:${port}`);
    }

    if (process.argv.includes('background')) {
        // Automatic shutdown of the comm.server after a minute of not having any browser-test
        // client. It is independent of any test actually using the comm.server - the index.html
        // test page opens an otherwise unused WebSocket to a special "keep-alive ws server"
        // whose only job is to ping-pong to keep the automatic shutdown delayed with each
        // successful pong.
        const keepAliveConnection = new WebSocketServer({
            port: parseInt(port, 10) + 1
        });
        keepAliveConnection.on('connection', onKeepAliveConnection);
        log(`Spawned in the background: Keep-alive service ${commServerUrl} started`);

        resetAutoExitTimer();
    }

    startCommServer({port: parseInt(port, 10), silent: !verbose, logMsgs: logMessages});
}
