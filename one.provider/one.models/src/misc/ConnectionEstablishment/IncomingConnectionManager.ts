import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import {OEvent} from '../../misc/OEvent.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {getOrCreate} from '../../utils/MapUtils.js';
import type {MapValueType} from '../../utils/MapUtils.js';
import CommunicationServerListener, {
    CommunicationServerListenerState
} from './communicationServer/CommunicationServerListener.js';
import Connection from '../../misc/Connection/Connection.js';
import {acceptWithEncryption} from './protocols/EncryptedConnectionHandshake.js';
import WebSocketServer from './webSockets/WebSocketServer.js';

const MessageBus = createMessageBus('IncomingConnectionManager');

declare type CommServerUrl = string & {
    _1: 'CommServerUrl';
};

declare type LocalPublicKey = HexString & {
    _1: 'LocalPublicKey';
};

declare type HostPort = string & {
    _: 'HostPort';
};

function castToCommServerUrl(commServerUrl: string): CommServerUrl {
    return commServerUrl as CommServerUrl;
}

function castToLocalPublicKey(localPublicKey: PublicKey): LocalPublicKey {
    return uint8arrayToHexString(localPublicKey) as LocalPublicKey;
}

function castToHostPort(host: string, port: number): HostPort {
    return `${host}:${port}` as HostPort;
}

type CommServerListenerInfo = {
    listener: CommunicationServerListener;
    referenceCount: number;
};

type WebSocketListenerInfo = {
    listener: WebSocketServer;
    registeredPublicKeys: Map<
        LocalPublicKey,
        {
            referenceCount: number;
            cryptoApi: CryptoApi;
        }
    >;
};

/**
 * This class manages and authenticates incoming connections.
 *
 * This class also ensures, that there aren't multiple listeners listening on the same socket,
 * which would lead to errors.
 */
export default class IncomingConnectionManager {
    /**
     * Event is emitted when E2E connection is setup correctly. The event will pass the connection to the listener.
     */
    public onConnection = new OEvent<
        (
            conn: Connection,
            localPublicKey: PublicKey,
            remotePublicKey: PublicKey,
            listenerId: string // Id to be able to identify listeners
        ) => void
    >();

    /**
     * Event is emitted when the state of the connector changes. The listener callback will be called
     * in order to have access from outside to the errors that occur on the web socket level.
     */
    public onOnlineStateChange = new OEvent<(online: boolean) => void>();

    private commServerListener = new Map<
        CommServerUrl,
        Map<LocalPublicKey, CommServerListenerInfo>
    >();
    private webSocketListener = new Map<HostPort, WebSocketListenerInfo>();

    /**
     * Retrieve the online state based on connections to comm servers.
     *
     * If we don't have connections to comm servers, the state will always be true.
     *
     * @returns
     */
    get onlineState(): boolean {
        for (const keyListenerMap of this.commServerListener.values()) {
            for (const listenerInfo of keyListenerMap.values()) {
                if (listenerInfo.listener.state !== CommunicationServerListenerState.Listening) {
                    return false;
                }
            }
        }
        return true;
    }

    public static communicationServerListenerId(
        commServerUrl: string,
        localPublicKey: LocalPublicKey,
        listenerIdPrefix?: string
    ) {
        return `${
            listenerIdPrefix !== undefined ? listenerIdPrefix + ':' : ''
        }${commServerUrl}:${localPublicKey}`;
    }

    public static directConnectionListenerId(
        host: string,
        port: number,
        listenerIdPrefix?: string
    ) {
        return `${listenerIdPrefix !== undefined ? listenerIdPrefix + ':' : ''}${host}:${port}`;
    }

    /**
     * Listen for connections using a communication server.
     *
     * @param commServerUrl - The communication server to use. (URL is passed to WebSocket)
     * @param cryptoApi
     * @param listenerIdPrefix - The prefix to add before the listener id
     */
    public async listenForCommunicationServerConnections(
        commServerUrl: string,
        cryptoApi: CryptoApi,
        listenerIdPrefix?: string
    ): Promise<() => Promise<void>> {
        const localPublicKey = castToLocalPublicKey(cryptoApi.publicEncryptionKey);

        MessageBus.send(
            'log',
            `listenForCommunicationServerConnections(${localPublicKey}, ${commServerUrl})`
        );

        const keyListenerMap = getOrCreate(
            this.commServerListener,
            castToCommServerUrl(commServerUrl),
            new Map<LocalPublicKey, CommServerListenerInfo>()
        );

        const keyEntry = keyListenerMap.get(localPublicKey);
        if (keyEntry === undefined) {
            // start commserver
            keyListenerMap.set(
                localPublicKey,
                await this.startNewCommunicationServerListener(
                    commServerUrl,
                    cryptoApi,
                    IncomingConnectionManager.communicationServerListenerId(
                        commServerUrl,
                        localPublicKey,
                        listenerIdPrefix
                    )
                )
            );
        } else {
            // increase refcount
            keyEntry.referenceCount++;
        }

        return async () => {
            await this.stopListeningForCommunicationServerConnections(commServerUrl, cryptoApi);
        };
    }

