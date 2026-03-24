import Watchdog from '../../Watchdog.js';
import type {ConnectionIncomingEvent, ConnectionOutgoingEvent} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';
import {escapeKeyword, unescapeKeyword} from '../../escapeKeywords.js';

const KEEPALIVE_MESSAGE = 'keepalive';

/**
 * This plugin generates keep alive pulses and detects if it gets any from the other side.
 *
 * If nothing is received from the other side for a specified amount of time this class will
 * terminate the connection.
 */
export class KeepAlivePlugin extends ConnectionPlugin {
    private readonly sendPulseWatchdog: Watchdog;
    private readonly detectPulseWatchdog: Watchdog;

    constructor(keepaliveTimer: number, keepaliveTimeout: number) {
        super('keepalive');

        this.sendPulseWatchdog = new Watchdog(keepaliveTimer);
        this.sendPulseWatchdog.onTimeout(() => {
            this.eventCreationFunctions.createOutogingEvent({
                type: 'message',
                data: KEEPALIVE_MESSAGE
            });
            this.sendPulseWatchdog.restart();
        });

        this.detectPulseWatchdog = new Watchdog(keepaliveTimeout);
        this.detectPulseWatchdog.onTimeout(() => {
            this.eventCreationFunctions.createOutogingEvent({
                type: 'close',
                reason: 'Keepalive: No lifesign of the other side',
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

        if (event.type !== 'message') {
            return event;
        }

        // Reset the keepalive detector on every message
        if (this.detectPulseWatchdog.enabled()) {
            this.detectPulseWatchdog.restart();
        }

        if (event.data === KEEPALIVE_MESSAGE) {
            return null;
        }

        // Unmask string values
        if (typeof event.data === 'string') {
            return {
                type: 'message',
                data: unescapeKeyword(KEEPALIVE_MESSAGE, event.data)
            };
        }

        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        if (event.type !== 'message') {
            return event;
        }

        if (this.sendPulseWatchdog.enabled()) {
            this.sendPulseWatchdog.restart();
        }

        // We need to escape the 'keepalive' message so that if somebody sends the
        // string 'keepalive' it isn't swallowed by the keepalive plugin on the other side.
        if (typeof event.data === 'string') {
            return {
                type: 'message',
                data: escapeKeyword(KEEPALIVE_MESSAGE, event.data)
            };
        }

        return event;
    }

    public enable() {
        this.sendPulseWatchdog.enable();
        this.detectPulseWatchdog.enable();
    }

    public disable() {
        this.sendPulseWatchdog.disable();
        this.detectPulseWatchdog.disable();
    }
}
