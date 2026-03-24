import {createWebSocket} from '../../lib/system/websocket.js';
import {isString} from '../../lib/util/type-checks-basic.js';
import type {EncryptedConnectionInterface} from '../../lib/websocket-promisifier.js';
import type {RegistrationRequestMsg} from './_communication-server.js';

let id = 0;

export async function createTestConnection(
    commServerUrl: string,
    connectionPartner: string,
    timeout: number = 120000,
    spawn?: string
): Promise<EncryptedConnectionInterface> {
    let websocket: WebSocket | null = null;
    const stateListeners: Set<(state: 'connecting' | 'open' | 'closed') => void> = new Set();
    const messageListeners: Set<(message: Uint8Array | string) => void> = new Set();

    const API = {
        id: id++,
        close: (reason?: string): void => {
            websocket?.close(isString(reason) ? 4000 : 1000, reason);
        },
        send: (message: Uint8Array | string): void => {
            websocket?.send(message);
        },
        get bufferedAmount() {
            return websocket?.bufferedAmount;
        },
        state: {
            onEnterState: {
                listen: (
                    listener: (state: 'connecting' | 'open' | 'closed') => void
                ): (() => void) => {
                    stateListeners.add(listener);
                    return () => stateListeners.delete(listener);
                }
            }
        },
        onMessage: {
            listen: (listener: (message: Uint8Array | string) => void): (() => void) => {
                messageListeners.add(listener);
                return () => messageListeners.delete(listener);
            }
        }
    } as EncryptedConnectionInterface;

    return new Promise((resolve, reject) => {
        websocket = createWebSocket(commServerUrl);

        const timeoutId = setTimeout(() => {
            websocket?.close(4012, 'Connection timeout');
            reject(new Error('Connection timeout'));
        }, timeout);

        function wrappedReject(err: Error): void {
            clearTimeout(timeoutId);
            reject(err);
        }

        websocket.binaryType = 'arraybuffer';

        websocket.onclose = () => {
            stateListeners.forEach(cb => cb('closed'));
        };

        websocket.onopen = () => {
            websocket?.send(
                JSON.stringify({
                    self: 'self',
                    other: connectionPartner,
                    spawn
                } as RegistrationRequestMsg)
            );
        };

        websocket.onerror = (_ev: Event): void => {
            wrappedReject(new Error('Unspecified error'));
            websocket?.close(4000, 'WebSocket Error');
            stateListeners.forEach(cb => cb('closed'));
        };

        websocket.onmessage = (ev: MessageEvent) => {
            // Response to the registration message sent above
            if (ev.data === '{"connected":true,"groupSize":2}') {
                clearTimeout(timeoutId);
                resolve(API);
                return;
            }

            messageListeners.forEach(cb =>
                cb(isString(ev.data) ? ev.data : new Uint8Array(ev.data))
            );
        };
    });
}