    public async stopListeningForCommunicationServerConnections(
        commServerUrl: string,
        cryptoApi: CryptoApi
    ): Promise<void> {
        const keyListenerMap = this.commServerListener.get(castToCommServerUrl(commServerUrl));
        if (keyListenerMap === undefined) {
            throw new Error(
                'Failed to stop listening for commserver connections, the refcount is already' +
                    ' down to 0.'
            );
        }

        const keyEntry = keyListenerMap.get(castToLocalPublicKey(cryptoApi.publicEncryptionKey));
        if (keyEntry === undefined) {
            throw new Error('Programming error: No publicKey entry.');
        }

        keyEntry.referenceCount--;

        if (keyEntry.referenceCount === 0) {
            keyListenerMap.delete(castToLocalPublicKey(cryptoApi.publicEncryptionKey));
            if (keyListenerMap.keys().next().done) {
                this.commServerListener.delete(castToCommServerUrl(commServerUrl));
            }
            keyEntry.listener.stop();
        }
    }

    /**
     * Listen for direct connections.
     *
     * This function will start a listening websocket server only the first time this function
     * is called with the same host / port / localPublicKey options. All following calls will
     * just increase a reference counter, but not start a listening
     *
     * @param host
     * @param port
     * @param cryptoApi
     * @param listenerIdPrefix - The prefix to add before the listener id
     */
    public async listenForDirectConnections(
        host: string,
        port: number,
        cryptoApi: CryptoApi,
        listenerIdPrefix?: string
    ): Promise<() => Promise<void>> {
        MessageBus.send(
            'log',
            `listenForDirectConnections(${uint8arrayToHexString(
                cryptoApi.publicEncryptionKey
            )}, ${host}, ${port})`
        );

        // Direct connections are not allowed to create the same listener for the same host /
        // port. This would lead to a EADDRINUSE error. It still might if you use e.g. localhost
        // and 127.0.0.1, but let's ignore this for now.
        // This will therefore be the key in the map to lookup listeners.
        const listenerInfo = this.webSocketListener.get(castToHostPort(host, port));

        if (listenerInfo === undefined) {
            this.webSocketListener.set(
                castToHostPort(host, port),
                await this.startNewWebsocketListener(
                    host,
                    port,
                    cryptoApi,
                    IncomingConnectionManager.directConnectionListenerId(
                        host,
                        port,
                        listenerIdPrefix
                    )
                )
            );
        } else {
            const publicKeyRefcount = listenerInfo.registeredPublicKeys.get(
                castToLocalPublicKey(cryptoApi.publicEncryptionKey)
            );

            if (publicKeyRefcount === undefined) {
                listenerInfo.registeredPublicKeys.set(
                    castToLocalPublicKey(cryptoApi.publicEncryptionKey),
                    {
                        cryptoApi,
                        referenceCount: 1
                    }
                );
            } else {
                publicKeyRefcount.referenceCount++;
            }
        }

        return async () => {
            await this.stopListeningForDirectConnections(host, port, cryptoApi.publicEncryptionKey);
        };
    }

    async stopListeningForDirectConnections(
        host: string,
        port: number,
        localPublicKey: PublicKey
    ): Promise<void> {
        const listenerInfo = this.webSocketListener.get(castToHostPort(host, port));

        if (listenerInfo === undefined) {
            throw new Error(
                'Failed to stop listening for direct connections, the refcount is already down' +
                    ' to 0.'
            );
        }

        const publicKeyRefcount = listenerInfo.registeredPublicKeys.get(
            castToLocalPublicKey(localPublicKey)
        );

        if (publicKeyRefcount === undefined) {
            throw new Error('We do not listen for this public key.');
        }

        publicKeyRefcount.referenceCount--;

        if (publicKeyRefcount.referenceCount === 0) {
            listenerInfo.registeredPublicKeys.delete(castToLocalPublicKey(localPublicKey));
        }

        if (listenerInfo.registeredPublicKeys.size === 0) {
            this.webSocketListener.delete(castToHostPort(host, port));
            await listenerInfo.listener.stop();
        }
    }

