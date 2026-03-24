/**
 * ConnectionState - Tracks connection lifecycle state and transitions
 *
 * Manages connection state with validation and history tracking.
 */

import type { ConnectionStateValue } from '../types/connection-types.js';
import { validateConnectionStateTransition } from '../utils/validation.js';

export class ConnectionState {
  /** Current connection state */
  public current: ConnectionStateValue;

  /** Previous state for history */
  public previous: ConnectionStateValue | null = null;

  /** Last transition timestamp */
  public transitionedAt: number;

  /** Count of errors encountered */
  public errorCount: number = 0;

  /** Count of reconnection attempts */
  public reconnectAttempts: number = 0;

  constructor(initialState: ConnectionStateValue = 'disconnected') {
    this.current = initialState;
    this.transitionedAt = Date.now();
  }

  /**
   * Transition to new state with validation
   * @throws StateTransitionError if transition is invalid
   */
  transition(newState: ConnectionStateValue): void {
    // Validate transition is allowed
    validateConnectionStateTransition(this.current, newState);

    // Update state
    this.previous = this.current;
    this.current = newState;
    this.transitionedAt = Date.now();
  }

  /**
   * Increment error count
   */
  incrementErrorCount(): void {
    this.errorCount++;
  }

  /**
   * Increment reconnection attempt count
   */
  incrementReconnectAttempts(): void {
    this.reconnectAttempts++;
  }

  /**
   * Reset reconnection attempts (on successful reconnect)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.current === 'connected';
  }

  /**
   * Check if in terminal state (cannot transition further without external action)
   */
  isTerminal(): boolean {
    return this.current === 'disconnected';
  }

  /**
   * Get state as plain object for serialization
   */
  toJSON() {
    return {
      current: this.current,
      previous: this.previous,
      transitionedAt: this.transitionedAt,
      errorCount: this.errorCount,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
