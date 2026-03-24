import EasyFileSystem, {type EasyDirectoryContent} from '@refinio/one.models/lib/fileSystems/utils/EasyFileSystem.js';
import {MDNSDiscovery, type MDNSDiscoveredDevice} from './mdns-discovery.js';

export type DeviceDiscoveryConfig = {
    deviceId: string;
    ownerId: string;
    email: string;
    displayName: string;
    publicSignKey: string;
    deviceType: string;
    quicvcPort: number;
    webPort?: number;
    logger?: {
        info(message: string): void;
        error(message: string): void;
        warning?(message: string): void;
        debug?(message: string): void;
    };
};

type DeviceDiscoveryState = 'starting' | 'ready' | 'error' | 'stopped';

type LocalDeviceInfo = {
    deviceId: string;
    ownerId: string;
    email: string;
    displayName: string;
    deviceType: string;
    quicvcPort: number;
    webPort: number | null;
};

type DeviceDiscoveryStatus = {
    state: DeviceDiscoveryState;
    startedAt: string;
    lastUpdatedAt: string;
    error: string | null;
    localDevice: LocalDeviceInfo;
    counts: {
        mdns: number;
        quicvc: number;
    };
};

type MDNSDeviceRecord = {
    id: string;
    name: string;
    address: string;
    port: number;
    publicKey: string | null;
    email: string | null;
    deviceType: string | null;
    capabilities: string[];
    discoveredAt: number;
    lastSeen: number;
};

type QuicVCPeerRecord = {
    id: string;
    name: string;
    address: string;
    port: number;
    url: string;
    publicKey: string | null;
    email: string | null;
    deviceType: string | null;
    capabilities: string[];
    discoveryMethod: 'mdns';
    credentialStatus: 'unverified';
    discoveredAt: number;
    lastSeenAt: number;
};

export class DeviceDiscoveryService {
    private readonly mdns = new MDNSDiscovery();
    private readonly disconnectFns: Array<() => void> = [];
    private readonly startedAt = new Date().toISOString();
    private state: DeviceDiscoveryState = 'starting';
    private lastError: string | null = null;
    private lastUpdatedAt = this.startedAt;

    constructor(private readonly config: DeviceDiscoveryConfig) {}

    async initialize(): Promise<void> {
        this.attachEventListeners();

        try {
            await this.mdns.start(
                this.config.deviceId,
                this.config.publicSignKey,
                this.config.displayName,
                this.config.quicvcPort,
                undefined,
                this.config.webPort,
                this.config.email,
                this.config.deviceType
            );

            this.state = 'ready';
            this.lastError = null;
            this.markUpdated();
            this.config.logger?.info(
                `[DeviceDiscovery] mDNS started for ${this.config.displayName} (${this.config.deviceId})`
            );
        } catch (error) {
            this.state = 'error';
            this.lastError = error instanceof Error ? error.message : String(error);
            this.markUpdated();
            this.config.logger?.error(
                `[DeviceDiscovery] Failed to start mDNS discovery: ${this.lastError}`
            );
        }
    }

    async shutdown(): Promise<void> {
        for (const disconnect of this.disconnectFns.splice(0)) {
            disconnect();
        }

        await this.mdns.stop();
        this.state = 'stopped';
        this.markUpdated();
    }

    getStatus(): DeviceDiscoveryStatus {
        const mdnsDevices = this.getMdnsDevices();

        return {
            state: this.state,
            startedAt: this.startedAt,
            lastUpdatedAt: this.lastUpdatedAt,
            error: this.lastError,
            localDevice: this.getLocalDeviceInfo(),
            counts: {
                mdns: mdnsDevices.length,
                quicvc: mdnsDevices.length
            }
        };
    }

    getOverview(): {
        status: DeviceDiscoveryStatus;
        mdns: MDNSDeviceRecord[];
        quicvc: QuicVCPeerRecord[];
    } {
        return {
            status: this.getStatus(),
            mdns: this.getMdnsDevices(),
            quicvc: this.getQuicVCPeers()
        };
    }

    getMdnsDevices(): MDNSDeviceRecord[] {
        return this.mdns
            .getDiscoveredDevices()
            .map((device) => this.serializeMDNSDevice(device))
            .sort((left, right) => {
                const nameCompare = left.name.localeCompare(right.name);
                if (nameCompare !== 0) {
                    return nameCompare;
                }
                return left.id.localeCompare(right.id);
            });
    }

