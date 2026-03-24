/**
 * Connection Type Definitions
 *
 * Core types for connection management, state tracking, and group connections
 */

/**
 * Connection state tracking with transition history
 */
export interface ConnectionState {
  /** Current connection state */
  current: ConnectionStateValue;

  /** Previous state for history */
  previous: ConnectionStateValue | null;

  /** Last transition timestamp */
  transitionedAt: number;

  /** Count of errors encountered */
  errorCount: number;

  /** Count of reconnection attempts */
  reconnectAttempts: number;
}

export type ConnectionStateValue = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/**
 * Active P2P connection to a peer
 */
export interface Connection {
  id: string;
  peerId: string;
  state: ConnectionStateValue;
  transportType: 'quicvc' | 'websocket';
  establishedAt: number;
  lastActivityAt: number;
  metadata?: ConnectionMetadata;

  /**
   * Send data to peer
   * @throws Error if not connected
   */
  send(data: Uint8Array): Promise<void>;

  /**
   * Close connection
   */
  close(): void;

  /**
   * Check if connection is alive
   */
  isAlive(): boolean;

  /**
   * Register data receive callback
   */
  onReceive(callback: (data: Uint8Array) => void): void;

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: ConnectionStateValue) => void): void;
}

export interface ConnectionMetadata {
  latency?: number; // Round-trip time in ms
  throughput?: number; // Bytes per second
  errorCount?: number; // Number of errors encountered
}

/**
 * Group connection (full mesh topology)
 */
export interface GroupConnection {
  groupId: string;
  memberIds: string[]; // Includes self
  topology: 'mesh';
  createdAt: number;

  /**
   * Add new member to group
   * Establishes connection to new member and notifies existing members
   */
  addMember(peerId: string): Promise<void>;

  /**
   * Remove member from group
   */
  removeMember(peerId: string): void;

  /**
   * Broadcast data to all connected members
   */
  broadcast(data: Uint8Array): Promise<void>;

  /**
   * Get connection status for specific member
   */
  getMemberStatus(peerId: string): 'connected' | 'disconnected' | 'connecting';

  /**
   * Get list of currently connected members
   */
  getConnectedMembers(): string[];

  /**
   * Get connection to specific member
   */
  getMemberConnection(peerId: string): Connection | null;

  /**
   * Register callback for member state changes
   */
  onMemberStateChange(callback: (peerId: string, state: string) => void): void;
}

/**
 * Pairing request state
 */
export interface PairingRequest {
  id: string;
  initiatorId: string;
  targetId: string;
  state: PairingState;
  method: 'qr' | 'numeric' | 'proximity';
  verificationCode?: string; // Present if method is 'numeric'
  createdAt: number;
  expiresAt: number;
}

export type PairingState = 'initiated' | 'pending' | 'accepted' | 'rejected' | 'timeout' | 'completed';

/**
 * Discovery options
 */
export interface DiscoveryOptions {
  /** Discovery methods to use */
  methods?: ('local' | 'relay')[];

  /** Filter by required capabilities */
  requiredCapabilities?: string[];

  /** Timeout in milliseconds (default: 5000 for relay, 2000 for local) */
  timeout?: number;

  /** Include self in results (default: false) */
  includeSelf?: boolean;
}

/**
 * Reconnection task tracking
 */
export interface ReconnectionTask {
  peerId: string;
  attempts: number;
  nextAttemptAt: number;
  timeoutHandle: unknown;
}

/**
 * ConnectionManager events
 */
export type ConnectionManagerEvent =
  | 'initialized'
  | 'shutdown'
  | 'peerDiscovered'
  | 'pairingRequestReceived'
  | 'pairingAccepted'
  | 'pairingRejected'
  | 'connectionEstablished'
  | 'connectionClosed'
  | 'connectionError'
  | 'groupMemberJoined'
  | 'groupMemberLeft'
  | 'error';
