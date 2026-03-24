import {isObject} from '@refinio/one.core/lib/util/type-checks-basic';
import type {ConnectionsModelConfiguration} from '@refinio/one.models/lib/models/ConnectionsModel';
import type {FilerConfig} from './filer/FilerConfig';
import {checkFilerConfig, DefaultFilerConfig} from './filer/FilerConfig';
import {DefaultConnectionsModelConfig} from './misc/ConnectionsModelConfig';

export interface ReplicantConfig {
    directory: string;
    commServerUrl: string;
    createEveryoneGroup: boolean;

    useFiler: boolean;
    filerConfig: FilerConfig;

    connectionsConfig: ConnectionsModelConfiguration;
}

export const DefaultReplicantConfig: ReplicantConfig = {
    directory: 'data',
    commServerUrl: 'wss://comm10.dev.refinio.one',
    createEveryoneGroup: true,

    useFiler: false,
    filerConfig: DefaultFilerConfig,

    connectionsConfig: DefaultConnectionsModelConfig
};

export function checkReplicantConfig(config: unknown): Partial<ReplicantConfig> {
    if (!isObject(config)) {
        throw new Error('Replicant configuration needs to be an object.');
    }

    if (Object.hasOwn(config, 'directory') && typeof config.directory !== 'string') {
        throw new Error('"directory" of Replicant configuration needs to be string.');
    }

    if (
        Object.hasOwn(config, 'commServerUrl') &&
        (typeof config.commServerUrl !== 'string' ||
            !/^wss?:\/\/\w+(\.\w+)*(:[0-9]+)?\/?(\/[.\w]*)*$/.test(config.commServerUrl))
    ) {
        throw new Error(
            '"commServerUrl" of Replicant configuration needs to be string and a wss? url.'
        );
    }

    if (
        Object.hasOwn(config, 'createEveryoneGroup') &&
        typeof config.createEveryoneGroup !== 'boolean'
    ) {
        throw new Error('"createEveryoneGroup" of Replicant configuration needs to be boolean.');
    }

    if (Object.hasOwn(config, 'useFiler') && typeof config.useFiler !== 'boolean') {
        throw new Error('"useFiler" of Replicant configuration needs to be boolean.');
    }

    if (Object.hasOwn(config, 'filerConfig')) {
        checkFilerConfig(config.filerConfig);
    }

    return config as ReplicantConfig;
}
