import type {PublicKey} from '@refinio/one.core/lib/crypto/encryption.js';
import type Connection from '../Connection/Connection.js';
import type {ConnectionStatistics} from '../Connection/plugins/StatisticsPlugin.js';
import type ConnectionRoute from './routes/ConnectionRoute.js';

export type ConnectionRoutes = {route: ConnectionRoute; disabled: boolean}[];

export type ConnectionRoutesGroup = {
    // part of the map key
    groupName: string;
    localPublicKey: PublicKey;
    remotePublicKey: PublicKey;
    isCatchAllGroup: boolean;

    // Connection & routes
    activeConnection: Connection | null;
    activeConnectionRoute: ConnectionRoute | null;
    knownRoutes: ConnectionRoutes;
    connectionStatisticsLog: Array<ConnectionStatistics & {routeId: string; connectionId: number}>;

    // Internal stuff needed to handle reconnects and connection losses.
    dropDuplicates: boolean; // If this is true, duplicate connections will be dropped,
    closeHandler: (() => void) | null;
    disconnectCloseHandler: (() => void) | null;
    reconnectTimeoutHandle: ReturnType<typeof setTimeout> | null;
    dropDuplicatesTimeoutHandle: ReturnType<typeof setTimeout> | null;
};
