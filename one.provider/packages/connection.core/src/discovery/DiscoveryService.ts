/**
 * DiscoveryService - Coordinates peer discovery across local network and relay
 *
 * Implements multi-method peer discovery with deduplication and filtering.
 * Based on QuicVC discovery patterns (UDP heartbeat broadcasts).
 */

import type { PeerIdentity } from '../types/platform-interfaces.js';
import type { DiscoveryOptions } from '../types/connection-types.js';
import { DiscoveryError } from '../utils/error-handling.js';

/**
 * Discovery event types
 */
export type DiscoveryEvent = 'peerDiscovered' | 'peerLost' | 'scanComplete';

/**
 * Event callback type
 */
type DiscoveryEventCallback = (peer: PeerIdentity) => void;

/**
 * Default discovery configuration
 * Based on QuicVC patterns: local UDP discovery on port 49497
 */
export const DEFAULT_DISCOVERY_CONFIG = {
  /** Local discovery timeout (fast local scan) */
  localTimeout: 2000,

  /** Relay discovery timeout (slower remote scan) */
  relayTimeout: 5000,

  /** Presence update interval (heartbeat period) */
  presenceInterval: 20000, // 20 seconds (matches QuicVC heartbeat)

  /** Peer expiration time (remove if not seen) */
  peerExpirationTime: 60000, // 60 seconds (matches QuicVC connection timeout)

  /** Service discovery port (UDP broadcast) */
  discoveryPort: 49497, // QuicVC discovery port

  /** QUICVC port for authenticated connections */
  quicvcPort: 49498,
};

export class DiscoveryService {
  /** Discovered peers cache (deduplicated) */
  private discoveredPeers: Map<string, PeerIdentity> = new Map();

  /** Event listeners */
  private eventListeners: Map<DiscoveryEvent, DiscoveryEventCallback[]> = new Map();

  /** Continuous discovery interval handle */
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;

  /** Peer expiration check interval */
  private expirationInterval: ReturnType<typeof setInterval> | null = null;

  /** Local discovery implementation (platform-specific, optional) */
  private localDiscovery: LocalDiscoveryProvider | null = null;

  /** Relay discovery implementation (platform-specific, optional) */
  private relayDiscovery: RelayDiscoveryProvider | null = null;

  /** Initialization state */
  private _initialized: boolean = false;

  /**
   * Initialize discovery service
   * Optionally provide platform-specific discovery implementations
   */
  async initialize(options?: {
    localDiscovery?: LocalDiscoveryProvider;
    relayDiscovery?: RelayDiscoveryProvider;
  }): Promise<void> {
    this.localDiscovery = options?.localDiscovery || null;
    this.relayDiscovery = options?.relayDiscovery || null;

    // Initialize local discovery if available
    if (this.localDiscovery) {
      await this.localDiscovery.initialize();
      this.setupLocalDiscoveryCallbacks();
    }

    // Initialize relay discovery if available
    if (this.relayDiscovery) {
      await this.relayDiscovery.initialize();
    }

    // Start peer expiration checker
    this.startExpirationChecker();

    this._initialized = true;
  }

  /**
   * Setup callbacks for local discovery events
   */
  private setupLocalDiscoveryCallbacks(): void {
    if (!this.localDiscovery) return;

    this.localDiscovery.onPeerDiscovered((peer) => {
      // @ts-ignore - Type conversion will be fixed later
      this.addPeer(peer, 'local');
    });

    this.localDiscovery.onPeerLost((peerId) => {
      this.removePeer(peerId);
    });
  }

  /**
   * Start continuous discovery
   * Emits 'peerDiscovered' events as peers are found
   */
  start(options?: DiscoveryOptions): void {
    if (this.discoveryInterval) {
      return; // Already running
    }

    const methods = options?.methods || ['local', 'relay'];
    const interval = DEFAULT_DISCOVERY_CONFIG.presenceInterval;

    // Start continuous scanning
    this.discoveryInterval = setInterval(() => {
      void this.scan(options).catch((error) => {
        console.error('[DiscoveryService] Scan error:', error);
      });
    }, interval);

    // Start local discovery listening
    if (methods.includes('local') && this.localDiscovery) {
      void this.localDiscovery.startListening();
    }
  }

