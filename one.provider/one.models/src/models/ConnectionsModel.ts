import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {Instance} from '@refinio/one.core/lib/recipes.js';
import {startChumProtocol} from '../misc/ConnectionEstablishment/protocols/Chum.js';
import type {Protocols} from '../misc/ConnectionEstablishment/protocols/CommunicationInitiationProtocolMessages.js';
import type {
    ConnectionInfo,
    ConnectionInfoId
} from '../misc/ConnectionEstablishment/LeuteConnectionsModule.js';
import LeuteConnectionsModule from '../misc/ConnectionEstablishment/LeuteConnectionsModule.js';
import type {IncomingConnectionConfiguration} from '../misc/ConnectionEstablishment/LeuteConnectionsModule.js';
import {acceptDebugRequest} from '../misc/ConnectionEstablishment/protocols/Debug.js';
import {OEvent} from '../misc/OEvent.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import type LeuteModel from './Leute/LeuteModel.js';
import {Model} from './Model.js';
import type Connection from '../misc/Connection/Connection.js';
import PairingManager from '../misc/ConnectionEstablishment/PairingManager.js';
import GroupModel from './Leute/GroupModel.js';
import type { ErrorWithCode } from '@refinio/one.core/lib/errors.js';

const MessageBus = createMessageBus('ConnectionsModel');

/**
 * Configuration parameters for the ConnectionsModel
 *
 * TODO: Most of the config values will come from the local instance config
 *       So each instance can decide how it can be reached.
 */
