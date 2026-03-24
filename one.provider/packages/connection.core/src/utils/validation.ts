/**
 * Validation Utilities
 *
 * Validation functions for platform dependencies, state transitions, and data integrity.
 * All validation follows fail-fast principle - throws clear errors when validation fails.
 */

import type { PlatformDependencies } from '../types/platform-interfaces.js';
import type { ConnectionStateValue, PairingState } from '../types/connection-types.js';
import {
  MissingDependencyError,
  InvalidDependencyError,
  StateTransitionError,
} from './error-handling.js';

/**
 * Validate platform dependencies
 * @throws MissingDependencyError if required dependency is missing
 * @throws InvalidDependencyError if dependency is invalid
 */
export function validatePlatformDependencies(deps: Partial<PlatformDependencies>): void {
  // Check required dependencies
  if (!deps.transport) {
    throw new MissingDependencyError('transport');
  }
  if (!deps.storage) {
    throw new MissingDependencyError('storage');
  }
  if (!deps.ui) {
    throw new MissingDependencyError('ui');
  }

  // Validate transport factory
  if (typeof deps.transport.create !== 'function') {
    throw new InvalidDependencyError('transport', 'Must have create() method');
  }
  if (typeof deps.transport.getSupportedTransports !== 'function') {
    throw new InvalidDependencyError('transport', 'Must have getSupportedTransports() method');
  }

  // Validate storage adapter
  const requiredStorageMethods = [
    'storePeer',
    'getPeer',
    'listPeers',
    'removePeer',
    'storeCredential',
    'getCredential',
    'listCredentials',
  ];
  for (const method of requiredStorageMethods) {
    // @ts-ignore - Type conversion will be fixed later
    if (typeof (deps.storage as Record<string, unknown>)[method] !== 'function') {
      throw new InvalidDependencyError('storage', `Must have ${method}() method`);
    }
  }

  // Validate UI callbacks
  const requiredUICallbacks = ['onPairingRequest', 'onError', 'onConnectionStateChange'];
  for (const callback of requiredUICallbacks) {
    // @ts-ignore - Type conversion will be fixed later
    if (typeof (deps.ui as Record<string, unknown>)[callback] !== 'function') {
      throw new InvalidDependencyError('ui', `Must have ${callback}() callback`);
    }
  }
}

/**
 * Valid connection state transitions
 */
const VALID_CONNECTION_TRANSITIONS: Record<ConnectionStateValue, ConnectionStateValue[]> = {
  connecting: ['connected', 'disconnected'],
  connected: ['disconnecting', 'disconnected'],
  disconnecting: ['disconnected'],
  disconnected: ['connecting'],
};

/**
 * Validate connection state transition
 * @throws StateTransitionError if transition is invalid
 */
export function validateConnectionStateTransition(
  current: ConnectionStateValue,
  next: ConnectionStateValue
): void {
  // Cannot transition to same state
  if (current === next) {
    throw new StateTransitionError(current, next, 'Connection');
  }

  // Check if transition is valid
  const validTransitions = VALID_CONNECTION_TRANSITIONS[current];
  if (!validTransitions || !validTransitions.includes(next)) {
    throw new StateTransitionError(current, next, 'Connection');
  }
}

/**
 * Valid pairing state transitions
 */
const VALID_PAIRING_TRANSITIONS: Record<PairingState, PairingState[]> = {
  initiated: ['pending', 'timeout'],
  pending: ['accepted', 'rejected', 'timeout'],
  accepted: ['completed', 'timeout'],
  rejected: [], // Terminal state
  timeout: [], // Terminal state
  completed: [], // Terminal state
};

/**
 * Validate pairing state transition
 * @throws StateTransitionError if transition is invalid
 */
export function validatePairingStateTransition(current: PairingState, next: PairingState): void {
  // Cannot transition to same state
  if (current === next) {
    throw new StateTransitionError(current, next, 'PairingRequest');
  }

  // Check if transition is valid
  const validTransitions = VALID_PAIRING_TRANSITIONS[current];
  if (!validTransitions || !validTransitions.includes(next)) {
    throw new StateTransitionError(current, next, 'PairingRequest');
  }
}

/**
 * Validate peer ID format
 * @throws Error if peer ID is invalid
 */
export function validatePeerId(peerId: string): void {
  if (!peerId || typeof peerId !== 'string') {
    throw new Error('Peer ID must be a non-empty string');
  }
  if (peerId.trim().length === 0) {
    throw new Error('Peer ID cannot be empty or whitespace');
  }
}

/**
 * Validate group ID format
 * @throws Error if group ID is invalid
 */
export function validateGroupId(groupId: string): void {
  if (!groupId || typeof groupId !== 'string') {
    throw new Error('Group ID must be a non-empty string');
  }
  if (groupId.trim().length === 0) {
    throw new Error('Group ID cannot be empty or whitespace');
  }
}

/**
 * Validate network address format
 * @throws Error if address is invalid
 */
export function validateAddress(address: string): void {
  if (!address || typeof address !== 'string') {
    throw new Error('Address must be a non-empty string');
  }
  if (address.trim().length === 0) {
    throw new Error('Address cannot be empty or whitespace');
  }
  // Basic format validation (IP:port or URL)
  const ipPortPattern = /^[\w\-.]+:\d+$/;
  const urlPattern = /^wss?:\/\/.+$/;
  if (!ipPortPattern.test(address) && !urlPattern.test(address)) {
    throw new Error('Address must be in format "host:port" or "ws(s)://url"');
  }
}

/**
 * Validate array is non-empty
 * @throws Error if array is empty
 */
export function validateNonEmptyArray<T>(arr: T[], name: string): void {
  if (!Array.isArray(arr)) {
    throw new Error(`${name} must be an array`);
  }
  if (arr.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
}

/**
 * Validate number is within range
 * @throws Error if number is out of range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  name: string
): void {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

/**
 * Validate timeout value
 * @throws Error if timeout is invalid
 */
export function validateTimeout(timeout: number): void {
  validateRange(timeout, 0, 600000, 'Timeout'); // Max 10 minutes
  if (timeout <= 0) {
    throw new Error('Timeout must be positive');
  }
}

/**
 * Validate timestamp is not in the future
 * @throws Error if timestamp is invalid
 */
export function validateTimestamp(timestamp: number, name: string): void {
  if (typeof timestamp !== 'number' || isNaN(timestamp)) {
    throw new Error(`${name} must be a number`);
  }
  if (timestamp < 0) {
    throw new Error(`${name} cannot be negative`);
  }
  const now = Date.now();
  if (timestamp > now + 1000) {
    // Allow 1s clock skew
    throw new Error(`${name} cannot be in the future`);
  }
}

/**
 * Validate ISO 8601 date string
 * @throws Error if date string is invalid
 */
export function validateISODate(dateString: string, name: string): void {
  if (!dateString || typeof dateString !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
  if (!iso8601Pattern.test(dateString)) {
    throw new Error(`${name} must be in ISO 8601 format (e.g., "2025-01-01T00:00:00.000Z")`);
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`${name} is not a valid date`);
  }
}
