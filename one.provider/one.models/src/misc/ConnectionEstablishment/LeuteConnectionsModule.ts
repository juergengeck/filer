import {getPublicKeys} from '@refinio/one.core/lib/keychain/key-storage-public.js';
import {storeIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type LeuteModel from '../../models/Leute/LeuteModel.js';
import type {OneInstanceEndpoint} from '../../recipes/Leute/CommunicationEndpoints.js';
import type {ConnectionStatistics} from '../Connection/plugins/StatisticsPlugin.js';
import {castToLocalPublicKey, castToRemotePublicKey} from './ConnectionRoutesGroupMap.js';
import type {LocalPublicKey} from './ConnectionRoutesGroupMap.js';
import ConnectionRouteManager from './ConnectionRouteManager.js';
import {exchangeInstanceIdObjects} from './protocols/ExchangeInstanceIds.js';
import {verifyAndExchangePersonId} from './protocols/ExchangePersonIds.js';
import {OEvent} from '../OEvent.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Instance, Person} from '@refinio/one.core/lib/recipes.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    ensureHexString,
    hexToUint8Array
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type Connection from '../Connection/Connection.js';
import type {CryptoApi} from '@refinio/one.core/lib/crypto/CryptoApi.js';
import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import {ensurePublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import {
    createCryptoApiFromDefaultKeys,
    getDefaultKeys,
    getListOfKeys
} from '@refinio/one.core/lib/keychain/keychain.js';
import {getInstancesOfPerson, getLocalInstanceOfPerson} from '../instance.js';
import {isPersonComplete} from '../person.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type GroupModel from '../../models/Leute/GroupModel.js';
import { createError, isErrorWithCode, type ErrorWithCode } from '@refinio/one.core/lib/errors.js';

const MessageBus = createMessageBus('CommunicationModule');

export type LocalInstanceInfo = {
    personId: SHA256IdHash<Person>; // Id of person
    instanceId: SHA256IdHash<Instance>; // Id of corresponding local instance
    instanceCryptoApi: CryptoApi; // Crypto api
};

/**
 * If the error is an instance of ErrorWithCode, return it, otherwise create a new
 * CONNECTION-ERROR error with the message of the original error.
 * @param error
 * @returns
 */
function getErrorWithCode(error: Error): ErrorWithCode {
    if (isErrorWithCode(error)) {
        return error;
    }
    return createError('CONNECTION-ERROR', {message: error.message});
}

/**
 * This type represents information about a connection.
 *
 * It is used by functions that report the current state of connections to the user
 */
export type ConnectionInfo = {
    // This uniquely identifies a connection Info - which means a potential connection
    id: ConnectionInfoId;
    protocolName: string; // Name of the protocol - chum, pairing, video ...

    isConnected: boolean;
    isInternetOfMe: boolean;
    isCatchAll: boolean;

    localPublicKey: HexString;
    localInstanceId: SHA256IdHash<Instance>;
    localPersonId: SHA256IdHash<Person>;

    remotePublicKey: HexString;
    remoteInstanceId: SHA256IdHash<Instance>;
    remotePersonId: SHA256IdHash<Person>;

    enabled: boolean;
    enable: (enable: boolean) => Promise<void>;

    routes: {
        name: string;
        active: boolean;
        enabled: boolean;
        enable: (enable: boolean) => Promise<void>;
    }[];

    connectionStatisticsLog: Array<ConnectionStatistics & {routeId: string; connectionId: number}>;
};

export type ConnectionInfoId = string & {
    _: 'OneInstanceEndpointId';
};

export function createConnectionInfoId(
    peerId: PeerId,
    connectionRoutesGroupName: string
): ConnectionInfoId {
    return `${peerId}, groupId: ${connectionRoutesGroupName}` as ConnectionInfoId;
}

export type CommserverConfiguration = {
    type: 'commserver';
    url: string;
    catchAll?: boolean;
};

export type SocketConfiguration = {
    type: 'socket';
    host: string; // host to bind to
    port: number; // port to use
    url: string; // Url on how to connect to us - used to check if access is allowed
    catchAll?: boolean;
};

export type IncomingConnectionConfiguration = CommserverConfiguration | SocketConfiguration;

export type LeuteConnectionsModuleConfiguration = {
    // The configuration for incoming connections
    // Default: An empty list => do not accept any incoming connections
    incomingConnectionConfigurations: IncomingConnectionConfiguration[];

    // The configuration for outgoing connections
    // Default: No outgoing connections
    outgoingRoutesGroupIds: string[];

    // The configuration for incoming connections
    // Default: No incoming connections
    incomingRoutesGroupIds: string[];

    // The reconnect delay for outgoing connections
    reconnectDelay: number;

    // If true then new routes will be enabled
    newRoutesEnabled: boolean;
};

export type PeerId = string & {
    _: 'OneInstanceEndpointId';
};

export function createPeerId(localPublicKey: PublicKey, remotePublicKey: PublicKey): PeerId {
    return `localKey: ${castToLocalPublicKey(localPublicKey)}, remoteKey: ${castToRemotePublicKey(
        remotePublicKey
    )}` as PeerId;
}

const peerIdRegex = /localKey: ([0-9a-fA-F]*), remoteKey: ([0-9a-fA-F]*)/;

export function unpackPeerId(peerId: PeerId): {
    localPublicKey: PublicKey;
    remotePublicKey: PublicKey;
} {
    const m = peerId.match(peerIdRegex);

    if (m === null || m.length !== 3) {
        throw new Error('This is not a PeerId');
    }

    return {
        localPublicKey: ensurePublicKey(hexToUint8Array(ensureHexString(m[1]))),
        remotePublicKey: ensurePublicKey(hexToUint8Array(ensureHexString(m[2])))
    };
}

/**
 * This module connects Leute with the lower level connection stuff.
 *
 * This module basically looks for OneInstanceEndpoints in leute and creates connection routes
 * for each of them. See the lowe level ConnectionRouteManager for mor details on what routes are.
 */
export default class LeuteConnectionsModule {
    /**
     *  Event is emitted when the state of the connector changes. The event contains the value of the online state.
     */
    public onOnlineStateChange = new OEvent<(state: boolean) => void>();
    /**
     * Event is emitted when a connection is established or closed.
     */
    public onConnectionsChange = new OEvent<() => void>();

    /**
     * Event that is emitted if an incoming connection was accepted, but the identity of the other side is not known
     */
    public onUnknownConnection = new OEvent<
        (
            conn: Connection,
            localPersonId: SHA256IdHash<Person>,
            localInstanceId: SHA256IdHash<Instance>,
            remotePersonId: SHA256IdHash<Person>,
            remoteInstanceId: SHA256IdHash<Instance>,
            initiatedLocally: boolean,
            routeGropuId: string
        ) => void
    >();

    /**
     * Event that is emitted if an incoming connection was accepted and the identity of the other side is known
     */
    public onKnownConnection = new OEvent<
        (
            conn: Connection,
            localPersonId: SHA256IdHash<Person>,
            localInstanceId: SHA256IdHash<Instance>,
            remotePersonId: SHA256IdHash<Person>,
            remoteInstanceId: SHA256IdHash<Instance>,
            initiatedLocally: boolean,
            routeGropuId: string
        ) => void
    >();

    public onConnectionError = new OEvent<
        (
            error: ErrorWithCode,
            conn: Connection,
            localPersonId?: SHA256IdHash<Person>,
            localInstanceId?: SHA256IdHash<Instance>,
            remotePersonId?: SHA256IdHash<Person>,
            remoteInstanceId?: SHA256IdHash<Instance>,
            initiatedLocally?: boolean,
            routeGropuId?: string
        ) => void
    >();

    private disconnectListeners: (() => void)[];
    private blacklistPersons: SHA256IdHash<Person>[];
    private initialized: boolean; // Flag that stores whether this module is initialized
    private readonly config: LeuteConnectionsModuleConfiguration;
    private readonly leuteModel: LeuteModel; // Contact model for getting contact objects
    private readonly connectionRouteManager: ConnectionRouteManager; // Manager for incoming

    // Internal maps and lists (dynamic)
    private readonly knownPeerMap: Map<PeerId, OneInstanceEndpoint>;
    private readonly myPublicKeyToInstanceInfoMap: Map<LocalPublicKey, LocalInstanceInfo>; // A map
    // from my public instance key to my id - used to map the public key of the new connection to my ids
    private myIdentities: SHA256IdHash<Person>[]; // sync version of
    // this.leute.identities() so that connectionsInfo method doesn't have to be async.

    /**
     * Retrieve the online state based on connections to comm servers.
     *
     * If we don't have connections to comm servers, the state will always be true.
     *
     * @returns
     */
    get onlineState(): boolean {
        return this.connectionRouteManager.onlineState;
    }

    /**
     * Set if new routes are enabled.
     *
     * @param enabled
     */
    set newRoutesEnabled(enabled: boolean) {
        this.config.newRoutesEnabled = enabled;
    }

    /**
     * Returns if new routes will be enabled.
     */
    get newRoutesEnabled(): boolean {
        return this.config.newRoutesEnabled;
    }

    /**
     * Create instance.
     * Outgoing connections are made based on the contact objects.
     *
     * @param leuteModel - The model managing all contacts. Used for deciding which
     * connections to establish.
     * @param config
     */
    constructor(leuteModel: LeuteModel, config: Partial<LeuteConnectionsModuleConfiguration>) {
        this.config = {
            incomingConnectionConfigurations:
                config.incomingConnectionConfigurations !== undefined
                    ? config.incomingConnectionConfigurations
                    : [],
            outgoingRoutesGroupIds:
                config.outgoingRoutesGroupIds !== undefined ? config.outgoingRoutesGroupIds : [],
            incomingRoutesGroupIds:
                config.incomingRoutesGroupIds !== undefined ? config.incomingRoutesGroupIds : [],
            reconnectDelay: config.reconnectDelay !== undefined ? config.reconnectDelay : 5000,
            newRoutesEnabled: config.newRoutesEnabled !== undefined ? config.newRoutesEnabled : true
        };

        this.disconnectListeners = [];
        this.blacklistPersons = [];

        this.leuteModel = leuteModel;
        this.connectionRouteManager = new ConnectionRouteManager(this.config.reconnectDelay);

        this.knownPeerMap = new Map();
        this.myPublicKeyToInstanceInfoMap = new Map();
        this.myIdentities = [];

        this.initialized = false;

        // Setup route manager events
        this.connectionRouteManager.onConnection(this.acceptConnection.bind(this));
        this.connectionRouteManager.onConnectionViaCatchAll(
            this.acceptConnectionViaCatchAll.bind(this)
        );

        this.connectionRouteManager.onOnlineStateChange((onlineState: boolean) => {
            this.onOnlineStateChange.emit(onlineState);
        });

        this.connectionRouteManager.onConnectionsChange(() => {
            this.onConnectionsChange.emit();
        });

        // Setup event for new contact objects on contact management
        this.leuteModel.onNewOneInstanceEndpoint(async (oneInstanceEndpoint, isMe) => {
            this.setupRoutesForOneInstanceEndpoint(oneInstanceEndpoint).catch(console.trace);
        });
    }

    /**
     * Initialize the communication.
     */
    async init(connectionOptions?: {
        blacklistGroup?: GroupModel;
        initiallyDisabledGroup?: GroupModel;
    }): Promise<void> {
        this.initialized = true;

        // Setup event for instance creation
        this.disconnectListeners.push(
            this.leuteModel.onProfileUpdate((profile, isMe) => {
                if (!isMe) {
                    return;
                }

                this.updateCache().catch(console.trace);
            })
        );

        // Setup me identities change
        this.disconnectListeners.push(
            this.leuteModel.onMeIdentitiesChange(() => {
                this.updateCache().catch(console.trace);
            })
        );

        // initially disabled logic
        if (connectionOptions && connectionOptions.initiallyDisabledGroup) {
            this.blacklistPersons = [...connectionOptions.initiallyDisabledGroup.persons];
        }

        // blacklist logic
        if (connectionOptions && connectionOptions.blacklistGroup) {
            this.blacklistPersons.push(...connectionOptions.blacklistGroup.persons);

            this.disconnectListeners.push(
                connectionOptions.blacklistGroup.onUpdated(async (added, removed) => {
                    if (
                        connectionOptions &&
                        connectionOptions.blacklistGroup &&
                        (added || removed)
                    ) {
                        if (added) {
                            for (const personId of added) {
                                await this.disableConnectionsToPerson(personId);
                            }
                        }
                        if (removed) {
                            for (const personId of removed) {
                                await this.enableConnectionsToPerson(personId);
                            }
                        }
                        // addition to initially disabled logic, if presant
                        if (connectionOptions && connectionOptions.initiallyDisabledGroup) {
                            this.blacklistPersons = [
                                ...connectionOptions.initiallyDisabledGroup.persons,
                                ...connectionOptions.blacklistGroup.persons
                            ];
                        } else {
                            this.blacklistPersons = [...connectionOptions.blacklistGroup.persons];
                        }
                    }
                })
            );
        }

        await this.updateCache();
        await this.connectionRouteManager.enableCatchAllRoutes();
    }

    /**
     * Shutdown process
     */
    async shutdown(): Promise<void> {
        this.initialized = false;
        for (const disconnectListener of this.disconnectListeners) {
            disconnectListener();
        }
        await this.connectionRouteManager.disableRoutes();

        // Clear all other fields
        this.knownPeerMap.clear();
        this.myPublicKeyToInstanceInfoMap.clear();
        this.myIdentities = [];
    }

    /**
     * Enable all connections.
     */
    async enableAllConnections(): Promise<void> {
        await this.connectionRouteManager.enableRoutes();
    }

    /**
     * Disable all connections.
     */
    async disableAllConnections(): Promise<void> {
        await this.connectionRouteManager.disableRoutes();
    }

    /**
     * Enable all connections to this person.
     *
     * @param remotePersonId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     * @param enable - if false, then disable instead
     */
    async enableConnectionsToPerson(
        remotePersonId: SHA256IdHash<Person>,
        localPersonId?: SHA256IdHash<Person>,
        enable = true
    ): Promise<void> {
        const remoteInstances = await getInstancesOfPerson(remotePersonId);

        for (const remoteInstance of remoteInstances) {
            if (!remoteInstance.local) {
                await this.enableConnectionsToInstance(
                    remoteInstance.instanceId,
                    localPersonId,
                    enable
                );
            }
        }
    }

    /**
     * Disable all connections to this person.
     *
     * @param remotePersonId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     * @param disable - if false, then enable instead
     */
    async disableConnectionsToPerson(
        remotePersonId: SHA256IdHash<Person>,
        localPersonId?: SHA256IdHash<Person>,
        disable = true
    ): Promise<void> {
        await this.enableConnectionsToPerson(remotePersonId, localPersonId, !disable);
    }

    /**
     * Enable all connections to this instance.
     *
     * @param remoteInstanceId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     * @param enable - if false, then disable instead
     */
    async enableConnectionsToInstance(
        remoteInstanceId: SHA256IdHash<Instance>,
        localPersonId?: SHA256IdHash<Person>,
        enable = true
    ): Promise<void> {
        const remoteKeysList = await Promise.all(
            (await getListOfKeys(remoteInstanceId)).map(keys => getPublicKeys(keys.keys))
        );

        let localKeys;
        if (localPersonId !== undefined) {
            const localInstances = await getInstancesOfPerson(localPersonId);
            const localInstance = localInstances.find(i => i.local);

            if (localInstance === undefined) {
                throw new Error('localPersonId does not have a local instance.');
            }

            localKeys = await getPublicKeys(await getDefaultKeys(localInstance.instanceId));
        }

        for (const remoteKeys of remoteKeysList) {
            if (enable) {
                await this.connectionRouteManager.enableRoutes(
                    localKeys?.publicEncryptionKey,
                    remoteKeys.publicEncryptionKey
                );
            } else {
                await this.connectionRouteManager.disableRoutes(
                    localKeys?.publicEncryptionKey,
                    remoteKeys.publicEncryptionKey
                );
            }
        }
    }

    /**
     * Disable all connections to this instance.
     *
     * @param remoteInstanceId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     * @param disable - if false, then enable instead
     */
    async disableConnectionsToInstance(
        remoteInstanceId: SHA256IdHash<Instance>,
        localPersonId?: SHA256IdHash<Person>,
        disable = true
    ): Promise<void> {
        await this.enableConnectionsToInstance(remoteInstanceId, localPersonId, !disable);
    }

    /**
     * Return information about all known connections.
     *
     * @returns
     */
    connectionsInfo(filterConnectionInfos?: ConnectionInfoId): ConnectionInfo[] {
        const info = this.connectionRouteManager.connectionRoutesInformation();

        const connectionsInfo: ConnectionInfo[] = [];
        for (const routeGroup of info.connectionsRoutesGroups) {
            const peerId = createPeerId(routeGroup.localPublicKey, routeGroup.remotePublicKey);
            const connectionInfoId = createConnectionInfoId(peerId, routeGroup.groupName);

            if (filterConnectionInfos !== undefined && filterConnectionInfos !== connectionInfoId) {
                continue;
            }

            const peerInfo = this.knownPeerMap.get(peerId);
            const myInfo = this.myPublicKeyToInstanceInfoMap.get(
                castToLocalPublicKey(routeGroup.localPublicKey)
            );
            const dummyInstanceId = '0'.repeat(64) as SHA256IdHash<Instance>;
            const dummyPersonId = '0'.repeat(64) as SHA256IdHash<Person>;

            const connectionStatisticsLog = [...routeGroup.connectionStatisticsLog];
            if (routeGroup.activeConnection !== null) {
                connectionStatisticsLog.push({
                    ...routeGroup.activeConnection.statistics,
                    routeId: routeGroup.activeConnectionRoute?.id || '',
                    connectionId: routeGroup.activeConnection.id
                });
            }

            connectionsInfo.push({
                id: connectionInfoId,
                protocolName: routeGroup.groupName,

                isConnected: routeGroup.activeConnection !== null,
                isInternetOfMe: peerInfo ? this.myIdentities.includes(peerInfo.personId) : false,
                isCatchAll: routeGroup.isCatchAllGroup,

                localPublicKey: castToLocalPublicKey(routeGroup.localPublicKey),
                localInstanceId: myInfo ? myInfo.instanceId : dummyInstanceId,
                localPersonId: myInfo ? myInfo.personId : dummyPersonId,

                remotePublicKey: castToRemotePublicKey(routeGroup.remotePublicKey),
                remoteInstanceId: peerInfo ? peerInfo.instanceId : dummyInstanceId,
                remotePersonId: peerInfo ? peerInfo.personId : dummyPersonId,

                enabled: routeGroup.knownRoutes.some(route => !route.disabled),
                enable: (enable: boolean): Promise<void> => {
                    if (enable) {
                        return this.connectionRouteManager.enableRoutes(
                            routeGroup.localPublicKey,
                            routeGroup.remotePublicKey,
                            routeGroup.groupName
                        );
                    } else {
                        return this.connectionRouteManager.disableRoutes(
                            routeGroup.localPublicKey,
                            routeGroup.remotePublicKey,
                            routeGroup.groupName
                        );
                    }
                },

                connectionStatisticsLog,

                routes: routeGroup.knownRoutes.map(route => ({
                    name: route.route.id,
                    active: route.route.id === routeGroup.activeConnectionRoute?.id,
                    enabled: !route.disabled,
                    enable: (enable: boolean): Promise<void> => {
                        if (enable) {
                            return this.connectionRouteManager.enableRoutes(
                                routeGroup.localPublicKey,
                                routeGroup.remotePublicKey,
                                routeGroup.groupName,
                                route.route.id
                            );
                        } else {
                            return this.connectionRouteManager.disableRoutes(
                                routeGroup.localPublicKey,
                                routeGroup.remotePublicKey,
                                routeGroup.groupName,
                                route.route.id
                            );
                        }
                    }
                }))
            });
        }

        return connectionsInfo;
    }

    async updateCache(): Promise<void> {
        await this.updateMyIdentites();
        await this.updateLocalInstancesMap();
        await this.setupRoutes();
    }

    /**
     * Dumps all information about connections and routes in readable form to console.
     */
    debugDump(header: string = ''): void {
        this.connectionRouteManager.debugDump(header);
    }

    // ######## Private stuff ########

    /**
     * Updates this.myIdentities with my own identities from Leute.
     */
    private async updateMyIdentites(): Promise<void> {
        const mySomeone = await this.leuteModel.me();
        this.myIdentities = mySomeone.identities();
    }

    /**
     * Set up a map with peers that we want to connect to. (this.knownPeerMap)
     */
    private async setupRoutes(): Promise<void> {
        // We could do this in a single Promise.all, but ... perhaps this will spam too much
        // connections wildly, so hard to debug - let's leave it like this at the moment
        for (const endpoint of await this.fetchOtherOneInstanceEndpointsFromLeute()) {
            await this.setupRoutesForOneInstanceEndpoint(endpoint.instanceEndpoint);
        }

        // Setup incoming catch all routes
        for (const myInfo of this.myPublicKeyToInstanceInfoMap.values()) {
            for (const config of this.config.incomingConnectionConfigurations) {
                if (!config.catchAll) {
                    continue;
                }

                if (config.type === 'commserver') {
                    const route =
                        this.connectionRouteManager.addIncomingWebsocketRouteCatchAll_CommServer(
                            myInfo.instanceCryptoApi,
                            config.url
                        );

                    if (route.isNew && this.config.newRoutesEnabled) {
                        await this.connectionRouteManager.enableCatchAllRoutes(
                            myInfo.instanceCryptoApi.publicEncryptionKey,
                            route.id
                        );
                    }
                } else if (config.type === 'socket') {
                    const route =
                        this.connectionRouteManager.addIncomingWebsocketRouteCatchAll_Direct(
                            myInfo.instanceCryptoApi,
                            config.host,
                            config.port
                        );

                    if (route.isNew && this.config.newRoutesEnabled) {
                        await this.connectionRouteManager.enableCatchAllRoutes(
                            myInfo.instanceCryptoApi.publicEncryptionKey,
                            route.id
                        );
                    }
                }
            }
        }

        // Notify the user of a change in connections
        this.onConnectionsChange.emit();
    }

    /**
     * Creates outgoing / incoming connection routes for the passed OneInstanceEndpoint.
     *
     * @param remoteInstanceEndpoint
     */
    private async setupRoutesForOneInstanceEndpoint(remoteInstanceEndpoint: OneInstanceEndpoint) {
        const remoteInstanceKeys = await getObject(remoteInstanceEndpoint.instanceKeys);
        const remoteInstanceKey = ensurePublicKey(hexToUint8Array(remoteInstanceKeys.publicKey));

        // Filter out endpoints for this instance
        if (this.myPublicKeyToInstanceInfoMap.has(remoteInstanceKeys.publicKey as LocalPublicKey)) {
            return;
        }

        // Create an outgoing connection for all of my identities
        for (const myInfo of this.myPublicKeyToInstanceInfoMap.values()) {
            const peerId = createPeerId(
                myInfo.instanceCryptoApi.publicEncryptionKey,
                remoteInstanceKey
            );

            // Setup outgoing routes
            if (remoteInstanceEndpoint.url !== undefined) {
                for (const outgoingRoutesGroupId of this.config.outgoingRoutesGroupIds) {
                    if (
                        this.connectionRouteManager.isOutgoingWebsocketRouteExisting(
                            remoteInstanceEndpoint.url,
                            myInfo.instanceCryptoApi.publicEncryptionKey,
                            remoteInstanceKey,
                            outgoingRoutesGroupId
                        )
                    ) {
                        continue;
                    }

                    const route = this.connectionRouteManager.addOutgoingWebsocketRoute(
                        myInfo.instanceCryptoApi.createEncryptionApiWithKeysAndPerson(
                            remoteInstanceKey
                        ),
                        remoteInstanceEndpoint.url,
                        outgoingRoutesGroupId
                    );

                    if (
                        route.isNew &&
                        this.config.newRoutesEnabled &&
                        !this.blacklistPersons.includes(remoteInstanceEndpoint.personId)
                    ) {
                        await this.connectionRouteManager.enableRoutes(
                            myInfo.instanceCryptoApi.publicEncryptionKey,
                            remoteInstanceKey,
                            outgoingRoutesGroupId,
                            route.id
                        );
                    }
                }
            }

            // Setup incoming routes
            for (const incomingRoutesGroupId of this.config.incomingRoutesGroupIds) {
                for (const config of this.config.incomingConnectionConfigurations) {
                    if (config.type === 'commserver') {
                        const route =
                            this.connectionRouteManager.addIncomingWebsocketRoute_CommServer(
                                myInfo.instanceCryptoApi,
                                remoteInstanceKey,
                                config.url,
                                incomingRoutesGroupId
                            );

                        if (
                            route.isNew &&
                            this.config.newRoutesEnabled &&
                            !this.blacklistPersons.includes(remoteInstanceEndpoint.personId)
                        ) {
                            await this.connectionRouteManager.enableRoutes(
                                myInfo.instanceCryptoApi.publicEncryptionKey,
                                remoteInstanceKey,
                                incomingRoutesGroupId,
                                route.id
                            );
                        }
                    } else if (config.type === 'socket') {
                        const route = this.connectionRouteManager.addIncomingWebsocketRoute_Direct(
                            myInfo.instanceCryptoApi,
                            remoteInstanceKey,
                            config.host,
                            config.port,
                            incomingRoutesGroupId
                        );

                        if (
                            route.isNew &&
                            this.config.newRoutesEnabled &&
                            !this.blacklistPersons.includes(remoteInstanceEndpoint.personId)
                        ) {
                            await this.connectionRouteManager.enableRoutes(
                                myInfo.instanceCryptoApi.publicEncryptionKey,
                                remoteInstanceKey,
                                incomingRoutesGroupId,
                                route.id
                            );
                        }
                    }
                }
            }

            this.knownPeerMap.set(peerId, remoteInstanceEndpoint);
        }
    }

    /**
     * Get all instance endpoints that don't represent this instance.
     */
    private async fetchOtherOneInstanceEndpointsFromLeute(): Promise<
        {instanceEndpoint: OneInstanceEndpoint; isIom: boolean}[]
    > {
        // My non local instanceEndpoints
        const myEndpoints = (await this.leuteModel.getInternetOfMeEndpoints()).map(
            instanceEndpoint => {
                return {
                    instanceEndpoint,
                    isIom: true
                };
            }
        );

        // Instance endpoints for all other instances / persons
        const otherEndpoints = (await this.leuteModel.findAllOneInstanceEndpointsForOthers()).map(
            instanceEndpoint => {
                return {
                    instanceEndpoint,
                    isIom: false
                };
            }
        );

        // Fill all endpoints into this.knownPeerMap and this.establishedConnections
        return myEndpoints.concat(otherEndpoints);
    }

    /**
     * Updates all the instance info related members in the class.
     */
    private async updateLocalInstancesMap(): Promise<void> {
        const mySomeone = await this.leuteModel.me();

        await Promise.all(
            mySomeone.identities().map(async identity => {
                if (!(await isPersonComplete(identity))) {
                    return;
                }

                const instanceId = await getLocalInstanceOfPerson(identity);
                const keysHash = await getDefaultKeys(instanceId);
                const keys = await getObject(keysHash);

                this.myPublicKeyToInstanceInfoMap.set(keys.publicKey as LocalPublicKey, {
                    instanceId,
                    instanceCryptoApi: await createCryptoApiFromDefaultKeys(instanceId),
                    personId: identity
                });
            })
        );
    }

    // ######## Event handlers ########

    /**
     * Accept a new connection.
     *
     * This is used for incoming as well as outgoing connections.
     *
     * @param conn - The encrypted connection that was accepted.
     * @param localPublicKey - The public key of the local instance
     * @param remotePublicKey - The public key of the remote peer
     * @param connectionRoutesGroupName
     * @param initiatedLocally
     */
    private async acceptConnection(
        conn: Connection,
        localPublicKey: PublicKey,
        remotePublicKey: PublicKey,
        connectionRoutesGroupName: string,
        initiatedLocally: boolean
    ): Promise<void> {
        try {
            const peerId = createPeerId(localPublicKey, remotePublicKey);

            const oneInstanceEndpoint = this.knownPeerMap.get(peerId);
            if (oneInstanceEndpoint === undefined) {
                conn.close(
                    'Could not find a OneInstanceEndpoint for you. This seems like a programming' +
                        ' error or you were removed from contacts just as you tried to establish a' +
                        ' connection.'
                );
                return;
            }

            const myInfo = this.myPublicKeyToInstanceInfoMap.get(castToLocalPublicKey(localPublicKey));
            if (myInfo === undefined) {
                conn.close(
                    'Could not find the person that you want to communicate with. This seems like a' +
                        ' programming error.'
                );
                return;
            }

            try {
                MessageBus.send('log', `${conn.id}: acceptConnection: verifyAndExchangePersonId`);

                const personInfo = await verifyAndExchangePersonId(
                    this.leuteModel,
                    conn,
                    myInfo.personId,
                    initiatedLocally,
                    oneInstanceEndpoint.personId
                );

                MessageBus.send('log', `${conn.id}: acceptConnection: exchangeInstanceIdObjects`);

                const instanceInfo = await exchangeInstanceIdObjects(conn, myInfo.instanceId);

                if (oneInstanceEndpoint.instanceId !== instanceInfo.remoteInstanceId) {
                    throw new Error(
                        'The instance id we have on record for your specified public key does not match' +
                            ' the instance id that you sent us.'
                    );
                }

                // Exchange these things:
                // - Instance keys [already and verified by lower levels]
                // - Person keys
                // - Person Id(Obj)
                // - Instance Id(Obj)

                // ---- Before this ----
                // receive instance key
                // -> challenge the key
                // ---- This ----
                // receive instance id (hint)
                // -> lookup key in instance entries
                // receive person key
                // -> challenge the key
                // receive person id (this is a hint to faster find the key)
                // -> lookup the key in the persons entries

                this.onKnownConnection.emit(
                    conn,
                    myInfo.personId,
                    myInfo.instanceId,
                    oneInstanceEndpoint.personId,
                    oneInstanceEndpoint.instanceId,
                    initiatedLocally,
                    connectionRoutesGroupName
                );
                this.onConnectionsChange.emit();
            } catch (error) {
                this.onConnectionError.emit(getErrorWithCode(error), conn, myInfo.personId, myInfo.instanceId, oneInstanceEndpoint.personId, oneInstanceEndpoint.instanceId, initiatedLocally, connectionRoutesGroupName);
            }
        } catch (error) {
            this.onConnectionError.emit(getErrorWithCode(error), conn, undefined, undefined, undefined, undefined, initiatedLocally, connectionRoutesGroupName);
        }
    }

    /**
     *
     * @param conn
     * @param localPublicKey
     * @param remotePublicKey
     * @param connectionRoutesGroupName
     * @param initiatedLocally
     * @private
     */
    private async acceptConnectionViaCatchAll(
        conn: Connection,
        localPublicKey: PublicKey,
        remotePublicKey: PublicKey,
        connectionRoutesGroupName: string,
        initiatedLocally: boolean
    ): Promise<void> {
        try {
            const peerId = createPeerId(localPublicKey, remotePublicKey);

            const oneInstanceEndpoint = this.knownPeerMap.get(peerId);

            const myInfo = this.myPublicKeyToInstanceInfoMap.get(castToLocalPublicKey(localPublicKey));
            if (myInfo === undefined) {
                conn.close('Could not find the person that you want to communicate with.');
                return;
            }

            try {
                const personInfo = await verifyAndExchangePersonId(
                    this.leuteModel,
                    conn,
                    myInfo.personId,
                    initiatedLocally,
                    oneInstanceEndpoint?.personId
                );

                const instanceInfo = await exchangeInstanceIdObjects(conn, myInfo.instanceId);

                if (oneInstanceEndpoint !== undefined) {
                    if (oneInstanceEndpoint.instanceId !== instanceInfo.remoteInstanceId) {
                        throw new Error(
                            'The instance id we have on record for your specified public key does not match' +
                                ' the instance id that you sent us.'
                        );
                    }

                    this.onKnownConnection.emit(
                        conn,
                        myInfo.personId,
                        myInfo.instanceId,
                        oneInstanceEndpoint.personId,
                        oneInstanceEndpoint.instanceId,
                        initiatedLocally,
                        connectionRoutesGroupName
                    );
                } else {
                    await storeIdObject(instanceInfo.remoteInstanceIdObject);

                    this.onUnknownConnection.emit(
                        conn,
                        myInfo.personId,
                        myInfo.instanceId,
                        personInfo.personId,
                        instanceInfo.remoteInstanceId,
                        initiatedLocally,
                        connectionRoutesGroupName
                    );
                }
                this.onConnectionsChange.emit();
            } catch (error) {
                this.onConnectionError.emit(getErrorWithCode(error), conn, myInfo.personId, myInfo.instanceId, oneInstanceEndpoint?.personId, oneInstanceEndpoint?.instanceId, initiatedLocally, connectionRoutesGroupName);
            }
        } catch (error) {
            this.onConnectionError.emit(getErrorWithCode(error), conn, undefined, undefined, undefined, undefined, initiatedLocally, connectionRoutesGroupName);
        }
    }
}