    getQuicVCPeers(): QuicVCPeerRecord[] {
        return this.mdns
            .getDiscoveredDevices()
            .map((device) => this.serializeQuicVCPeer(device))
            .sort((left, right) => {
                const nameCompare = left.name.localeCompare(right.name);
                if (nameCompare !== 0) {
                    return nameCompare;
                }
                return left.id.localeCompare(right.id);
            });
    }

    private attachEventListeners(): void {
        this.disconnectFns.push(
            this.mdns.onDeviceDiscovered.listen((device) => {
                this.markUpdated();
                this.config.logger?.info(
                    `[DeviceDiscovery] mDNS discovered ${device.name} (${device.id})`
                );
            })
        );

        this.disconnectFns.push(
            this.mdns.onDeviceUpdated.listen((device) => {
                this.markUpdated();
                this.config.logger?.info(
                    `[DeviceDiscovery] mDNS updated ${device.name} (${device.id})`
                );
            })
        );

        this.disconnectFns.push(
            this.mdns.onPeerLost.listen((deviceId) => {
                this.markUpdated();
                this.config.logger?.info(`[DeviceDiscovery] mDNS lost ${deviceId}`);
            })
        );
    }

    private getLocalDeviceInfo(): LocalDeviceInfo {
        return {
            deviceId: this.config.deviceId,
            ownerId: this.config.ownerId,
            email: this.config.email,
            displayName: this.config.displayName,
            deviceType: this.config.deviceType,
            quicvcPort: this.config.quicvcPort,
            webPort: this.config.webPort ?? null
        };
    }

    private markUpdated(): void {
        this.lastUpdatedAt = new Date().toISOString();
    }

    private serializeMDNSDevice(device: MDNSDiscoveredDevice): MDNSDeviceRecord {
        return {
            id: device.id,
            name: device.name,
            address: device.address,
            port: device.port,
            publicKey: device.pubKey ?? null,
            email: device.email ?? null,
            deviceType: device.deviceType ?? null,
            capabilities: [...device.capabilities],
            discoveredAt: device.discoveredAt,
            lastSeen: device.lastSeen
        };
    }

    private serializeQuicVCPeer(device: MDNSDiscoveredDevice): QuicVCPeerRecord {
        return {
            id: device.id,
            name: device.name,
            address: device.address,
            port: device.port,
            url: `quicvc://${device.address}:${device.port}`,
            publicKey: device.pubKey ?? null,
            email: device.email ?? null,
            deviceType: device.deviceType ?? null,
            capabilities: [...device.capabilities],
            discoveryMethod: 'mdns',
            credentialStatus: 'unverified',
            discoveredAt: device.discoveredAt,
            lastSeenAt: device.lastSeen
        };
    }
}

export class DevicesFileSystem extends EasyFileSystem {
    constructor(private readonly discoveryService: DeviceDiscoveryService) {
        super();
        this.setRootDirectory(this.loadRootDirectory.bind(this));
    }

    private async loadRootDirectory(): Promise<EasyDirectoryContent> {
        const entries: EasyDirectoryContent = new Map();
        entries.set('index.json', this.createJsonFile(() => this.discoveryService.getOverview()));
        entries.set('status.json', this.createJsonFile(() => this.discoveryService.getStatus()));
        entries.set('mdns', {type: 'directory', content: this.loadMDNSDirectory.bind(this)});
        entries.set('quicvc', {type: 'directory', content: this.loadQuicVCDirectory.bind(this)});
        return entries;
    }

    private async loadMDNSDirectory(): Promise<EasyDirectoryContent> {
        const devices = this.discoveryService.getMdnsDevices();
        const entries: EasyDirectoryContent = new Map([
            ['index.json', this.createJsonFile(() => devices)]
        ]);

        for (const device of devices) {
            entries.set(`${device.id}.json`, this.createJsonFile(() => device));
        }

        return entries;
    }

    private async loadQuicVCDirectory(): Promise<EasyDirectoryContent> {
        const peers = this.discoveryService.getQuicVCPeers();
        const entries: EasyDirectoryContent = new Map([
            ['index.json', this.createJsonFile(() => peers)]
        ]);

        for (const peer of peers) {
            entries.set(`${peer.id}.json`, this.createJsonFile(() => peer));
        }

        return entries;
    }

    private createJsonFile(contentFactory: () => unknown): {
        type: 'regularFile';
        content: () => Promise<string>;
    } {
        return {
            type: 'regularFile',
            content: async () => `${JSON.stringify(contentFactory(), null, 2)}\n`
        };
    }
}
