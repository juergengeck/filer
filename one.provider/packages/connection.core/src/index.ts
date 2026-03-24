/**
 * connection.core - Platform-agnostic P2P connection management
 *
 * Public API exports for platform integration
 */

// Platform dependency interfaces
export type {
  PlatformDependencies,
  TransportFactory,
  Transport,
  TransportState,
  StorageAdapter,
  UICallbacks,
  PairingRequestUI,
  ErrorUI,
  ConnectionStateValue,
  PairingMethod,
  PeerIdentity,
  VersionedCredential,
  CredentialSubject,
  CryptographicProof,
} from './types/platform-interfaces.js';

// Connection types (excluding ConnectionState and Connection which are exported as classes below)
export type {
  ConnectionMetadata,
  GroupConnection,
  PairingRequest,
  PairingState,
  DiscoveryOptions,
  ReconnectionTask,
  ConnectionManagerEvent,
} from './types/connection-types.js';

// Credential types
export type {
  VerificationResult,
  VerificationStatus,
  VerificationError,
  VerificationErrorCode,
  RevocationCheckResult,
  CredentialIdParts,
  TrustConfig,
} from './types/credential-types.js';

// Credential constants
export {
  W3C_VC_CONTEXT,
  REQUIRED_CREDENTIAL_TYPES,
  SUPPORTED_SIGNATURE_TYPES,
  DEFAULT_TRUST_CONFIG,
  CREDENTIAL_VALIDATION_RULES,
} from './types/credential-types.js';

// Error classes
export {
  ConnectionCoreError,
  MissingDependencyError,
  InvalidDependencyError,
  ConnectionError,
  TransportError,
  PairingError,
  CredentialVerificationError,
  StateTransitionError,
  DiscoveryError,
  GroupError,
  PeerNotFoundError,
  PeerNotPairedError,
  ConnectionLimitError,
  GroupSizeLimitError,
  TimeoutError,
  NotInitializedError,
  AlreadyInitializedError,
} from './utils/error-handling.js';

// Validation utilities (may be useful for platform implementations)
export {
  validatePlatformDependencies,
  validateConnectionStateTransition,
  validatePairingStateTransition,
  validatePeerId,
  validateGroupId,
  validateAddress,
  validateNonEmptyArray,
  validateRange,
  validateTimeout,
  validateTimestamp,
  validateISODate,
} from './utils/validation.js';

// Main classes
export { ConnectionManager } from './ConnectionManager.js';
export { Connection } from './connections/Connection.js';
export { ConnectionState } from './connections/ConnectionState.js';
export { ReconnectionManager } from './connections/ReconnectionManager.js';
// export { GroupConnection } from './connections/GroupConnection.js'; // Will be added in User Story 3

// ONE.core Integration (extended ConnectionManager with invitation/group chat support)
// TODO: Fix ConnectionManager.extended.ts error signatures or remove if deprecated
// export { ConnectionManagerOneCore } from './ConnectionManager.extended.js';

// ONE.core Adapter Interface
export type {
  OneCoreAdapter,
  OneCoreLeute,
  OneCoreChannels,
  OneCoreConnections,
  OneCoreTopics,
  OneCoreAttestation,
  GroupWithCertificate,
  ChannelInfo,
  TopicMessage,
  CertificateSet,
} from './adapters/OneCoreAdapter.js';

// Platform interfaces (from existing types)
// Note: PlatformDependencies, TransportFactory, Transport, etc. already exported above

// Pairing handlers
export {
  handlePairingCompletion,
  detectInvitationType
} from './connections/PairingHandler.js';
export type {
  PairingContext,
  PairingResult
} from './connections/PairingHandler.js';

// Discovery
export { DiscoveryService } from './discovery/DiscoveryService.js';
export type { LocalDiscoveryProvider, LocalPeerInfo, RelayDiscoveryProvider, RelayPeerInfo } from './discovery/DiscoveryService.js';

// Handlers
export { ConnectionHandler } from './handlers/ConnectionHandler.js';
export type {
  // Dependency interfaces
  NodeOneCoreInstance,
  StorageProvider,
  ConnectionStatus,
  // Request/Response types
  GetInstancesRequest,
  GetInstancesResponse,
  Instance,
  StorageInfo,
  ReplicationInfo,
  CreatePairingInvitationRequest,
  CreatePairingInvitationResponse,
  AcceptPairingInvitationRequest,
  AcceptPairingInvitationResponse,
  GetConnectionStatusRequest,
  GetConnectionStatusResponse
} from './handlers/ConnectionHandler.js';