    /**
     * Shutdown the listeners.
     *
     * This does not shutdown the already established encrypted connections, it just shuts down
     * the listeners.
     */
    public async shutdown(): Promise<void> {
        MessageBus.send('log', 'shutdown()');
        for (const [commServerUrl, keyListenerMap] of this.commServerListener.entries()) {
            for (const [localPublicKey, listenerInfo] of keyListenerMap.entries()) {
                MessageBus.send(
                    'log',
                    `Shutdown comm server listener: ${commServerUrl}/${localPublicKey}`
                );
                listenerInfo.listener.stop();
            }
        }
        for (const [k, v] of this.webSocketListener.entries()) {
            MessageBus.send('log', `Shutdown web socket listener: ${k}`);
            await v.listener.stop();
        }
    }

    // ######## Private API ########

    // What do we actually need here?
    // A list of acceptable public keys for this connection.
    private async acceptConnection(
        connection: Connection,
        cryptoApis: CryptoApi[],
        listenerId: string
    ): Promise<void> {
        MessageBus.send('log', `${connection.id}: Accepted WebSocket`);
        try {
            const conn = await acceptWithEncryption(connection, cryptoApis);
            this.onConnection.emit(conn.connection, conn.myKey, conn.remoteKey, listenerId);
        } catch (e) {
            connection.close();
            throw e;
        }
    }

    public async startNewCommunicationServerListener(
        commServerUrl: string,
        cryptoApi: CryptoApi,
        listenerId: string
    ): Promise<CommServerListenerInfo> {
        const listener = new CommunicationServerListener(cryptoApi, 2, 10000);
        listener.onConnection((connection: Connection) => {
            this.acceptConnection(connection, [cryptoApi], listenerId).catch(console.error);
        });

        // Connect the stateChanged event to the onelineStateChanged event
        listener.onStateChange(() => {
            // Delay the notification to remove short offline states
            // TODO: this emits the event multiple times ... fix this later
            setTimeout(() => {
                this.onOnlineStateChange.emit(this.onlineState);
            }, 1000);
        });

        // Start listener
        listener.start(commServerUrl);

        return {
            listener,
            referenceCount: 1
        };
    }

    private async startNewWebsocketListener(
        host: string,
        port: number,
        cryptoApi: CryptoApi,
        listenerId: string
    ): Promise<WebSocketListenerInfo> {
        // This is the map that will be extended / shrunk later when we listen or stop
        // listening for new public keys.
        const registeredPublicKeys = new Map<
            LocalPublicKey,
            MapValueType<WebSocketListenerInfo['registeredPublicKeys']>
        >([[castToLocalPublicKey(cryptoApi.publicEncryptionKey), {cryptoApi, referenceCount: 1}]]);

        // Create and start WebSocket server
        const listener = new WebSocketServer();
        listener.onConnection(async (connection: Connection) => {
            // All connections are now unified as Connection class
            // No special handling needed for different connection types
            await this.acceptConnection(
                connection,
                [...registeredPublicKeys.values()].map(v => v.cryptoApi),
                listenerId
            );
        });
        
        await listener.start(host, port);

        // Construct listenerInfo
        return {
            listener,
            registeredPublicKeys
        };
    }
}

/*
enum connectionState {
    Disconnected,
    Connecting,
    Connected,
    Disconnecting
};

class InstanceCommunicationManager {
    // Verbinden mit Instanz
    // Wege wie das funktioniert ist im ContactManagement hinterlegt.
    // Irgendwo sollte es aber auch ein Interface geben, welches diese Wege als Parameter überreicht bekommt
    //
    // Wege Optionen:
    // * active connect (url, target public key, source public key, instance id??)
    // * passive comm server (url commserver, source public key, )
    // * passive direct connection (port)
    connectToInstance(instance);

    disconnectFromInstance(instance);

    connectionState state(Instance);

    onConnectionStateChanged(Instance, oldState, newState);
}

type InstanceInfo {
    instance: Instance,
    endpoint: Endpoint
};

class InstanceManager {
    constructor(Contactmanagement);

    getInstancesForPerson(personid, includealiases): InstanceInfo[]
        // Inspect Contact obejcts

    getMyInstances(includealiases): InstanceInfo[]
        // Worwards to getInstancesForPerson

    connect(MyInstance, TheirInstace or MyInstance)

    disconnect(MyInstance, TheirInstance)
}*/
