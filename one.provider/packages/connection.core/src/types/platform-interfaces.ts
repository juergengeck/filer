/**
 * Platform Dependency Interfaces for connection.core
 *
 * These interfaces define the contracts that platform-specific implementations
 * must satisfy when integrating connection.core. All platforms (browser, electron,
 * iOS, android) must provide implementations of these interfaces.
 */

/**
 * Bundle of all platform-specific dependencies required by ConnectionManager
 */
export interface PlatformDependencies {
  /** Factory for creating platform-specific transport implementations */
  transport: TransportFactory;

  /** Platform-specific storage adapter for persistent data */
  storage: StorageAdapter;

  /** Callbacks for platform-specific UI interactions */
  ui: UICallbacks;
}

/**
 * Factory for creating platform-specific network transports
 */
export interface TransportFactory {
  /**
   * Create a transport instance for the specified type
   * @throws Error if transport type is not supported on this platform
   */
  create(type: 'quicvc' | 'websocket'): Transport;

  /**
   * Get list of transport types supported on this platform
   * @returns Array of supported transport types (e.g., ['websocket'] for browser)
   */
  getSupportedTransports(): ('quicvc' | 'websocket')[];
}

/**
 * Platform-agnostic network transport interface
 *
 * Platforms must implement this for their specific transport mechanisms
 * (e.g., WebSocket in browser, QUIC in electron/native)
 */
export interface Transport {
  /** Transport type identifier */
  readonly type: 'quicvc' | 'websocket';

  /**
   * Connect to remote peer at given address
   * @param address Network address (IP:port for local, URL for relay)
   * @throws Error if connection fails
   */
  connect(address: string): Promise<void>;

  /**
   * Send data to connected peer
   * @throws Error if not connected or send fails
   */
  send(data: Uint8Array): Promise<void>;

  /**
   * Register callback for received data
   * Platform must call this callback when data arrives
   */
  onReceive(callback: (data: Uint8Array) => void): void;

  /**
   * Register callback for connection state changes
   */
  onStateChange(callback: (state: TransportState) => void): void;

  /**
   * Close the connection
   */
  close(): void;

  /**
   * Get current connection state
   */
  getState(): TransportState;
}

export type TransportState = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

/**
 * Platform-specific storage adapter for persistent connection data
 *
 * Implementations:
 * - Browser: IndexedDB
 * - Electron: File system (JSON files or SQLite)
 * - iOS/Android: Native storage APIs
 */
export interface StorageAdapter {
  // Peer management
  storePeer(peer: PeerIdentity): Promise<void>;
  getPeer(peerId: string): Promise<PeerIdentity | null>;
  listPeers(): Promise<PeerIdentity[]>;
  removePeer(peerId: string): Promise<void>;

  // Credential management
  storeCredential(credential: VersionedCredential): Promise<void>;
  getCredential(credentialId: string): Promise<VersionedCredential | null>;
  listCredentials(subjectId: string): Promise<VersionedCredential[]>;

  // Group management (optional for initial implementation)
  storeGroup?(groupId: string, memberIds: string[]): Promise<void>;
  getGroup?(groupId: string): Promise<string[] | null>;
}

/**
 * Platform-specific UI interaction callbacks
 *
 * Connection.core calls these to interact with the user through platform UI
 */
export interface UICallbacks {
  /**
   * Show pairing request to user for approval
   * Platform must display UI with peer info and await user decision
   *
   * @returns Promise<true> if user accepts, Promise<false> if user rejects
   */
  onPairingRequest(request: PairingRequestUI): Promise<boolean>;

  /**
   * Show error message to user
   * Platform determines how to display (toast, alert, notification, etc.)
   */
  onError(error: ErrorUI): void;

  /**
   * Notify of connection state change
   * Platform may update UI to reflect connection status
   */
  onConnectionStateChange(peerId: string, state: ConnectionStateValue): void;

  /**
   * Request user to select from multiple pairing methods
   * Only called if platform supports multiple methods
   *
   * @returns Selected pairing method or null if user cancels
   */
  selectPairingMethod?(methods: PairingMethod[]): Promise<PairingMethod | null>;
}

export interface PairingRequestUI {
  peerId: string;
  peerName: string;
  method: 'qr' | 'numeric' | 'proximity';
  verificationCode?: string; // Present if method is 'numeric'
}

export interface ErrorUI {
  code: string;
  message: string;
  context?: unknown;
}

export type ConnectionStateValue = 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

export type PairingMethod = 'qr' | 'numeric' | 'proximity';

/**
 * Peer identity information
 */
export interface PeerIdentity {
  id: string;
  name: string;
  publicKey: string;
  credential: VersionedCredential;
  credentialStatus: 'valid' | 'expired' | 'revoked' | 'unverified';
  discoveryMethod: 'local' | 'relay';
  address: string;
  capabilities: string[];
  discoveredAt: number;
  lastSeenAt: number;
}

/**
 * W3C Verifiable Credential with versioning for revocation
 */
export interface VersionedCredential {
  '@context': string[];
  type: string[];
  id: string; // Versioned: e.g., "did:example:123#v1"
  issuer: string;
  issuanceDate: string; // ISO 8601
  expirationDate: string; // ISO 8601
  credentialSubject: CredentialSubject;
  proof: CryptographicProof;
  validFrom: string; // ISO 8601 - for revocation via backdating
  version: number;
}

export interface CredentialSubject {
  id: string; // Subject DID
  name: string;
  publicKey: string;
  deviceId?: string;
}

export interface CryptographicProof {
  type: string; // e.g., "Ed25519Signature2020"
  created: string; // ISO 8601
  verificationMethod: string; // Public key reference
  proofPurpose: string; // e.g., "assertionMethod"
  proofValue: string; // Base64-encoded signature
}
