import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import {ensurePublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type {SymmetricCryptoApiWithKeys} from '@refinio/one.core/lib/crypto/SymmetricCryptoApi.js';
import IncomingConnectionManager from './IncomingConnectionManager.js';
import type {LocalPublicKey} from './ConnectionRoutesGroupMap.js';
import ConnectionRoutesGroupMap, {castToLocalPublicKey} from './ConnectionRoutesGroupMap.js';
import OutgoingWebsocketRoute from './routes/OutgoingWebsocketRoute.js';
import IncomingWebsocketRouteDirect from './routes/IncomingWebsocketRouteDirect.js';
import IncomingWebsocketRouteCommServer from './routes/IncomingWebsocketRouteCommServer.js';
import type Connection from '../Connection/Connection.js';
import {
    hexToUint8Array,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {ConnectionRoutesGroup, ConnectionRoutes} from './ConnectionRoutesGroup.js';
import {OEvent} from '../OEvent.js';
import {getOrCreate} from '../../utils/MapUtils.js';
import {exchangeConnectionGroupName} from './protocols/ExchangeConnectionGroupName.js';
import {sync} from './protocols/Sync.js';

const MessageBus = createMessageBus('CommunicatonModule');

export type CatchAllRoutes = {
    localPublicKey: LocalPublicKey;
    knownRoutes: ConnectionRoutes;
};

// ######## Configuration types ########

/**
 * This module manages incoming and outgoing connections.
 *
 * You can define how a connection between two participants can be reached (called a connection
 * route) and this module will try to open a single connection between those two participants
 * using those routes.
 *
 * Routes can be enabled / disabled giving the user control of when and how to establish
 * connections.
 */
export default class ConnectionRouteManager {
    private readonly connectionRoutesGroupMap = new ConnectionRoutesGroupMap();
    private readonly catchAllRoutes = new Map<LocalPublicKey, CatchAllRoutes>();

    private readonly incomingConnectionManager = new IncomingConnectionManager();
    private readonly reconnectDelayOnClose: number;

    /**
     *  Event is emitted when the state of the connector changes. The event contains the value of the online state.
     */
    public onOnlineStateChange = new OEvent<(state: boolean) => void>();
    /**
     * Event is emitted when a connection is established or closed.
     */
    public onConnectionsChange = new OEvent<() => void>();

    public onConnection = new OEvent<
        (
            conn: Connection,
            localPublicKey: PublicKey,
            remotePublicKey: PublicKey,
            connectionRoutesGroupName: string,
            initiatedLocally: boolean
        ) => void
    >();

    public onConnectionViaCatchAll = new OEvent<
        (
            conn: Connection,
            localPublicKey: PublicKey,
            remotePublicKey: PublicKey,
            connectionRoutesGroupName: string,
            initiatedLocally: boolean
        ) => void
    >();

    /**
     * @param reconnectDelayOnClose - Real reconnect delay is randomized in the
     * intrval [reconnectDelay, reconnectInterval * 2]
     */
    constructor(reconnectDelayOnClose: number = 5000) {
        this.reconnectDelayOnClose = reconnectDelayOnClose;
        this.incomingConnectionManager.onConnection(
            (
                conn: Connection,
                localPublicKey: PublicKey,
                remotePublicKey: PublicKey,
                connectionRouteId: string
            ) => {
                this.acceptConnection(
                    conn,
                    localPublicKey,
                    remotePublicKey,
                    connectionRouteId
                ).catch(console.error);
            }
        );
        this.incomingConnectionManager.onOnlineStateChange((onlineState: boolean) => {
            this.onOnlineStateChange.emit(onlineState);
        });
    }

    get onlineState(): boolean {
        return this.incomingConnectionManager.onlineState;
    }

    // ######## add routes ########

    isOutgoingWebsocketRouteExisting(
        url: string,
        localPublicKey: PublicKey,
        remotePublicKey: PublicKey,
        connectionRoutesGroupName: string
    ): boolean {
        const connectionGroup = this.connectionRoutesGroupMap.getGroup(
            localPublicKey,
            remotePublicKey,
            connectionRoutesGroupName
        );

        if (connectionGroup === undefined) {
            return false;
        }

        return connectionGroup.knownRoutes.some(
            r => r.route.id === OutgoingWebsocketRoute.caluclateId(url)
        );
    }

    addOutgoingWebsocketRoute(
        cryptoApi: SymmetricCryptoApiWithKeys,
        url: string,
        connectionRoutesGroupName: string
    ): {isNew: boolean; id: string} {
        MessageBus.send(
            'log',
            `addOutgoingWebsocketRoute(${uint8arrayToHexString(
                cryptoApi.localPublicKey
            )}, ${uint8arrayToHexString(
                cryptoApi.remotePublicKey
            )}, ${url}, ${connectionRoutesGroupName})`
        );

        const connectionGroup = this.connectionRoutesGroupMap.createGroupIfNotExist(
            cryptoApi.localPublicKey,
            cryptoApi.remotePublicKey,
            connectionRoutesGroupName,
            false
        );

        const route = new OutgoingWebsocketRoute(
            url,
            cryptoApi,
            (
                conn: Connection,
                localPublicKeyInner: PublicKey,
                remotePublicKeyInner: PublicKey,
                connectionRouteId: string
            ) => {
                this.acceptConnection(
                    conn,
                    localPublicKeyInner,
                    remotePublicKeyInner,
                    connectionRouteId,
                    connectionRoutesGroupName
                ).catch(console.error);
            }
        );

        if (!connectionGroup.knownRoutes.some(r => r.route.id === route.id)) {
            connectionGroup.knownRoutes.push({
                route,
                disabled: true
            });

            return {isNew: true, id: route.id};
        }

        return {isNew: false, id: route.id};
    }

    addIncomingWebsocketRoute_Direct(
        cryptoApi: CryptoApi,
        remotePublicKey: PublicKey,
        host: string,
        port: number,
        connectionRoutesGroupName: string
    ): {isNew: boolean; id: string} {
        MessageBus.send(
            'log',
            `addIncomingWebsocketRoute_Direct(${uint8arrayToHexString(
                cryptoApi.publicEncryptionKey
            )}, ${uint8arrayToHexString(
                remotePublicKey
            )}, ${host}, ${port}, ${connectionRoutesGroupName})`
        );

        const connectionGroup = this.connectionRoutesGroupMap.createGroupIfNotExist(
            cryptoApi.publicEncryptionKey,
            remotePublicKey,
            connectionRoutesGroupName,
            false
        );

        const route = new IncomingWebsocketRouteDirect(
            this.incomingConnectionManager,
            host,
            port,
            cryptoApi
        );

        if (!connectionGroup.knownRoutes.some(r => r.route.id === route.id)) {
            connectionGroup.knownRoutes.push({
                route,
                disabled: true
            });

            return {isNew: true, id: route.id};
        }

        return {isNew: false, id: route.id};
    }

    addIncomingWebsocketRoute_CommServer(
        cryptoApi: CryptoApi,
        remotePublicKey: PublicKey,
        commServerUrl: string,
        connectionRoutesGroupName: string
    ): {isNew: boolean; id: string} {
        MessageBus.send(
            'log',
            `addIncomingWebsocketRoute_CommServer(${uint8arrayToHexString(
                cryptoApi.publicEncryptionKey
            )}, ${uint8arrayToHexString(
                remotePublicKey
            )}, ${commServerUrl}, ${connectionRoutesGroupName})`
        );

        const connectionGroup = this.connectionRoutesGroupMap.createGroupIfNotExist(
            cryptoApi.publicEncryptionKey,
            remotePublicKey,
            connectionRoutesGroupName,
            false
        );

        const route = new IncomingWebsocketRouteCommServer(
            this.incomingConnectionManager,
            commServerUrl,
            cryptoApi
        );

        if (!connectionGroup.knownRoutes.some(r => r.route.id === route.id)) {
            connectionGroup.knownRoutes.push({
                route,
                disabled: true
            });

            return {isNew: true, id: route.id};
        }

        return {isNew: false, id: route.id};
    }

    // ######## Catch all routes ########

    addIncomingWebsocketRouteCatchAll_Direct(
        cryptoApi: CryptoApi,
        host: string,
        port: number
    ): {isNew: boolean; id: string} {
        MessageBus.send(
            'log',
            `addIncomingWebsocketRouteCatchAll_Direct(${uint8arrayToHexString(
                cryptoApi.publicEncryptionKey
            )}, ${host}, ${port})`
        );

        const catchAllRoute = getOrCreate(
            this.catchAllRoutes,
            castToLocalPublicKey(cryptoApi.publicEncryptionKey),
            {
                localPublicKey: castToLocalPublicKey(cryptoApi.publicEncryptionKey),
                knownRoutes: []
            }
        );

        const route = new IncomingWebsocketRouteDirect(
            this.incomingConnectionManager,
            host,
            port,
            cryptoApi
        );

        if (!catchAllRoute.knownRoutes.some(r => r.route.id === route.id)) {
            catchAllRoute.knownRoutes.push({
                route,
                disabled: true
            });

            return {isNew: true, id: route.id};
        }

        return {isNew: false, id: route.id};
    }

    addIncomingWebsocketRouteCatchAll_CommServer(
        cryptoApi: CryptoApi,
        commServerUrl: string
    ): {isNew: boolean; id: string} {
        MessageBus.send(
            'log',
            `addIncomingWebsocketRouteCatchAll_CommServer(${uint8arrayToHexString(
                cryptoApi.publicEncryptionKey
            )}, ${commServerUrl})`
        );

        const catchAllRoute = getOrCreate(
            this.catchAllRoutes,
            castToLocalPublicKey(cryptoApi.publicEncryptionKey),
            {
                localPublicKey: castToLocalPublicKey(cryptoApi.publicEncryptionKey),
                knownRoutes: []
            }
        );

        const route = new IncomingWebsocketRouteCommServer(
            this.incomingConnectionManager,
            commServerUrl,
            cryptoApi
        );

        if (!catchAllRoute.knownRoutes.some(r => r.route.id === route.id)) {
            catchAllRoute.knownRoutes.push({
                route,
                disabled: true
            });

            return {isNew: false, id: route.id};
        }

        return {isNew: true, id: route.id};
    }

    // ######## Enable / disable routes ########

    /**
     * Enables all routes matching the passed parameters.
     *
     * This also includes catch-all routes if only the localPublicKey and / or routeId is set.
     *
     * @param localPublicKey
     * @param remotePublicKey
     * @param connectionRoutesGroupName
     * @param routeId
     */
    async enableRoutes(
        localPublicKey?: PublicKey,
        remotePublicKey?: PublicKey,
        connectionRoutesGroupName?: string,
        routeId?: string
    ): Promise<void> {
        MessageBus.send(
            'log',
            `enableRoutes(${localPublicKey && uint8arrayToHexString(localPublicKey)}, ${
                remotePublicKey && uint8arrayToHexString(remotePublicKey)
            }, ${connectionRoutesGroupName}, ${routeId})`
        );

        const connectionGroups = this.connectionRoutesGroupMap.getGroups(
            localPublicKey,
            remotePublicKey,
            connectionRoutesGroupName
        );

        // handle incoming & outgoing routes for known participants
        for (const connectionGroup of connectionGroups) {
            ConnectionRouteManager.clearRoutesDisableFlags(connectionGroup, routeId);
            await ConnectionRouteManager.startOutgoingRoutes(connectionGroup);
            await ConnectionRouteManager.startIncomingRoutes(connectionGroup);
        }

        // handle catch all routes
        if (remotePublicKey === undefined && connectionRoutesGroupName === undefined) {
            await this.enableCatchAllRoutes(localPublicKey, routeId);
        }

        this.onConnectionsChange.emit();
    }

    /**
     * Disables all routes matching the passed parameters.
     *
     * This also includes catch-all routes if only the localPublicKey and / or routeId is set.
     *
     * @param localPublicKey
     * @param remotePublicKey
     * @param connectionRoutesGroupName
     * @param routeId
     */
    async disableRoutes(
        localPublicKey?: PublicKey,
        remotePublicKey?: PublicKey,
        connectionRoutesGroupName?: string,
        routeId?: string
    ): Promise<void> {
        MessageBus.send(
            'log',
            `disableRoutes(${localPublicKey && uint8arrayToHexString(localPublicKey)}, ${
                remotePublicKey && uint8arrayToHexString(remotePublicKey)
            }, ${connectionRoutesGroupName}, ${routeId})`
        );

        const connectionGroups = this.connectionRoutesGroupMap.getGroups(
            localPublicKey,
            remotePublicKey,
            connectionRoutesGroupName
        );

        // handle incoming & outgoing routes for known participants
        for (const connectionGroup of connectionGroups) {
            ConnectionRouteManager.setRoutesDisableFlags(connectionGroup, routeId);
            await ConnectionRouteManager.stopOutgoingRoutes(connectionGroup, true);
            await ConnectionRouteManager.stopIncomingRoutes(connectionGroup, true);
        }

        // handle catch all routes
        if (remotePublicKey === undefined && connectionRoutesGroupName === undefined) {
            await this.disableCatchAllRoutes(localPublicKey, routeId);
        }

        this.onConnectionsChange.emit();
    }

    /**
     * Enables all catch-all routes matching the passed parameters.
     *
     * @param localPublicKey
     * @param routeId
     */
    async enableCatchAllRoutes(localPublicKey?: PublicKey, routeId?: string): Promise<void> {
        MessageBus.send(
            'log',
            `enableCatchAllRoutes(${
                localPublicKey && uint8arrayToHexString(localPublicKey)
            }, ${routeId})`
        );

        let catchAllRoutes: CatchAllRoutes[];
        if (localPublicKey === undefined) {
            catchAllRoutes = [...this.catchAllRoutes.values()];
        } else {
            const catchAllRoute = this.catchAllRoutes.get(castToLocalPublicKey(localPublicKey));

            if (catchAllRoute === undefined) {
                throw new Error('No catch all routes for the specified localPublicKey found.');
            }

            catchAllRoutes = [catchAllRoute];
        }

        for (const catchAllRoute of catchAllRoutes) {
            ConnectionRouteManager.clearCatchAllRoutesDisableFlags(catchAllRoute, routeId);
            await ConnectionRouteManager.startCatchAllRoutes(catchAllRoute);
        }
    }

    /**
     * Disables all catch-all routes matching the passed parameters.
     *
     * @param localPublicKey
     * @param routeId
     */
    async disableCatchAllRoutes(localPublicKey?: PublicKey, routeId?: string): Promise<void> {
        MessageBus.send(
            'log',
            `disableCatchAllRoutes(${
                localPublicKey && uint8arrayToHexString(localPublicKey)
            }, ${routeId})`
        );

        let catchAllRoutes: CatchAllRoutes[];
        if (localPublicKey === undefined) {
            catchAllRoutes = [...this.catchAllRoutes.values()];
        } else {
            const catchAllRoute = this.catchAllRoutes.get(castToLocalPublicKey(localPublicKey));

            if (catchAllRoute === undefined) {
                throw new Error('No catch all routes for the specified localPublicKey found.');
            }

            catchAllRoutes = [catchAllRoute];
        }

        for (const catchAllRoute of catchAllRoutes) {
            ConnectionRouteManager.setCatchAllRoutesDisableFlags(catchAllRoute, routeId);
            await this.stopCatchAllRoutes(catchAllRoute);
        }
    }

    // ######## ConnectionHandling ########

    closeConnections(
        localPublicKey?: PublicKey,
        remotePublicKey?: PublicKey,
        connectionRoutesGroupName?: string,
        catchAll?: boolean
    ): void {
        MessageBus.send(
            'log',
            `closeConnections(${localPublicKey && uint8arrayToHexString(localPublicKey)}, ${
                remotePublicKey && uint8arrayToHexString(remotePublicKey)
            }, ${connectionRoutesGroupName})`
        );

        const connectionGroups = this.connectionRoutesGroupMap.getGroups(
            localPublicKey,
            remotePublicKey,
            connectionRoutesGroupName,
            catchAll
        );

        for (const connectionGroup of connectionGroups) {
            if (connectionGroup.activeConnection) {
                connectionGroup.activeConnection.close('closeConnections called by user.');
            }
        }
    }

    /**
     * This returns all connection routes gorups.
     *
     * The returned value is only meant to be used to display information, do not alter anything
     * in there, because it is not a copy of the internal data structures!
     */
    connectionRoutesInformation(): {
        connectionsRoutesGroups: ConnectionRoutesGroup[];
        catchAllRoutes: CatchAllRoutes[];
    } {
        return {
            connectionsRoutesGroups: this.connectionRoutesGroupMap.getGroups(),
            catchAllRoutes: [...this.catchAllRoutes.values()]
        };
    }

    /**
     * Dump the connection information to console.
     *
     * @param header
     */
    debugDump(header: string = ''): void {
        this.connectionRoutesGroupMap.debugDump(header);
    }

    // ######## Set disable flag ########

    private static setRoutesDisableFlags(
        connectionRoutesGroup: ConnectionRoutesGroup,
        routeId?: string
    ): void {
        for (const route of connectionRoutesGroup.knownRoutes) {
            if (routeId !== undefined && routeId !== route.route.id) {
                continue;
            }
            route.disabled = true;
        }
    }

    private static clearRoutesDisableFlags(
        connectionRoutesGroup: ConnectionRoutesGroup,
        routeId?: string
    ): void {
        for (const route of connectionRoutesGroup.knownRoutes) {
            if (routeId !== undefined && routeId !== route.route.id) {
                continue;
            }
            route.disabled = false;
        }
    }

    private static setCatchAllRoutesDisableFlags(
        catchAllRoutes: CatchAllRoutes,
        routeId?: string
    ): void {
        for (const route of catchAllRoutes.knownRoutes) {
            if (routeId !== undefined && routeId !== route.route.id) {
                continue;
            }
            route.disabled = true;
        }
    }

    private static clearCatchAllRoutesDisableFlags(
        catchAllRoutes: CatchAllRoutes,
        routeId?: string
    ): void {
        for (const route of catchAllRoutes.knownRoutes) {
            if (routeId !== undefined && routeId !== route.route.id) {
                continue;
            }
            route.disabled = false;
        }
    }

    // ######## Start / Stop routes ########

    /**
     * Start all enabled outgoing routes that have not yet been started.
     *
     * @param connectionRoutesGroup
     */
    private static async startOutgoingRoutes(
        connectionRoutesGroup: ConnectionRoutesGroup
    ): Promise<void> {
        MessageBus.send(
            'log',
            `startOutgoingRoutes(${uint8arrayToHexString(
                connectionRoutesGroup.localPublicKey
            )}, ${uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)}, ${
                connectionRoutesGroup.groupName
            })`
        );
        const errors = [];

        for (const route of connectionRoutesGroup.knownRoutes) {
            if (
                route.route.outgoing &&
                !route.disabled &&
                !route.route.active &&
                connectionRoutesGroup.activeConnection === null
            ) {
                try {
                    await route.route.start();
                } catch (e) {
                    errors.push(e);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors starting routes: ${errors.join(', ')}`);
        }
    }

    /**
     * Start all enabled outgoing routes that have not yet been started after a certain amount
     * of time has expired,
     *
     * @param connectionRoutesGroup
     * @param delay
     */
    private static async startOutgoingRoutesDelayed(
        connectionRoutesGroup: ConnectionRoutesGroup,
        delay: number
    ): Promise<void> {
        MessageBus.send(
            'log',
            `startOutgoingRoutesDelayed(${uint8arrayToHexString(
                connectionRoutesGroup.localPublicKey
            )}, ${uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)}, ${
                connectionRoutesGroup.groupName
            }, ${delay})`
        );
        if (connectionRoutesGroup.reconnectTimeoutHandle !== null) {
            return;
        }

        // Add a jitter on top of the timeout, so that both sides don't attempt connections
        // at the same time. If done properly this should not be necessary, but ... this was
        // the easy / fast fix to solve lots of duplicate connection errors.
        delay = delay * (1 + Math.random());
        MessageBus.send('debug', `startOutgoingRoutesDelayed: delay=${delay})`);

        connectionRoutesGroup.reconnectTimeoutHandle = setTimeout(() => {
            connectionRoutesGroup.reconnectTimeoutHandle = null;
            ConnectionRouteManager.startOutgoingRoutes(connectionRoutesGroup).catch(console.error);
        }, delay);
    }

    /**
     * Stop all outgoing routes.
     *
     * @param connectionRoutesGroup
     * @param onlyDisabled - If set to true, then only stop the disabled routes.
     */
    private static async stopOutgoingRoutes(
        connectionRoutesGroup: ConnectionRoutesGroup,
        onlyDisabled: boolean = false
    ): Promise<void> {
        MessageBus.send(
            'log',
            `stopOutgoingRoutes(${uint8arrayToHexString(
                connectionRoutesGroup.localPublicKey
            )}, ${uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)}, ${
                connectionRoutesGroup.groupName
            })`
        );

        const errors = [];
        for (const route of connectionRoutesGroup.knownRoutes) {
            if (route.route.outgoing) {
                if (onlyDisabled && !route.disabled) {
                    continue;
                }

                // Stop the route if it is active
                let stopPromise = Promise.resolve();
                if (route.route.active) {
                    stopPromise = route.route.stop();
                }

                // Close the connections spawned by this route (some routes don't stop when
                // connections are still open)
                if (connectionRoutesGroup.activeConnectionRoute === route.route) {
                    const conn =
                        ConnectionRouteManager.removeActiveConnection(connectionRoutesGroup);
                    if (conn) {
                        conn.close('Corresponding route was stopped');
                    }
                }

                // Wait for the route to be stopped
                try {
                    await stopPromise;
                } catch (e) {
                    console.error(e);
                    errors.push(e);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors stopping routes: ${errors.join(', ')}`);
        }
    }

    /**
     * Start all enabled incoming routes that have not yet been started.
     *
     * @param connectionRoutesGroup
     */
    private static async startIncomingRoutes(
        connectionRoutesGroup: ConnectionRoutesGroup
    ): Promise<void> {
        MessageBus.send(
            'log',
            `startIncomingRoutes(${uint8arrayToHexString(
                connectionRoutesGroup.localPublicKey
            )}, ${uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)}, ${
                connectionRoutesGroup.groupName
            })`
        );
        const errors = [];

        for (const route of connectionRoutesGroup.knownRoutes) {
            if (!route.route.outgoing && !route.disabled && !route.route.active) {
                try {
                    await route.route.start();
                } catch (e) {
                    errors.push(e);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors starting routes: ${errors.join(', ')}`);
        }
    }

    /**
     * Stop all incoming routes.
     *
     * @param connectionRoutesGroup
     * @param onlyDisabled - If set to true, then only stop the disabled routes.
     */
    private static async stopIncomingRoutes(
        connectionRoutesGroup: ConnectionRoutesGroup,
        onlyDisabled: boolean = false
    ): Promise<void> {
        MessageBus.send(
            'log',
            `stopIncomingRoutes(${
                connectionRoutesGroup.localPublicKey &&
                uint8arrayToHexString(connectionRoutesGroup.localPublicKey)
            }, ${
                connectionRoutesGroup.remotePublicKey &&
                uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)
            }, ${connectionRoutesGroup.groupName})`
        );

        const errors = [];
        for (const route of connectionRoutesGroup.knownRoutes) {
            if (!route.route.outgoing) {
                if (onlyDisabled && !route.disabled) {
                    continue;
                }

                // Stop the route if it is active
                let stopPromise = Promise.resolve();
                if (route.route.active) {
                    stopPromise = route.route.stop();
                }

                // Close the connections spawned by this route (some routes don't stop when
                // connections are still open)
                if (connectionRoutesGroup.activeConnectionRoute === route.route) {
                    const conn =
                        ConnectionRouteManager.removeActiveConnection(connectionRoutesGroup);
                    if (conn) {
                        conn.close('Corresponding route was stopped');
                    }
                }

                // Wait for the route to be stopped
                try {
                    await stopPromise;
                } catch (e) {
                    console.error(e);
                    errors.push(e);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors stopping routes: ${errors.join(', ')}`);
        }
    }

    /**
     * Start all enabled catch-all routes that have not yet been started.
     *
     * @param catchAllRoutes
     */
    private static async startCatchAllRoutes(catchAllRoutes: CatchAllRoutes): Promise<void> {
        MessageBus.send('log', `startCatchAllRoutes(${catchAllRoutes.localPublicKey})`);
        const errors = [];

        for (const route of catchAllRoutes.knownRoutes) {
            if (route.route.outgoing) {
                throw new Error('Internal error: catch all routes cannot be outgoing!');
            }

            if (!route.disabled && !route.route.active) {
                try {
                    await route.route.start();
                } catch (e) {
                    errors.push(e);
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors starting routes: ${errors.join(', ')}`);
        }
    }

    /**
     * Stop all catch-all routes.
     *
     * @param catchAllRoutes
     * @param onlyDisabled - If set to true, then only stop the disabled routes.
     */
    private async stopCatchAllRoutes(
        catchAllRoutes: CatchAllRoutes,
        onlyDisabled: boolean = false
    ): Promise<void> {
        MessageBus.send('log', `stopIncomingRoutes(${catchAllRoutes.localPublicKey})`);
        const errors = [];

        for (const route of catchAllRoutes.knownRoutes) {
            if (route.route.outgoing) {
                throw new Error('Internal error: catch all routes cannot be outgoing!');
            }

            if (onlyDisabled && !route.disabled) {
                continue;
            }

            // Stop the route if it is active
            let stopPromise = Promise.resolve();
            if (route.route.active) {
                stopPromise = route.route.stop();
            }

            // Close the connections spawned by this route (some routes don't stop when
            // connections are still open)
            this.closeConnections(
                ensurePublicKey(hexToUint8Array(catchAllRoutes.localPublicKey)),
                undefined,
                undefined,
                true
            );

            // Wait for the route to be stopped
            try {
                await stopPromise;
            } catch (e) {
                console.error(e);
                errors.push(e);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Errors stopping routes: ${errors.join(', ')}`);
        }
    }

    // ######## Other stuff ########

    /**
     * This is registered as callback at the routes that spawn connections.
     *
     * @param conn - The connection object linked to the remote device.
     * @param localPublicKey - the local public key used to spawn the connection.
     * @param remotePublicKey - The remote public key. It was proven, that the other side has
     * the corresponding private key.
     * @param connectionRouteId - The identifier for the route that spawned the connection.
     * @param connectionRoutesGroupName - If connection was initiated locally this is set to the group
     * that was specified when establishing the connection. If an incoming connection was
     * accepted this will be undefined.
     * @private
     */
    private async acceptConnection(
        conn: Connection,
        localPublicKey: PublicKey,
        remotePublicKey: PublicKey,
        connectionRouteId: string,
        connectionRoutesGroupName?: string
    ) {
        try {
            conn.log(
                MessageBus,
                `acceptConnection(${uint8arrayToHexString(localPublicKey)}, ${uint8arrayToHexString(
                    remotePublicKey
                )}, ${connectionRoutesGroupName}, ${connectionRouteId})`
            );

            const initiatedLocally = connectionRoutesGroupName !== undefined;

            MessageBus.send('log', `${conn.id}: acceptConnection: exchangeConnectionGroupName`);

            // Exchange connection group name (initiator selects the group)
            connectionRoutesGroupName = await exchangeConnectionGroupName(
                conn,
                connectionRoutesGroupName
            );

            // Step 1: Check if we know this peer
            let connectionGroup = this.connectionRoutesGroupMap.getGroup(
                localPublicKey,
                remotePublicKey,
                connectionRoutesGroupName
            );

            // Step 2: If no known peer was found, then check if a catch all rule fits
            if (connectionGroup === undefined) {
                const catchAllRoute = this.catchAllRoutes.get(castToLocalPublicKey(localPublicKey));

                if (!catchAllRoute) {
                    conn.close('I do not want to communicate with you. Go Away!');
                    return;
                }

                // If we found a catch all route, then we create a new connection group for that
                // peer which we mark as catchAll connection group
                connectionGroup = this.connectionRoutesGroupMap.createGroupIfNotExist(
                    localPublicKey,
                    remotePublicKey,
                    connectionRoutesGroupName,
                    true
                );
            }

            MessageBus.send('log', `${conn.id}: acceptConnection: sync`);

            // Have a sync step (misusing the success message at the moment), so that the
            // connection initiator does not emit the event if the other side does not want to
            // connect.
            await sync(conn, initiatedLocally);

            // Assign a new connection
            if (connectionGroup.activeConnection === null) {
                this.assignNewConnection(connectionGroup, conn, connectionRouteId);
            } else if (connectionGroup.dropDuplicates) {
                conn.close('Duplicate connection - dropped new connection');
                return;
            } else {
                this.assignNewConnection(connectionGroup, conn, connectionRouteId);
            }

            // Now we know both sides want to connect => emit
            if (connectionGroup.isCatchAllGroup) {
                this.onConnectionViaCatchAll.emit(
                    conn,
                    localPublicKey,
                    remotePublicKey,
                    connectionGroup.groupName,
                    initiatedLocally
                );
            } else {
                const group = connectionGroup.knownRoutes.find(
                    g => g.route.id === connectionRouteId
                );

                if (group !== undefined && group.disabled) {
                    conn.close('Route is disabled');
                } else {
                    this.onConnection.emit(
                        conn,
                        localPublicKey,
                        remotePublicKey,
                        connectionGroup.groupName,
                        initiatedLocally
                    );
                }
            }
        } catch (e) {
            conn.close(`${e}`);
        }
    }

    private assignNewConnection(
        connectionRoutesGroup: ConnectionRoutesGroup,
        conn: Connection,
        connectionRouteId: string
    ): void {
        // We disconnect the close handler, so that it does not run, when we close it and
        // replace it (this would trigger outgoing connections to be established)
        if (connectionRoutesGroup.disconnectCloseHandler) {
            connectionRoutesGroup.disconnectCloseHandler();
        }

        // Clear the timout that resets the drop duplicates flag.
        if (connectionRoutesGroup.dropDuplicatesTimeoutHandle !== null) {
            clearTimeout(connectionRoutesGroup.dropDuplicatesTimeoutHandle);
        }

        // Now it is safe to close the connection
        if (connectionRoutesGroup.activeConnection) {
            connectionRoutesGroup.activeConnection.close('New connection replaced old one');
            ConnectionRouteManager.appendToConnectionStatisticsLog(connectionRoutesGroup);
        }

        // Replace the old (now closed) one with the new connection
        connectionRoutesGroup.activeConnection = conn;

        // Now install another close handler.
        const disconnectCloseHandler = conn.state.onEnterState(state => {
            conn.log(
                MessageBus,
                `closeHandlerCalled(${connectionRoutesGroup.activeConnection}, ${connectionRoutesGroup.activeConnectionRoute?.id}, ${state})`
            );
            if (state === 'closed') {
                conn.log(MessageBus, 'closeHandlerCalled');
                ConnectionRouteManager.removeActiveConnection(connectionRoutesGroup);
                if (connectionRoutesGroup.isCatchAllGroup) {
                    this.connectionRoutesGroupMap.removeGroup(
                        connectionRoutesGroup.localPublicKey,
                        connectionRoutesGroup.remotePublicKey,
                        connectionRoutesGroup.groupName
                    );
                } else {
                    ConnectionRouteManager.startOutgoingRoutesDelayed(
                        connectionRoutesGroup,
                        this.reconnectDelayOnClose
                    ).catch(console.error);
                }
            }
        });
        connectionRoutesGroup.disconnectCloseHandler = () => {
            conn.log(
                MessageBus,
                `disconnectCloseHandlerCalled(${connectionRoutesGroup.activeConnection}, ${connectionRoutesGroup.activeConnectionRoute?.id})`
            );
            disconnectCloseHandler();
        };

        // Setup the dropDuplicates delay
        connectionRoutesGroup.dropDuplicates = true;
        connectionRoutesGroup.dropDuplicatesTimeoutHandle = setTimeout(() => {
            connectionRoutesGroup.dropDuplicates = false;
        }, 2000);

        // If the connection is already closed, then we need to call the disconnect handler,
        // because it was not called, yet.
        if (conn.state.currentState === 'closed') {
            connectionRoutesGroup.disconnectCloseHandler();
            connectionRoutesGroup.disconnectCloseHandler = null;
        }

        // Find the connection route that was used to establish the connection
        const route = connectionRoutesGroup.knownRoutes.find(
            elem => elem.route.id === connectionRouteId
        );
        connectionRoutesGroup.activeConnectionRoute = (route && route.route) || null;
    }

    private static removeActiveConnection(
        connectionRoutesGroup: ConnectionRoutesGroup
    ): Connection | null {
        MessageBus.send(
            'log',
            `removeActiveConnection(${
                connectionRoutesGroup.localPublicKey &&
                uint8arrayToHexString(connectionRoutesGroup.localPublicKey)
            }, ${
                connectionRoutesGroup.remotePublicKey &&
                uint8arrayToHexString(connectionRoutesGroup.remotePublicKey)
            }, ${connectionRoutesGroup.groupName})`
        );
        if (connectionRoutesGroup.disconnectCloseHandler) {
            connectionRoutesGroup.disconnectCloseHandler();
        }
        connectionRoutesGroup.disconnectCloseHandler = null;
        if (connectionRoutesGroup.reconnectTimeoutHandle !== null) {
            clearTimeout(connectionRoutesGroup.reconnectTimeoutHandle);
        }
        if (connectionRoutesGroup.dropDuplicatesTimeoutHandle !== null) {
            clearTimeout(connectionRoutesGroup.dropDuplicatesTimeoutHandle);
        }
        const activeConnection = connectionRoutesGroup.activeConnection;

        ConnectionRouteManager.appendToConnectionStatisticsLog(connectionRoutesGroup);

        connectionRoutesGroup.activeConnection = null;
        connectionRoutesGroup.activeConnectionRoute = null;

        return activeConnection;
    }

    /**
     * Append a new entry to the connectionsStatisticsLog.
     *
     * Limits the maximum size to 10 (limit currently deactivated - heavy debugging)
     *
     * @param connectionRoutesGroup
     */
    static appendToConnectionStatisticsLog(connectionRoutesGroup: ConnectionRoutesGroup): void {
        if (
            connectionRoutesGroup.activeConnection === null ||
            connectionRoutesGroup.activeConnectionRoute === null
        ) {
            // This is normal for fresh connections that close without prior history
            // No need to log an error - just skip statistics logging
            return;
        }

        connectionRoutesGroup.connectionStatisticsLog.push({
            ...connectionRoutesGroup.activeConnection.statistics,
            routeId: connectionRoutesGroup.activeConnectionRoute.id,
            connectionId: connectionRoutesGroup.activeConnection.id
        });

        /*if (connectionRoutesGroup.connectionStatisticsLog.length > 10) {
            connectionRoutesGroup.connectionStatisticsLog.splice(0, 1);
        }*/
    }
}
