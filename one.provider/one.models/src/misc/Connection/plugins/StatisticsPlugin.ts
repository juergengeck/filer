import type {
    ConnectionClosedEvent,
    ConnectionIncomingEvent,
    ConnectionOutgoingEvent
} from '../ConnectionPlugin.js';
import ConnectionPlugin from '../ConnectionPlugin.js';

export type ConnectionStatistics = {
    bytesSent: number;
    bytesReceived: number;
    openTime?: number;
    closeTime?: number;
    closeEvent?: ConnectionClosedEvent;
};

/**
 * This class implements an encrypted connection.
 *
 * The key negotiation is done by derived classes, because depending on the
 * side of the conversation (client: initiator of the connection / server:
 * acceptor of the connection) the key exchange procedure changes.
 */
export default class StatisticsPlugin extends ConnectionPlugin {
    private internalStatistics: ConnectionStatistics = {
        bytesReceived: 0,
        bytesSent: 0
    };

    get statistics(): ConnectionStatistics {
        return {...this.internalStatistics};
    }

    /**
     * Creates a statistics layer that counts bytes.
     */
    constructor() {
        super('statistics');
    }

    public transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        // String data is sent as UTF-8 over the wire, so we have to transform string messages to
        // UTF-8 to estimate the size.
        if (event.type === 'message') {
            const data =
                typeof event.data === 'string' ? new TextEncoder().encode(event.data) : event.data;
            this.internalStatistics.bytesReceived += data.byteLength;
        }

        if (event.type === 'opened') {
            this.internalStatistics.openTime = Date.now();
        }

        if (event.type === 'closed') {
            if (this.internalStatistics.closeTime === undefined) {
                this.internalStatistics.closeTime = Date.now();
                this.internalStatistics.closeEvent = event;
            }
        }

        return event;
    }

    public transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        // String data is sent as UTF-8 over the wire, so we have to transform string messages to
        // UTF-8 to estimate the size.
        if (event.type === 'message') {
            const data =
                typeof event.data === 'string' ? new TextEncoder().encode(event.data) : event.data;
            this.internalStatistics.bytesSent += data.byteLength;
        }

        if (event.type === 'close') {
            this.internalStatistics.closeTime = Date.now();
            this.internalStatistics.closeEvent = {
                type: 'closed',
                reason: `${event.reason || 'no reason given'} -> ${
                    event.terminate ? 'terminated' : 'regular close'
                }`,
                origin: 'local'
            };
        }

        return event;
    }
}