export type ConnectionsModelConfiguration = {
    // #### Incoming connections ####

    // The comm server to use for incoming connections.
    // Default: ws://localhost:8000
    commServerUrl: string;

    // If true accept incoming connections. If not do only outgoing
    // Default: true
    acceptIncomingConnections: boolean;

    // Custom incoming connection configurations for multiple transports (socket, commserver, etc)
    // If provided, this overrides the default commServerUrl behavior
    // Default: undefined (uses commServerUrl)
    incomingConnectionConfigurations?: IncomingConnectionConfiguration[];

    // #### Incoming connections - chum workflow settings (incoming) ####

    // If true accept unknown instances of known persons (incoming connections)
    // Default: false
    acceptUnknownInstances: boolean;

    // If true accept unknown instances and unknown persons (incoming connections)
    // Default: false
    acceptUnknownPersons: boolean;

    // #### Incoming connections - One time auth workflow settings (incoming) ####

    // If true allow one time authentication workflows (incoming connections)
    // Default: true
    allowPairing: boolean;

    // If true allow incoming debug requests (See debug protocol)
    // Default: false
    allowDebugRequests: boolean;

    // The amount of time an authentication token is valid (incoming connections)
    // Default: 60000 (1 minute)
    pairingTokenExpirationDuration: number;

    // #### Outgoing connection configuration ####
    // If true automatically establish outgoing connections
    // Default: true
    establishOutgoingConnections: boolean;

    // #### Chum Settings ####

    // If true, then do not start the chum importer for all chum connections - useful for debugging
    // Default: false
    noImport: boolean;

    // If true, then do not start the chum exporter for all chum connections - useful for debugging
    // Default: false
    noExport: boolean;

    // Optional filter function to control which objects are shared during chum sync
    // This enables selective sharing of Group/Access objects based on assertions/certificates
    // Default: undefined (uses one.core default behavior - blocks Group/Access)
    objectFilter?: (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>;

};

/**
 * This model manages all connections including pairing scenarios etc.
 *
 * The lower levels handle the complete connection establishment based on information found in
 * Leute. This module just executes the correct protocol when a connection was established (e.g.
 * the chum, or the pairing protocol ...)
 *
 * Pairing:
 * Pairing is handled by the PairingManager that can be accessed by ".pairing" on this module.
 */
class ConnectionsModel extends Model {
    /**
     * Event is emitted when state of the connector changes. The emitted value represents the updated state.
     */
    public onOnlineStateChange = new OEvent<(state: boolean) => void>();

    /**
     * Event is emitted when a connection is established or closed.
     */
    public onConnectionsChange = new OEvent<() => void>();

    /**
     * Event is emitted when a connection error occurs.
     */
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

    /**
     * Event is emitted when the chum starts.
     */
    public onProtocolStart = new OEvent<
        (
            initiatedLocally: boolean,
            localPersonId: SHA256IdHash<Person>,
            localInstanceId: SHA256IdHash<Instance>,
            remotePersonId: SHA256IdHash<Person>,
            remoteInstanceId: SHA256IdHash<Instance>,
            protocol: Protocols
        ) => void
    >();

    public readonly pairing: PairingManager;

    private readonly config: ConnectionsModelConfiguration;
    private readonly leuteConnectionsModule: LeuteConnectionsModule;
    private readonly leuteModel: LeuteModel;
    private initiallyDisabledGroup: GroupModel | undefined;

    /**
     * Retrieve the online state based on connections to comm servers.
     *
     * If we don't have connections to comm servers, the state will always be true.
     *
     * @returns
     */
    public get onlineState(): boolean {
        return this.leuteConnectionsModule.onlineState;
    }

    /**
     * Set if new routes are enabled.
     *
     * @param enabled
     */
    set newRoutesEnabled(enabled: boolean) {
        this.leuteConnectionsModule.newRoutesEnabled = enabled;
    }

    /**
     * Returns if new routes will be enabled.
     */
    get newRoutesEnabled(): boolean {
        return this.leuteConnectionsModule.newRoutesEnabled;
    }

    /**
     * Construct a new instance
     *
     * @param leuteModel
     * @param config
     */
    constructor(leuteModel: LeuteModel, config: Partial<ConnectionsModelConfiguration>) {
        super();
        // Build configuration object by using default values
        this.config = {
            commServerUrl:
                config.commServerUrl === undefined ? 'ws://localhost:8000' : config.commServerUrl,
            acceptIncomingConnections:
                config.acceptIncomingConnections === undefined
                    ? true
                    : config.acceptIncomingConnections,
            acceptUnknownInstances:
                config.acceptUnknownInstances === undefined ? false : config.acceptUnknownInstances,
            acceptUnknownPersons:
                config.acceptUnknownPersons === undefined ? false : config.acceptUnknownPersons,
            allowPairing: config.allowPairing === undefined ? true : config.allowPairing,
            allowDebugRequests:
                config.allowDebugRequests === undefined ? true : config.allowDebugRequests,
            pairingTokenExpirationDuration:
                config.pairingTokenExpirationDuration === undefined
                    ? 60000
                    : config.pairingTokenExpirationDuration,
            establishOutgoingConnections:
                config.establishOutgoingConnections === undefined
                    ? true
                    : config.establishOutgoingConnections,
            noImport: config.noImport === undefined ? false : config.noImport,
            noExport: config.noExport === undefined ? false : config.noExport,
            incomingConnectionConfigurations: config.incomingConnectionConfigurations
        };

        // Setup / init modules
        this.leuteModel = leuteModel;

        const catchAll =
            this.config.allowPairing ||
            this.config.acceptUnknownInstances ||
            this.config.acceptUnknownPersons;
        
        // Use custom incoming connection configurations if provided, otherwise use default commserver
        const incomingConfigs = this.config.incomingConnectionConfigurations ||
            (this.config.acceptIncomingConnections
                ? [{type: 'commserver' as const, url: this.config.commServerUrl, catchAll}]
                : []);
        
        this.leuteConnectionsModule = new LeuteConnectionsModule(leuteModel, {
            incomingConnectionConfigurations: incomingConfigs,
            incomingRoutesGroupIds: this.config.allowDebugRequests ? ['chum', 'debug'] : ['chum'],
            outgoingRoutesGroupIds: this.config.establishOutgoingConnections ? ['chum'] : [],
            reconnectDelay: 5000,
            newRoutesEnabled: true  // Ensure new routes (like socket listeners) are enabled
        });
        this.leuteConnectionsModule.onKnownConnection(this.onKnownConnection.bind(this));
        this.leuteConnectionsModule.onUnknownConnection(this.onUnknownConnection.bind(this));
        this.leuteConnectionsModule.onOnlineStateChange(state => {
            this.onOnlineStateChange.emit(state);
        });
        this.leuteConnectionsModule.onConnectionsChange(() => {
            this.onConnectionsChange.emit();
        });
        this.leuteConnectionsModule.onConnectionError((error, conn, localPersonId, localInstanceId, remotePersonId, remoteInstanceId, initiatedLocally, routeGropuId) => {
            if (this.onConnectionError.listenerCount() > 0) {
                this.onConnectionError.emit(error, conn, localPersonId, localInstanceId, remotePersonId, remoteInstanceId, initiatedLocally, routeGropuId);
            } else {
                throw error;
            }
        });

        this.pairing = new PairingManager(
            this.leuteModel,
            this.config.pairingTokenExpirationDuration,
            this.config.commServerUrl
        );
    }

    /**
     * Initialize this module.
     */
    async init(blacklistGroup?: GroupModel): Promise<void> {
        this.state.assertCurrentState('Uninitialised');
        this.initiallyDisabledGroup = await GroupModel.constructWithNewGroup('initiallyDisabled');
        await this.leuteConnectionsModule.init({
            blacklistGroup,
            initiallyDisabledGroup: this.initiallyDisabledGroup
        });
        this.state.triggerEvent('init');
    }

    /**
     * Shutdown module
     */
    async shutdown(): Promise<void> {
        this.state.assertCurrentState('Initialised');
        await this.leuteConnectionsModule.shutdown();
        this.pairing.invalidateAllInvitations();
        this.state.triggerEvent('shutdown');
    }

    /**
     * Enable all connections.
     */
    async enableAllConnections(): Promise<void> {
        await this.leuteConnectionsModule.enableAllConnections();
    }

    /**
     * Disable all connections.
     */
    async disableAllConnections(): Promise<void> {
        await this.leuteConnectionsModule.disableAllConnections();
    }

    /**
     * Enable all connections to this person.
     *
     * @param remotePersonId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     */
    async enableConnectionsToPerson(
        remotePersonId: SHA256IdHash<Person>,
        localPersonId?: SHA256IdHash<Person>
    ): Promise<void> {
        if (
            this.initiallyDisabledGroup &&
            this.initiallyDisabledGroup.persons.includes(remotePersonId)
        ) {
            this.initiallyDisabledGroup.persons = this.initiallyDisabledGroup.persons.filter(
                pId => pId !== remotePersonId
            );
            await this.initiallyDisabledGroup.saveAndLoad();
        }
        await this.leuteConnectionsModule.enableConnectionsToPerson(remotePersonId, localPersonId);
    }

    /**
     * Disable all connections to this person.
     *
     * @param remotePersonId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     */
    async disableConnectionsToPerson(
        remotePersonId: SHA256IdHash<Person>,
        localPersonId?: SHA256IdHash<Person>
    ): Promise<void> {
        if (
            this.initiallyDisabledGroup &&
            !this.initiallyDisabledGroup.persons.includes(remotePersonId)
        ) {
            this.initiallyDisabledGroup.persons.push(remotePersonId);
            await this.initiallyDisabledGroup.saveAndLoad();
        }
        await this.leuteConnectionsModule.disableConnectionsToPerson(remotePersonId, localPersonId);
    }

    /**
     * Enable all connections to this instance.
     *
     * @param remoteInstanceId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     */
    async enableConnectionsToInstance(
        remoteInstanceId: SHA256IdHash<Instance>,
        localPersonId?: SHA256IdHash<Person>
    ): Promise<void> {
        await this.leuteConnectionsModule.enableConnectionsToInstance(
            remoteInstanceId,
            localPersonId
        );
    }

    /**
     * Disable all connections to this instance.
     *
     * @param remoteInstanceId
     * @param localPersonId - If specified only the connections originating from this person are
     * affected.
     */
    async disableConnectionsToInstance(
        remoteInstanceId: SHA256IdHash<Instance>,
        localPersonId?: SHA256IdHash<Person>
    ): Promise<void> {
        await this.leuteConnectionsModule.disableConnectionsToInstance(
            remoteInstanceId,
            localPersonId
        );
    }

    /**
     * Returns information about all connections and routes.
     */
    connectionsInfo(filterConnectionInfos?: ConnectionInfoId): ConnectionInfo[] {
        return this.leuteConnectionsModule.connectionsInfo(filterConnectionInfos);
    }

    /**
     * Dumps all information about connections and routes in readable form to console.
     */
    debugDump(header: string = ''): void {
        this.leuteConnectionsModule.debugDump(header);
    }

    // ######## PAIRING ########

    /**
     * This function is called whenever a connection with a known instance was established
     *
     * @param conn
     * @param localPersonId
     * @param localInstanceId
     * @param remotePersonId
     * @param remoteInstanceId
     * @param initiatedLocally
     * @param connectionRoutesGroupName
     */
    private async onKnownConnection(
        conn: Connection,
        localPersonId: SHA256IdHash<Person>,
        localInstanceId: SHA256IdHash<Instance>,
        remotePersonId: SHA256IdHash<Person>,
        remoteInstanceId: SHA256IdHash<Instance>,
        initiatedLocally: boolean,
        connectionRoutesGroupName: string
    ): Promise<void> {
        MessageBus.send('log', `${conn.id}: onKnownConnection()`);

        try {
            if (connectionRoutesGroupName === 'chum') {
                await startChumProtocol(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId,
                    initiatedLocally,
                    connectionRoutesGroupName,
                    this.onProtocolStart,
                    this.config.noImport,
                    this.config.noExport,
                    this.config.objectFilter
                );
            } else if (connectionRoutesGroupName === 'pairing') {
                await this.pairing.acceptInvitation(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId
                );
                // After pairing succeeds, transition to CHUM on the same connection
                console.log('[ConnectionsModel] Pairing complete (known), transitioning to CHUM...');
                await startChumProtocol(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId,
                    false,  // initiatedLocally = false for accept side
                    'chum',  // connectionRoutesGroupName
                    this.onProtocolStart,
                    this.config.noImport,
                    this.config.noExport,
                    this.config.objectFilter
                );
            } else if (connectionRoutesGroupName === 'debug') {
                await acceptDebugRequest(conn, remotePersonId);
            } else {
                throw new Error(
                    `ConnectionRoutesGroupName ${connectionRoutesGroupName} not supported`
                );
            }
        } catch (e) {
            MessageBus.send('log', `${conn.id}: onKnownConnection: Error in protocol ${e}`);
            conn.close(e.toString());
            return;
        }
    }

    /**
     * This function is called whenever a connection with an unknown instance was established
     *
     * @param conn
     * @param localPersonId
     * @param localInstanceId
     * @param remotePersonId
     * @param remoteInstanceId
     * @param initiatedLocally
     * @param connectionRoutesGroupName
     */
    private async onUnknownConnection(
        conn: Connection,
        localPersonId: SHA256IdHash<Person>,
        localInstanceId: SHA256IdHash<Instance>,
        remotePersonId: SHA256IdHash<Person>,
        remoteInstanceId: SHA256IdHash<Instance>,
        initiatedLocally: boolean,
        connectionRoutesGroupName: string
    ): Promise<void> {
        MessageBus.send('log', `${conn.id}: onUnknownConnection()`);

        try {
            // On outgoing connections we try to use the chum protocol
            if (initiatedLocally) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('Locally initiated connections should never be unknown.');
            }

            if (connectionRoutesGroupName === 'chum') {
                if (!this.config.acceptUnknownPersons) {
                    throw new Error('Unable to start chum because you are unknown');
                }

                await startChumProtocol(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId,
                    initiatedLocally,
                    connectionRoutesGroupName,
                    this.onProtocolStart,
                    this.config.noImport,
                    this.config.noExport,
                    this.config.objectFilter
                );
            } else if (connectionRoutesGroupName === 'debug') {
                await acceptDebugRequest(conn, remotePersonId);
            } else if (connectionRoutesGroupName === 'pairing') {
                await this.pairing.acceptInvitation(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId
                );
                // After pairing succeeds, transition to CHUM on the same connection
                console.log('[ConnectionsModel] Pairing complete (unknown), transitioning to CHUM...');
                console.log('[ConnectionsModel] TRACE: About to call startChumProtocol, conn:', conn);
                await startChumProtocol(
                    conn,
                    localPersonId,
                    localInstanceId,
                    remotePersonId,
                    remoteInstanceId,
                    false,  // initiatedLocally = false for accept side
                    'chum',  // connectionRoutesGroupName
                    this.onProtocolStart,
                    this.config.noImport,
                    this.config.noExport,
                    this.config.objectFilter
                );
                console.log('[ConnectionsModel] TRACE: startChumProtocol returned successfully');
            } else {
                throw new Error(
                    `ConnectionRoutesGroupName ${connectionRoutesGroupName} not supported`
                );
            }
        } catch (e) {
            MessageBus.send('log', `${conn.id}: onUnknownConnection: Error in protocol ${e}`);
            conn.close(e.toString());
            return;
        }
    }
}

export default ConnectionsModel;
