export interface ConnectionMessageEvent {
    type: 'message';
    data: Uint8Array | string;
}

export interface ConnectionCloseEvent {
    type: 'close';
    reason?: string;
    terminate: boolean;
}

/*export interface PluginAttachedEvent {
    type: 'attached';
    logId: number;
    eventCreationFunctions: EventCreationFunctions;
}*/

export interface ConnectionClosedEvent {
    type: 'closed';
    reason: string;
    origin: 'local' | 'remote';
}

export interface ConnectionOpenedEvent {
    type: 'opened';
}

export type ConnectionOutgoingEvent = ConnectionMessageEvent | ConnectionCloseEvent /*|
 PluginAttachedEvent*/;

export type ConnectionIncomingEvent =
    | ConnectionMessageEvent
    | ConnectionClosedEvent
    | ConnectionOpenedEvent;

export interface EventCreationFunctions {
    createOutogingEvent(event: ConnectionOutgoingEvent): void;
    createIncomingEvent(event: ConnectionIncomingEvent): void;
}

export default abstract class ConnectionPlugin {
    public readonly name: string;
    protected id: number = -1;
    protected eventCreationFunctions: EventCreationFunctions;

    constructor(pluginName: string) {
        this.name = pluginName;
        this.eventCreationFunctions = {
            createOutogingEvent(event: ConnectionOutgoingEvent): void {
                throw new Error(`createOutgoingEvent: Plugin ${pluginName} is not attached.`);
            },
            createIncomingEvent(event: ConnectionIncomingEvent): void {
                throw new Error(`createIncomingEvent: Plugin ${pluginName} is not attached.`);
            }
        };
    }

    /**
     * This function is called when a plugin is attached.
     *
     * @param eventCreationFunctions
     * @param id
     */
    public attachedToConnection(eventCreationFunctions: EventCreationFunctions, id: number): void {
        this.eventCreationFunctions = eventCreationFunctions;
        this.id = id;
    }

    /**
     * This function is called when a message is received.
     *
     * @param event
     * @returns - The message that will be received by the app.
     */
    abstract transformIncomingEvent(event: ConnectionIncomingEvent): ConnectionIncomingEvent | null;

    /**
     * This function is called when a message is sent.
     *
     * @param event
     * @returns - The message that will be sent.
     */
    abstract transformOutgoingEvent(event: ConnectionOutgoingEvent): ConnectionOutgoingEvent | null;
}
