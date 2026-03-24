/**
 * ConnectionManager - Main orchestrator for connection.core
 *
 * Primary interface for platforms to manage P2P connections, pairing, discovery,
 * and group connections. Uses dependency injection for platform-specific concerns.
 */

import type {
  PlatformDependencies,
  PeerIdentity,
} from './types/platform-interfaces.js';
import type {
  Connection as IConnection,
  DiscoveryOptions,
  ConnectionManagerEvent,
} from './types/connection-types.js';
import { Connection } from './connections/Connection.js';
import { ReconnectionManager } from './connections/ReconnectionManager.js';
import { validatePlatformDependencies, validatePeerId } from './utils/validation.js';
import {
  NotInitializedError,
  AlreadyInitializedError,
  PeerNotFoundError,
  ConnectionError,
  ConnectionLimitError,
} from './utils/error-handling.js';

/**
 * Event callback type
 */
type EventCallback = (...args: unknown[]) => void;

export class ConnectionManager {
  /** Platform-specific dependencies */
  private readonly deps: PlatformDependencies;

  /** Initialization state */
  private initialized: boolean = false;

  /** Active connections by peer ID */
  private connections: Map<string, Connection> = new Map();

  /** Discovered peers cache */
  private discoveredPeers: Map<string, PeerIdentity> = new Map();

  /** Event listeners */
  private eventListeners: Map<ConnectionManagerEvent, EventCallback[]> = new Map();

  /** Reconnection manager */
  private reconnectionManager: ReconnectionManager;

  /** Maximum concurrent connections */
  private readonly maxConnections: number = 50;

  /**
   * Create ConnectionManager with platform dependencies
   * @throws MissingDependencyError if required dependencies are missing
   * @throws InvalidDependencyError if dependencies are invalid
   */
  constructor(deps: PlatformDependencies) {
    // Validate dependencies fail-fast
    validatePlatformDependencies(deps);

    this.deps = deps;
    this.reconnectionManager = new ReconnectionManager();

    // Setup reconnection callback
    this.reconnectionManager.setReconnectCallback(async (peer) => {
      return this.connect(peer.id);
    });
  }

