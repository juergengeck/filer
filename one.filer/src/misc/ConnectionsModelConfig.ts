/**
 * This stuff should probably be moved to one.models.
 */

import {isObject} from '@refinio/one.core/lib/util/type-checks-basic';
import type {ConnectionsModelConfiguration} from '@refinio/one.models/lib/models/ConnectionsModel';

export const DefaultConnectionsModelConfig: ConnectionsModelConfiguration = {
    commServerUrl: 'wss://comm10.dev.refinio.one',
    acceptIncomingConnections: true,
    acceptUnknownInstances: false,
    acceptUnknownPersons: false,
    allowPairing: true,
    pairingTokenExpirationDuration: 2147483647,
    establishOutgoingConnections: true
};

export function checkConnectionsModelConfig(
    config: unknown
): Partial<ConnectionsModelConfiguration> {
    if (!isObject(config)) {
        throw new Error('Connections configuration needs to be an object.');
    }

    if (
        Object.hasOwn(config, 'commServerUrl') &&
        (typeof config.commServerUrl !== 'string' ||
            !/^wss?:\/\/\w+(\.\w+)*(:[0-9]+)?\/?(\/[.\w]*)*$/.test(config.commServerUrl))
    ) {
        throw new Error(
            '"commServerUrl" of connections configuration needs to be string and a wss? url.'
        );
    }

    for (const param of [
        'acceptIncomingConnections',
        'acceptUnknownInstances',
        'acceptUnknownPersons',
        'allowPairing',
        'establishOutgoingConnections'
    ]) {
        if (Object.hasOwn(config, param) && typeof config[param] !== 'string') {
            throw new Error(`"${param}" of connections configuration needs to be boolean.`);
        }
    }

    if (Object.hasOwn(config, 'pairingUrl') && typeof config.pairingUrl !== 'string') {
        throw new Error('"pairingUrl" of connections configuration needs to be a string.');
    }

    if (
        Object.hasOwn(config, 'iomMode') &&
        (typeof config.iomMode !== 'string' || !['light', 'full'].includes(config.iomMode))
    ) {
        throw new Error('"iomMode" of connections configuration needs to be "light" or "full"');
    }

    if (
        Object.hasOwn(config, 'pairingTokenExpirationDuration') !== undefined &&
        typeof config.logCalls !== 'number'
    ) {
        throw new Error(
            '"pairingTokenExpirationDuration" of connections configuration needs to be a number'
        );
    }

    return config as ConnectionsModelConfiguration;
}
