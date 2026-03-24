import ConnectionPlugin from '../ConnectionPlugin.js';
import type {ConnectionIncomingEvent, ConnectionOutgoingEvent, EventCreationFunctions} from '../ConnectionPlugin.js';

/**
 * NetworkPlugin - Simple network transport plugin
 */
export default class NetworkPlugin extends ConnectionPlugin {
    private messageCount = 0;

    constructor() {
        super('network');
    }

    attachedToConnection(eventCreationFunctions: EventCreationFunctions, id: number): void {
        super.attachedToConnection(eventCreationFunctions, id);
    }

    transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null {
        if (event.type === 'message') {
            this.messageCount++;
        }
        return event;
    }

    transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null {
        return event;
    }


} 