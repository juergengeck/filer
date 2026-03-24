/**
 * Error Handling Utilities
 *
 * Fail-fast error classes with clear error messages for all failure scenarios.
 * Following project principle: "No fallbacks. We fail fast and throw."
 */

/**
 * Base error class for connection.core
 */
export class ConnectionCoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: unknown
  ) {
    super(message);
    this.name = 'ConnectionCoreError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Missing dependency error - thrown when required platform dependency is not provided
 */
export class MissingDependencyError extends ConnectionCoreError {
  constructor(dependencyName: string) {
    super(
      `Missing required dependency: ${dependencyName}. ConnectionManager requires all platform dependencies to be provided via constructor injection.`,
      'MISSING_DEPENDENCY',
      { dependencyName }
    );
    this.name = 'MissingDependencyError';
  }
}

/**
 * Invalid dependency error - thrown when provided dependency is invalid
 */
export class InvalidDependencyError extends ConnectionCoreError {
  constructor(dependencyName: string, reason: string) {
    super(
      `Invalid dependency: ${dependencyName}. ${reason}`,
      'INVALID_DEPENDENCY',
      { dependencyName, reason }
    );
    this.name = 'InvalidDependencyError';
  }
}

/**
 * Connection error - thrown when connection establishment or operation fails
 */
export class ConnectionError extends ConnectionCoreError {
  constructor(message: string, peerId?: string, cause?: Error) {
    super(message, 'CONNECTION_FAILED', { peerId, cause });
    this.name = 'ConnectionError';
  }
}

/**
 * Transport error - thrown when transport layer operation fails
 */
export class TransportError extends ConnectionCoreError {
  constructor(message: string, transportType: string, cause?: Error) {
    super(message, 'TRANSPORT_ERROR', { transportType, cause });
    this.name = 'TransportError';
  }
}

/**
 * Pairing error - thrown when pairing workflow fails
 */
export class PairingError extends ConnectionCoreError {
  constructor(message: string, reason: string, requestId?: string) {
    super(message, 'PAIRING_FAILED', { reason, requestId });
    this.name = 'PairingError';
  }
}

/**
 * Credential verification error - thrown when credential verification fails
 */
export class CredentialVerificationError extends ConnectionCoreError {
  constructor(
    message: string,
    verificationCode: string,
    credentialId?: string
  ) {
    super(message, verificationCode, { credentialId });
    this.name = 'CredentialVerificationError';
  }
}

/**
 * State transition error - thrown when invalid state transition is attempted
 */
export class StateTransitionError extends ConnectionCoreError {
  constructor(
    currentState: string,
    attemptedState: string,
    entityType: string
  ) {
    super(
      `Invalid state transition for ${entityType}: cannot transition from '${currentState}' to '${attemptedState}'`,
      'INVALID_STATE_TRANSITION',
      { currentState, attemptedState, entityType }
    );
    this.name = 'StateTransitionError';
  }
}

/**
 * Discovery error - thrown when peer discovery fails
 */
export class DiscoveryError extends ConnectionCoreError {
  constructor(message: string, method: 'local' | 'relay', cause?: Error) {
    super(message, 'DISCOVERY_FAILED', { method, cause });
    this.name = 'DiscoveryError';
  }
}

/**
 * Group error - thrown when group operation fails
 */
export class GroupError extends ConnectionCoreError {
  constructor(message: string, groupId: string, reason: string) {
    super(message, 'GROUP_ERROR', { groupId, reason });
    this.name = 'GroupError';
  }
}

/**
 * Peer not found error - thrown when operation references unknown peer
 */
export class PeerNotFoundError extends ConnectionCoreError {
  constructor(peerId: string) {
    super(
      `Peer not found: ${peerId}. Peer must be discovered and paired before connection.`,
      'PEER_NOT_FOUND',
      { peerId }
    );
    this.name = 'PeerNotFoundError';
  }
}

/**
 * Peer not paired error - thrown when attempting to connect to unpaired peer
 */
export class PeerNotPairedError extends ConnectionCoreError {
  constructor(peerId: string) {
    super(
      `Peer not paired: ${peerId}. Pairing must complete successfully before establishing connection.`,
      'PEER_NOT_PAIRED',
      { peerId }
    );
    this.name = 'PeerNotPairedError';
  }
}

/**
 * Connection limit error - thrown when connection limit is reached
 */
export class ConnectionLimitError extends ConnectionCoreError {
  constructor(limit: number) {
    super(
      `Connection limit reached: ${limit} concurrent connections. Cannot accept new connections.`,
      'CONNECTION_LIMIT_REACHED',
      { limit }
    );
    this.name = 'ConnectionLimitError';
  }
}

/**
 * Group size limit error - thrown when group size limit is exceeded
 */
export class GroupSizeLimitError extends ConnectionCoreError {
  constructor(limit: number, groupId: string) {
    super(
      `Group size limit reached: ${limit} members maximum. Cannot add more members to group ${groupId}.`,
      'GROUP_SIZE_LIMIT',
      { limit, groupId }
    );
    this.name = 'GroupSizeLimitError';
  }
}

/**
 * Timeout error - thrown when operation times out
 */
export class TimeoutError extends ConnectionCoreError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `Operation timed out: ${operation} did not complete within ${timeoutMs}ms`,
      'TIMEOUT',
      { operation, timeoutMs }
    );
    this.name = 'TimeoutError';
  }
}

/**
 * Not initialized error - thrown when operation called before initialization
 */
export class NotInitializedError extends ConnectionCoreError {
  constructor(component: string) {
    super(
      `${component} not initialized. Call initialize() before using.`,
      'NOT_INITIALIZED',
      { component }
    );
    this.name = 'NotInitializedError';
  }
}

/**
 * Already initialized error - thrown when attempting to initialize twice
 */
export class AlreadyInitializedError extends ConnectionCoreError {
  constructor(component: string) {
    super(
      `${component} already initialized. Cannot initialize twice.`,
      'ALREADY_INITIALIZED',
      { component }
    );
    this.name = 'AlreadyInitializedError';
  }
}
