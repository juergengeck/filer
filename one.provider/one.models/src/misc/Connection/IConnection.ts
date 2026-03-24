import type {OEvent} from '../OEvent.js';

export interface IConnection {
    onMessage: OEvent<(message: Uint8Array | string) => void>;

    send(data: Uint8Array | string): void;

    close(reason?: string): void;

    terminate(reason?: string): void;
}
