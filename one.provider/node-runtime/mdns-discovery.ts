import os from 'os';
import {OEvent} from '@refinio/one.models/lib/misc/OEvent.js';

const SERVICE_TYPE = 'one-refinio';
const BROWSER_REFRESH_INTERVAL = 45_000;
const VIRTUAL_ADAPTER_PREFIXES = ['vEthernet', 'VMware', 'VirtualBox', 'docker', 'br-', 'veth'];

export interface MDNSDiscoveredDevice {
    id: string;
    name: string;
    type: string;
    address: string;
    port: number;
    pubKey?: string;
    email?: string;
    deviceType?: string;
    capabilities: string[];
    lastSeen: number;
    discoveredAt: number;
}

export class MDNSDiscovery {
    public readonly onDeviceDiscovered = new OEvent<(device: MDNSDiscoveredDevice) => void>();
    public readonly onDeviceUpdated = new OEvent<(device: MDNSDiscoveredDevice) => void>();
    public readonly onPeerLost = new OEvent<(deviceId: string) => void>();

    private bonjour: any = null;
    private publishedService: any = null;
    private browser: any = null;
    private readonly discoveredDevices = new Map<string, MDNSDiscoveredDevice>();
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private deviceId = '';
    private pubKey = '';
    private email = '';
    private displayName = '';
    private deviceType = '';
    private quicvcPort = 49497;
    private webPort?: number;
    private instanceName = '';

    async start(
        deviceId: string,
        pubKey: string,
        displayName: string,
        quicvcPort: number = 49497,
        interfaceAddress?: string,
        webPort?: number,
        email?: string,
        deviceType?: string
    ): Promise<void> {
        if (!email) {
            throw new Error('email is required for mDNS discovery');
        }

        this.deviceId = deviceId;
        this.pubKey = pubKey;
        this.email = email;
        this.displayName = displayName;
        this.deviceType = deviceType || 'unknown';
        this.quicvcPort = quicvcPort;
        this.webPort = webPort;
        this.instanceName = deviceId.substring(0, 16);

        const {Bonjour} = await import('bonjour-service');

        const bindAddress = interfaceAddress ||
            (process.platform === 'win32' ? this.detectPrimaryInterface() : undefined);
        const options: any = {};
        if (bindAddress) {
            options.interface = bindAddress;
        }

        this.bonjour = new Bonjour(options, (error: unknown) => {
            console.error('[MDNSDiscovery] Bonjour error:', error);
        });

        this.publishService();
        this.startBrowsing();
        this.refreshTimer = setInterval(() => this.refreshBrowser(), BROWSER_REFRESH_INTERVAL);
    }

    async stop(): Promise<void> {
        if (this.browser) {
            this.browser.stop();
            this.browser = null;
        }

        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }

        if (this.bonjour) {
            this.bonjour.destroy();
            this.bonjour = null;
            this.publishedService = null;
        }

        this.discoveredDevices.clear();
    }

    getDiscoveredDevices(): MDNSDiscoveredDevice[] {
        return Array.from(this.discoveredDevices.values());
    }

    updateDisplayName(newName: string): void {
        if (this.displayName === newName) {
            return;
        }

        this.displayName = newName;
        if (this.publishedService && this.bonjour) {
            this.publishedService.stop?.();
            this.publishService();
        }
    }

    private publishService(): void {
        if (!this.bonjour) {
            return;
        }

        const txt: Record<string, string> = {
            pubkey: this.pubKey,
            deviceId: this.deviceId,
            email: this.email,
            name: this.displayName,
            deviceType: this.deviceType,
            platform: 'one'
        };

        if (this.webPort) {
            txt.webPort = String(this.webPort);
        }

        this.publishedService = this.bonjour.publish({
            name: this.instanceName,
            type: SERVICE_TYPE,
            protocol: 'udp' as any,
            port: this.quicvcPort,
            txt
        });
    }

    private startBrowsing(): void {
        if (!this.bonjour) {
            return;
        }

        this.browser = this.bonjour.find({type: SERVICE_TYPE, protocol: 'udp' as any});
        this.browser.on('up', (service: any) => this.handleServiceUp(service));
        this.browser.on('down', (service: any) => this.handleServiceDown(service));
    }

    private handleServiceUp(service: any): void {
        const txt = service.txt || {};
        const peerDeviceId = txt.deviceId || service.name;

        if (peerDeviceId === this.deviceId) {
            return;
        }

        const address = this.getIPv4Address(service) || service.referer?.address || '';
        const port = service.port || 49497;
        const peerPubKey = txt.pubkey || '';
        const peerName = txt.name || service.name;

        if (!address || !peerPubKey) {
            return;
        }

        const peerEmail = txt.email || '';
        const peerDeviceType = txt.deviceType || undefined;
        const capabilities = ['quicvc'];
        if (txt.webPort && address) {
            capabilities.push(`http://${address}:${txt.webPort}`);
        }

        const existing = this.discoveredDevices.get(peerDeviceId);
        if (existing) {
            existing.lastSeen = Date.now();
            existing.name = peerName;
            existing.address = address;
            existing.port = port;
            existing.capabilities = capabilities;
            if (peerEmail) {
                existing.email = peerEmail;
            }
            if (peerDeviceType) {
                existing.deviceType = peerDeviceType;
            }
            this.onDeviceUpdated.emit(existing);
            return;
        }

        const device: MDNSDiscoveredDevice = {
            id: peerDeviceId,
            name: peerName,
            type: 'quicvc',
            address,
            port,
            pubKey: peerPubKey,
            email: peerEmail || undefined,
            deviceType: peerDeviceType,
            capabilities,
            lastSeen: Date.now(),
            discoveredAt: Date.now()
        };
        this.discoveredDevices.set(peerDeviceId, device);
        this.onDeviceDiscovered.emit(device);
    }

    private handleServiceDown(service: any): void {
        const txt = service.txt || {};
        const peerDeviceId = txt.deviceId || service.name;

        if (!this.discoveredDevices.has(peerDeviceId)) {
            return;
        }

        this.discoveredDevices.delete(peerDeviceId);
        this.onPeerLost.emit(peerDeviceId);
    }

    private refreshBrowser(): void {
        if (!this.bonjour) {
            return;
        }

        if (this.browser) {
            this.browser.stop();
            this.browser = null;
        }

        this.startBrowsing();
    }

    private getIPv4Address(service: any): string | undefined {
        if (!Array.isArray(service.addresses)) {
            return undefined;
        }

        return service.addresses.find((address: string) => !address.includes(':'));
    }

    private detectPrimaryInterface(): string | undefined {
        const interfaces = os.networkInterfaces();

        for (const [name, addresses] of Object.entries(interfaces)) {
            if (!addresses) {
                continue;
            }

            if (VIRTUAL_ADAPTER_PREFIXES.some((prefix) => name.startsWith(prefix))) {
                continue;
            }

            for (const address of addresses) {
                if (address.family === 'IPv4' && !address.internal) {
                    return address.address;
                }
            }
        }

        return undefined;
    }
}
