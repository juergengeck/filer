/**
 * @author Maximilian Wisgickl <wisgicklma@gmail.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import {ensurePlatformLoaded} from './platform.js';

/* eslint-disable @typescript-eslint/no-unused-vars, jsdoc/require-returns-check */

/**
 * @private
 * @module
 */

type WsBrowser = typeof import('./browser/websocket.js');
type WsNode = typeof import('./nodejs/websocket.js');

let WS: WsBrowser | WsNode;

export function setPlatformForWs(exports: WsBrowser | WsNode): void {
    WS = exports;
}

/**
 * Create a WebSocket object. On react-native and browser this is a native object, on node.js a
 * package like "ws" (or "uws") is needed.
 * @static
 * @param {string} url
 * @returns {WebSocket}
 */
export function createWebSocket(url: string): WebSocket {
    ensurePlatformLoaded();
    return WS.createWebSocket(url);
}

/**
 * Create a WebSocket server (Node.js only).
 * @static
 * @param {number} port
 * @param {string} host
 * @returns {any} WebSocketServer
 */
export function createWebSocketServer(port: number, host: string = 'localhost'): any {
    ensurePlatformLoaded();
    if (!('createWebSocketServer' in WS)) {
        throw new Error('WebSocket server is only available in Node.js');
    }
    return (WS as WsNode).createWebSocketServer(port, host);
}