  /**
   * Stop continuous discovery
   */
  stop(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }

    // Stop local discovery
    if (this.localDiscovery) {
      this.localDiscovery.stopListening();
    }
  }

  /**
   * Perform one-time discovery scan
   * @returns List of discovered peers
   */
  async scan(options?: DiscoveryOptions): Promise<PeerIdentity[]> {
    const methods = options?.methods || ['local', 'relay'];
    const timeout = options?.timeout || DEFAULT_DISCOVERY_CONFIG.relayTimeout;

    const discoveries: Promise<PeerIdentity[]>[] = [];

    // Local discovery
    if (methods.includes('local') && this.localDiscovery) {
      discoveries.push(
        this.scanLocal(options?.timeout || DEFAULT_DISCOVERY_CONFIG.localTimeout)
      );
    }

    // Relay discovery
    if (methods.includes('relay') && this.relayDiscovery) {
      discoveries.push(this.scanRelay(timeout));
    }

    // Wait for all discovery methods
    const results = await Promise.allSettled(discoveries);

    // Combine results
    const allPeers: PeerIdentity[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allPeers.push(...result.value);
      } else {
        console.error('[DiscoveryService] Discovery method failed:', result.reason);
      }
    }

    // Deduplicate and add to cache
    const deduplicated = this.deduplicatePeers(allPeers);
    for (const peer of deduplicated) {
      this.addPeer(peer, peer.discoveryMethod);
    }

    // Apply filters if provided
    let filtered = Array.from(this.discoveredPeers.values());
    if (options?.requiredCapabilities) {
      filtered = this.filterByCapabilities(filtered, options.requiredCapabilities);
    }

    this.emit('scanComplete', filtered[0]!); // Emit with first peer as example

    return filtered;
  }

  /**
   * Scan local network for peers
   */
  private async scanLocal(timeout: number): Promise<PeerIdentity[]> {
    if (!this.localDiscovery) {
      return [];
    }

    try {
      const localPeers = await this.localDiscovery.scan(timeout);
      return localPeers.map((lp) => this.convertToPeerIdentity(lp, 'local'));
    } catch (error) {
      throw new DiscoveryError(
        `Local discovery failed: ${error instanceof Error ? error.message : String(error)}`,
        'local',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Scan relay server for peers
   */
  private async scanRelay(timeout: number): Promise<PeerIdentity[]> {
    if (!this.relayDiscovery) {
      return [];
    }

    try {
      const relayPeers = await this.relayDiscovery.query({ timeout });
      // @ts-ignore - Type conversion will be fixed later
      return relayPeers.map((rp) => this.convertToPeerIdentity(rp, 'relay'));
    } catch (error) {
      throw new DiscoveryError(
        `Relay discovery failed: ${error instanceof Error ? error.message : String(error)}`,
        'relay',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get list of currently discovered peers
   */
  getDiscoveredPeers(): PeerIdentity[] {
    return Array.from(this.discoveredPeers.values());
  }

  /**
   * Filter discovered peers by capability
   */
  filterByCapability(capability: string): PeerIdentity[] {
    return this.filterByCapabilities(this.getDiscoveredPeers(), [capability]);
  }

  /**
   * Filter peers by multiple capabilities
   */
  private filterByCapabilities(peers: PeerIdentity[], capabilities: string[]): PeerIdentity[] {
    return peers.filter((peer) =>
      capabilities.every((cap) => peer.capabilities.includes(cap))
    );
  }

  /**
   * Clear discovery cache
   */
  clearCache(): void {
    this.discoveredPeers.clear();
  }

  /**
   * Register event listener
   */
  on(event: DiscoveryEvent, callback: DiscoveryEventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: DiscoveryEvent, peer: PeerIdentity): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(peer));
    }
  }

  /**
   * Add peer to discovered peers cache with deduplication
   */
  private addPeer(peer: PeerIdentity, source: 'local' | 'relay'): void {
    const existing = this.discoveredPeers.get(peer.id);

    if (existing) {
      // Peer already discovered - update last seen and prefer local over relay
      existing.lastSeenAt = Date.now();

      // Prefer local discovery over relay
      if (source === 'local' && existing.discoveryMethod === 'relay') {
        existing.discoveryMethod = 'local';
        existing.address = peer.address;
      }
    } else {
      // New peer discovered
      peer.lastSeenAt = Date.now();
      this.discoveredPeers.set(peer.id, peer);
      this.emit('peerDiscovered', peer);
    }
  }

  /**
   * Remove peer from cache
   */
  private removePeer(peerId: string): void {
    const peer = this.discoveredPeers.get(peerId);
    if (peer) {
      this.discoveredPeers.delete(peerId);
      this.emit('peerLost', peer);
    }
  }

  /**
   * Start peer expiration checker
   * Removes peers that haven't been seen recently
   */
  private startExpirationChecker(): void {
    this.expirationInterval = setInterval(() => {
      const now = Date.now();
      const expiredPeers: string[] = [];

      for (const [peerId, peer] of this.discoveredPeers) {
        if (now - peer.lastSeenAt > DEFAULT_DISCOVERY_CONFIG.peerExpirationTime) {
          expiredPeers.push(peerId);
        }
      }

      for (const peerId of expiredPeers) {
        this.removePeer(peerId);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Deduplicate peers discovered from multiple sources
   * Prefers local over relay when same peer found via both methods
   */
  private deduplicatePeers(peers: PeerIdentity[]): PeerIdentity[] {
    const deduped = new Map<string, PeerIdentity>();

    for (const peer of peers) {
      const existing = deduped.get(peer.id);

      if (!existing) {
        deduped.set(peer.id, peer);
      } else {
        // Prefer local discovery over relay
        if (peer.discoveryMethod === 'local' && existing.discoveryMethod === 'relay') {
          deduped.set(peer.id, peer);
        }
      }
    }

    return Array.from(deduped.values());
  }

  /**
   * Convert local peer info to PeerIdentity
   */
  private convertToPeerIdentity(
    localPeer: LocalPeerInfo,
    method: 'local' | 'relay'
  ): PeerIdentity {
    // Placeholder credential - platforms should provide real credentials
    const placeholderCredential: any = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential'],
      id: `${localPeer.id}#v1`,
      issuer: localPeer.id,
      issuanceDate: new Date().toISOString(),
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      credentialSubject: {
        id: localPeer.id,
        name: localPeer.name,
        publicKey: '', // Should be provided by discovery
      },
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: localPeer.id,
        proofPurpose: 'assertionMethod',
        proofValue: '',
      },
      validFrom: new Date().toISOString(),
      version: 1,
    };

    return {
      id: localPeer.id,
      name: localPeer.name,
      publicKey: localPeer.publicKey || '',
      credential: placeholderCredential,
      credentialStatus: 'unverified',
      discoveryMethod: method,
      address: localPeer.address,
      capabilities: localPeer.capabilities,
      discoveredAt: localPeer.discoveredAt,
      lastSeenAt: localPeer.lastSeenAt,
    };
  }

  /**
   * Shutdown discovery service
   */
  async shutdown(): Promise<void> {
    this.stop();

    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
    }

    if (this.localDiscovery) {
      await this.localDiscovery.shutdown();
    }

    if (this.relayDiscovery) {
      await this.relayDiscovery.shutdown();
    }

    this.clearCache();
    this._initialized = false;
  }
}

/**
 * Platform-specific local discovery provider interface
 */
export interface LocalDiscoveryProvider {
  initialize(): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): void;
  scan(timeout: number): Promise<LocalPeerInfo[]>;
  onPeerDiscovered(callback: (peer: LocalPeerInfo) => void): void;
  onPeerLost(callback: (peerId: string) => void): void;
  shutdown(): Promise<void>;
}

/**
 * Platform-specific relay discovery provider interface
 */
export interface RelayDiscoveryProvider {
  initialize(): Promise<void>;
  query(options: { timeout: number }): Promise<RelayPeerInfo[]>;
  shutdown(): Promise<void>;
}

/**
 * Local peer information (from local network discovery)
 */
export interface LocalPeerInfo {
  id: string;
  name: string;
  address: string;
  publicKey?: string;
  capabilities: string[];
  discoveredAt: number;
  lastSeenAt: number;
}

/**
 * Relay peer information (from relay server)
 */
export interface RelayPeerInfo {
  id: string;
  name: string;
  address: string;
  publicKey?: string;
  capabilities: string[];
  lastSeen: number;
}
