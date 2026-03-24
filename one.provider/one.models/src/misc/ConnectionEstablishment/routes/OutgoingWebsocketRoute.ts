import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type {SymmetricCryptoApiWithKeys} from '@refinio/one.core/lib/crypto/SymmetricCryptoApi.js';
import type Connection from '../../Connection/Connection.js';
import {connectWithEncryptionUntilSuccessful} from '../protocols/EncryptedConnectionHandshake.js';
import type ConnectionRoute from './ConnectionRoute.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';

const MessageBus = createMessageBus('OutgoingWebsocketRoute');

export default class OutgoingWebsocketRoute implements ConnectionRoute {
    public static readonly staticType = 'OutgoingWebsocketRoute';
    public readonly type = OutgoingWebsocketRoute.staticType;
    public readonly id;
    public readonly outgoing = true;

    private readonly url: string;
    private readonly cryptoApi: SymmetricCryptoApiWithKeys;
    private readonly onConnect: (
        conn: Connection,
        localPublicKey: PublicKey,
        remotePublicKey: PublicKey,
        connectionRouteId: string
    ) => void;

    private stopFn: (() => void) | null = null;

    get active() {
        return this.stopFn !== null;
    }

    constructor(
        url: string,
        cryptoApi: SymmetricCryptoApiWithKeys, // Where do we decide whether to accept a connection???
        onConnect: (
            conn: Connection,
            localPublicKey: PublicKey,
            remotePublicKey: PublicKey,
            connectionRouteId: string
        ) => void
    ) {
        this.url = url;
        this.id = OutgoingWebsocketRoute.caluclateId(url);
        this.cryptoApi = cryptoApi;
        this.onConnect = onConnect;
    }

    async start(): Promise<void> {
        MessageBus.send('log', 'start');
        const stoppablePromise = connectWithEncryptionUntilSuccessful(this.url, this.cryptoApi);
        this.stopFn = () => {
            stoppablePromise.stop();
            this.stopFn = null;
        };
        stoppablePromise
            .then(conn => {
                this.stopFn = null;
                this.onConnect(
                    conn.connection,
                    conn.myKey,
                    conn.remoteKey,
                    `${this.type}:${this.url}`
                );
            })
            .catch(console.trace);
        stoppablePromise.catch(e => {
            this.stopFn = null;
        });
    }

    async stop(): Promise<void> {
        MessageBus.send('log', 'stop');
        if (this.stopFn) {
            this.stopFn();
        }
    }

    static caluclateId(url: string): string {
        return `${OutgoingWebsocketRoute.staticType}:${url}`;
    }
}