  /**
   * Initialize the connection manager
   * Sets up internal services and prepares for operation
   * @throws AlreadyInitializedError if already initialized
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new AlreadyInitializedError('ConnectionManager');
    }

    // Initialize internal services
    // (Discovery service, credential verifier, etc. will be initialized here in later tasks)

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the connection manager
   * Closes all connections, stops discovery, cancels reconnections
   */
  async shutdown(): Promise<void> {
    this.assertInitialized();

    // Close all connections
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();

    // Cancel all reconnections
    this.reconnectionManager.cancelAll();

    // Clear discovered peers
    this.discoveredPeers.clear();

    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Discover available peers
   * @returns List of discovered peers
   */
  async discoverPeers(_options?: DiscoveryOptions): Promise<PeerIdentity[]> {
    this.assertInitialized();

    // Discovery implementation will be added in User Story 2 (T035)
    // For now, return empty array
    return [];
  }

  /**
   * Start continuous peer discovery
   */
  startDiscovery(_options?: DiscoveryOptions): void {
    this.assertInitialized();

    // Discovery implementation will be added in User Story 2 (T036)
  }

  /**
   * Stop continuous peer discovery
   */
  stopDiscovery(): void {
    this.assertInitialized();

    // Discovery implementation will be added in User Story 2 (T037)
  }

  /**
   * Get list of currently discovered peers
   */
  getDiscoveredPeers(): PeerIdentity[] {
    return Array.from(this.discoveredPeers.values());
  }

  /**
   * Connect to a previously paired peer
   * @throws PeerNotFoundError if peer not found
   * @throws ConnectionLimitError if connection limit reached
   * @throws ConnectionError if connection fails
   */
  async connect(peerId: string): Promise<IConnection> {
    this.assertInitialized();
    validatePeerId(peerId);

    // Check if already connected
    const existing = this.connections.get(peerId);
    if (existing && existing.isAlive()) {
      return existing;
    }

    // Check connection limit
    if (this.connections.size >= this.maxConnections) {
      throw new ConnectionLimitError(this.maxConnections);
    }

    // Get peer identity from storage or discovered peers
    const peer = await this.getPeerIdentity(peerId);
    if (!peer) {
      throw new PeerNotFoundError(peerId);
    }

    // Select transport type based on peer capabilities
    const transportType = this.selectTransport(peer.capabilities);

    // Create transport
    const transport = this.deps.transport.create(transportType);

    // Connect transport
    try {
      await transport.connect(peer.address);
    } catch (error) {
      throw new ConnectionError(
        `Failed to connect transport to ${peer.address}: ${error instanceof Error ? error.message : String(error)}`,
        peerId,
        error instanceof Error ? error : undefined
      );
    }

    // Create Connection instance
    const connectionId = this.generateConnectionId(peerId);
    const connection = new Connection(connectionId, peerId, transport, transportType);

    // Register connection state callbacks
    connection.onStateChange((state) => {
      if (state === 'disconnected') {
        // Connection lost, schedule reconnection
        this.handleDisconnection(connection, peer);
      } else if (state === 'connected') {
        // Connection established successfully
        this.emit('connectionEstablished', connection);
      }
    });

    // Store connection
    this.connections.set(peerId, connection);

    return connection;
  }

  /**
   * Disconnect from a peer
   */
  disconnect(peerId: string): void {
    this.assertInitialized();

    const connection = this.connections.get(peerId);
    if (connection) {
      connection.close();
      this.connections.delete(peerId);
      this.emit('connectionClosed', peerId);
    }

    // Cancel any reconnection attempts
    this.reconnectionManager.cancelReconnection(peerId);
  }

  /**
   * Get connection to peer (if exists)
   */
  getConnection(peerId: string): IConnection | null {
    return this.connections.get(peerId) || null;
  }

  /**
   * Get list of all active connections
   */
  getConnections(): IConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Check if connected to peer
   */
  isConnected(peerId: string): boolean {
    const connection = this.connections.get(peerId);
    return connection ? connection.isAlive() : false;
  }

  /**
   * Register event listener
   */
  on(event: ConnectionManagerEvent, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  /**
   * Unregister event listener
   */
  off(event: ConnectionManagerEvent, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  protected emit(event: ConnectionManagerEvent, ...args: unknown[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(...args));
    }
  }

  /**
   * Assert that ConnectionManager is initialized
   * @throws NotInitializedError if not initialized
   */
  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new NotInitializedError('ConnectionManager');
    }
  }

  /**
   * Get peer identity from storage or discovered peers
   */
  private async getPeerIdentity(peerId: string): Promise<PeerIdentity | null> {
    // Check discovered peers first
    const discovered = this.discoveredPeers.get(peerId);
    if (discovered) {
      return discovered;
    }

    // Check storage
    return this.deps.storage.getPeer(peerId);
  }

  /**
   * Select transport type based on peer capabilities
   */
  private selectTransport(peerCapabilities: string[]): 'quicvc' | 'websocket' {
    const supportedTransports = this.deps.transport.getSupportedTransports();

    // Prefer QUIC if both sides support it
    if (
      supportedTransports.includes('quicvc') &&
      peerCapabilities.includes('quicvc')
    ) {
      return 'quicvc';
    }

    // Fallback to WebSocket
    if (
      supportedTransports.includes('websocket') &&
      peerCapabilities.includes('websocket')
    ) {
      return 'websocket';
    }

    // No mutual transport capability - fail fast
    throw new ConnectionError(
      `No mutual transport capability with peer. Supported: [${supportedTransports.join(', ')}], Peer: [${peerCapabilities.join(', ')}]`
    );
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(peerId: string): string {
    const timestamp = Date.now();
    return `conn-${peerId}-${timestamp}`;
  }

  /**
   * Handle connection disconnection
   */
  private handleDisconnection(connection: IConnection, peer: PeerIdentity): void {
    // Remove from active connections
    this.connections.delete(connection.peerId);

    // Emit disconnection event
    this.emit('connectionClosed', connection.peerId);

    // Schedule automatic reconnection
    this.reconnectionManager.scheduleReconnection(peer);
  }
}
