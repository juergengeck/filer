import Watchdog from '../../Watchdog.js';
import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';
import MultiPromise from '../../MultiPromise.js';

/**
 * Check if message is a pong.
 * @param message
 */
function isPong(message: Uint8Array | string): boolean {
    try {
        if (typeof message !== 'string') {
            return false;
        }
        const messageObj = JSON.parse(message);
        return messageObj.command === 'pong';
    } catch (e) {
        return false;
    }
}

/**
 * Check if message is a ping.
 * @param message
 */
function isPing(message: Uint8Array | string): boolean {
    try {
        if (typeof message !== 'string') {
            return false;
        }
        const messageObj = JSON.parse(message);
        return messageObj.command === 'ping';
    } catch (e) {
        return false;
    }
}

export class PingPlugin extends ConnectionPlugin {
    private readonly watchdog: Watchdog;
    private readonly pingWatchdog: Watchdog;
    private waitForPong = false;
    private disablePromises = new MultiPromise<void>();

    constructor(pingInterval: number, roundTripTime: number = 2000) {
        super('ping');

        this.watchdog = new Watchdog(pingInterval + roundTripTime);
        this.pingWatchdog = new Watchdog(pingInterval);
        this.watchdog.onTimeout(() => {
            this.waitForPong = false;
            this.eventCreationFunctions.createOutogingEvent({
                type: 'close',
                reason: 'Ping: Connection timed out',
                terminate: true
            });
            this.disablePromises.resolveAll();
        });
        this.pingWatchdog.onTimeout(() => {
            this.waitForPong = true;
            this.eventCreationFunctions.createOutogingEvent({
                type: 'message',
                data: JSON.stringify({command: 'ping'})
            });
            this.disablePromises.resolveAll();
        });
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type === 'opened') {
            this.enable();
        }

        if (event.type === 'closed') {
            this.disable().catch(console.error);
        }

        if (event.type === 'message') {
            if (!this.watchdog.enabled()) {
                return event;
            }

            if (isPong(event.data)) {
                this.waitForPong = false;
                this.watchdog.restart();
                this.pingWatchdog.restart();
                this.disablePromises.resolveAll();
                return null;
            }
        }

        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        return event;
    }

    public enable() {
        this.watchdog.enable();
        this.pingWatchdog.enable();
    }

    public async disable(): Promise<void> {
        // Delay the disabling until a scheduled pong arrived
        if (this.waitForPong) {
            await this.disablePromises.addNewPromise();
        }
        this.watchdog.disable();
        this.pingWatchdog.disable();
    }
}

export class PongPlugin extends ConnectionPlugin {
    private readonly watchdog: Watchdog;

    constructor(pingInterval: number, roundTripTime: number = 2000) {
        super('pong');

        this.watchdog = new Watchdog(pingInterval + 2 * roundTripTime);
        this.watchdog.onTimeout(() => {
            this.eventCreationFunctions.createOutogingEvent({
                type: 'close',
                reason: 'Pong: Connection timed out',
                terminate: true
            });
        });
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type === 'opened') {
            this.enable();
        }

        if (event.type === 'closed') {
            this.disable();
        }

        if (event.type === 'message') {
            if (isPing(event.data)) {
                this.watchdog.restart();
                this.eventCreationFunctions.createOutogingEvent({
                    type: 'message',
                    data: JSON.stringify({command: 'pong'})
                });
                return null;
            }
        }

        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        return event;
    }

    public enable() {
        this.watchdog.enable();
    }

    public disable() {
        this.watchdog.disable();
    }
}
