import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import type ConnectionRoute from './ConnectionRoute.js';
import IncomingConnectionManager from '../IncomingConnectionManager.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('IncomingWebsocketRouteDirect');

export default class IncomingWebsocketRouteDirect implements ConnectionRoute {
    public readonly type = 'IncomingWebsocketRouteDirect';
    public readonly id;
    public readonly outgoing = false;

    private readonly incomingConnectionManager: IncomingConnectionManager;
    private readonly host: string;
    private readonly port: number;
    private readonly cryptoApi: CryptoApi;
    private readonly onConnectionUserArg?: unknown;

    private stopFn: (() => Promise<void>) | null = null;

    get active() {
        return this.stopFn !== null;
    }

    constructor(
        incomingConnectionManager: IncomingConnectionManager,
        host: string,
        port: number,
        cryptoApi: CryptoApi // Where do we decide whether to accept a connection???
    ) {
        this.incomingConnectionManager = incomingConnectionManager;
        this.host = host;
        this.port = port;
        this.id = IncomingConnectionManager.directConnectionListenerId(host, port, this.type);
        this.cryptoApi = cryptoApi;
    }

    async start(): Promise<void> {
        MessageBus.send('log', 'start');
        this.stopFn = await this.incomingConnectionManager.listenForDirectConnections(
            this.host,
            this.port,
            this.cryptoApi,
            this.type
        );
    }

    async stop(): Promise<void> {
        MessageBus.send('log', 'stop');
        if (this.stopFn) {
            await this.stopFn();
            this.stopFn = null;
        }
    }
}
