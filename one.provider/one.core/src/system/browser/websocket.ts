/**
 * @author Maximilian Wisgickl <wisgicklma@gmail.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

/**
 * Create a WebSocket object. On react-native and browser this is a native object, on node.js a
 * package like "ws" (or "uws") is needed.
 * @internal
 * @static
 * @param {string} url
 * @returns {WebSocket}
 */
export function createWebSocket(url: string): WebSocket {
    return new WebSocket(url);
}
