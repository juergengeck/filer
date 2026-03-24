export default interface ConnectionRoute {
    /**
     * Type is a string that identifies the type of the route.
     *
     * For example this is 'OutgoingWebsocketRoute' or 'IncomingWebsocketRouteDirect' ...
     */
    readonly type: string;

    /**
     * This is an id that is unique inside a connection group.
     */
    readonly id: string;

    readonly outgoing: boolean;

    readonly active: boolean;

    start(): Promise<void>;

    stop(): Promise<void>;
}
