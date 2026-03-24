import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import {castToLocalPublicKey} from '../ConnectionRoutesGroupMap.js';
import type ConnectionRoute from './ConnectionRoute.js';
import IncomingConnectionManager from '../IncomingConnectionManager.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('IncomingWebsocketRouteCommServer');

export default class IncomingWebsocketRouteCommServer implements ConnectionRoute {
    public readonly type = 'IncomingWebsocketRouteCommServer';
    public readonly id;
    public readonly outgoing = false;

    private readonly incomingConnectionManager: IncomingConnectionManager;
    private readonly commServerUrl: string;
    private readonly cryptoApi: CryptoApi;
    private readonly onConnectionUserArg?: unknown;

    private stopFn: (() => Promise<void>) | null = null;

    get active() {
        return this.stopFn !== null;
    }

    constructor(
        incomingConnectionManager: IncomingConnectionManager,
        commServerUrl: string,
        cryptoApi: CryptoApi
    ) {
        this.incomingConnectionManager = incomingConnectionManager;
        this.commServerUrl = commServerUrl;
        this.cryptoApi = cryptoApi;
        this.id = IncomingConnectionManager.communicationServerListenerId(
            commServerUrl,
            castToLocalPublicKey(cryptoApi.publicEncryptionKey),
            this.type
        );
    }

    async start(): Promise<void> {
        MessageBus.send('log', 'start');
        this.stopFn = await this.incomingConnectionManager.listenForCommunicationServerConnections(
            this.commServerUrl,
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
