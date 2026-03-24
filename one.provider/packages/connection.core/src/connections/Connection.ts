/**
 * Connection - Represents an active P2P connection to a single peer
 *
 * Wraps platform-specific transport and provides unified connection interface.
 */

import type { Transport } from '../types/platform-interfaces.js';
import type {
  Connection as IConnection,
  ConnectionStateValue,
  ConnectionMetadata,
} from '../types/connection-types.js';
import { ConnectionState } from './ConnectionState.js';
import { ConnectionError } from '../utils/error-handling.js';

export class Connection implements IConnection {
  /** Unique connection ID */
  public readonly id: string;

  /** Remote peer ID */
  public readonly peerId: string;

  /** Connection state tracker */
  private readonly connectionState: ConnectionState;

  /** Network transport */
  private readonly transport: Transport;

  /** Transport type */
  public readonly transportType: 'quicvc' | 'websocket';

  /** Connection establishment timestamp */
  public readonly establishedAt: number;

  /** Last activity timestamp */
  public lastActivityAt: number;

  /** Connection metadata */
  public metadata?: ConnectionMetadata;

  /** Data receive callbacks */
  private receiveCallbacks: ((data: Uint8Array) => void)[] = [];

  /** State change callbacks */
  private stateChangeCallbacks: ((state: ConnectionStateValue) => void)[] = [];

  constructor(
    id: string,
    peerId: string,
    transport: Transport,
    transportType: 'quicvc' | 'websocket'
  ) {
    this.id = id;
    this.peerId = peerId;
    this.transport = transport;
    this.transportType = transportType;
    this.establishedAt = Date.now();
    this.lastActivityAt = this.establishedAt;
    this.connectionState = new ConnectionState('connecting');

    // Setup transport callbacks
    this.setupTransportCallbacks();
  }

  /**
   * Get current connection state
   */
  get state(): ConnectionStateValue {
    return this.connectionState.current;
  }

  /**
   * Setup transport event callbacks
   */
  private setupTransportCallbacks(): void {
    // Handle incoming data
    this.transport.onReceive((data) => {
      this.updateActivity();
      this.receiveCallbacks.forEach((callback) => callback(data));
    });

    // Handle transport state changes
    this.transport.onStateChange((transportState) => {
      // Map transport state to connection state
      switch (transportState) {
        case 'connecting':
          if (this.connectionState.current === 'disconnected') {
            this.connectionState.transition('connecting');
            this.emitStateChange('connecting');
          }
          break;
        case 'connected':
          if (this.connectionState.current === 'connecting') {
            this.connectionState.transition('connected');
            this.emitStateChange('connected');
          }
          break;
        case 'disconnecting':
          if (this.connectionState.current === 'connected') {
            this.connectionState.transition('disconnecting');
            this.emitStateChange('disconnecting');
          }
          break;
        case 'disconnected':
          if (this.connectionState.current !== 'disconnected') {
            // Can transition from any state to disconnected on error
            this.connectionState.current = 'disconnected';
            this.connectionState.transitionedAt = Date.now();
            this.emitStateChange('disconnected');
          }
          break;
      }
    });
  }

  /**
   * Send data to peer
   * @throws ConnectionError if not connected
   */
  async send(data: Uint8Array): Promise<void> {
    if (!this.isAlive()) {
      throw new ConnectionError(
        `Cannot send data: connection to ${this.peerId} is not in connected state`,
        this.peerId
      );
    }

    try {
      await this.transport.send(data);
      this.updateActivity();
    } catch (error) {
      this.connectionState.incrementErrorCount();
      throw new ConnectionError(
        `Failed to send data to ${this.peerId}: ${error instanceof Error ? error.message : String(error)}`,
        this.peerId,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Close connection gracefully
   */
  close(): void {
    if (this.connectionState.current === 'connected') {
      this.connectionState.transition('disconnecting');
      this.emitStateChange('disconnecting');
    }

    this.transport.close();

    // State will transition to disconnected via transport callback
  }

  /**
   * Check if connection is alive (in connected state)
   */
  isAlive(): boolean {
    return this.connectionState.isConnected();
  }

  /**
   * Register data receive callback
   */
  onReceive(callback: (data: Uint8Array) => void): void {
    this.receiveCallbacks.push(callback);
  }

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: ConnectionStateValue) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /**
   * Emit state change to all callbacks
   */
  private emitStateChange(state: ConnectionStateValue): void {
    this.stateChangeCallbacks.forEach((callback) => callback(state));
  }

  /**
   * Get connection info for debugging
   */
  toString(): string {
    return `Connection(${this.id}, peer=${this.peerId}, state=${this.state}, transport=${this.transportType})`;
  }
}
