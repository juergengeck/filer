/**
 * ReconnectionManager - Handles automatic reconnection with exponential backoff
 *
 * Manages reconnection attempts for disconnected peers with exponential backoff
 * to prevent connection storms when network returns.
 */

import type { PeerIdentity } from '../types/platform-interfaces.js';
import type { ReconnectionTask } from '../types/connection-types.js';

/**
 * Reconnection callback type - returns Connection on successful reconnect
 */
type ReconnectCallback = (peer: PeerIdentity) => Promise<unknown>;

export class ReconnectionManager {
  /** Active reconnection tasks by peer ID */
  private reconnectionTasks: Map<string, ReconnectionTask> = new Map();

  /** Exponential backoff schedule in milliseconds */
  private readonly backoffSchedule: number[] = [1000, 2000, 4000, 8000, 16000, 32000, 60000];

  /** Maximum reconnection attempts */
  private readonly maxAttempts: number = 10;

  /** Reconnection callback */
  private reconnectCallback: ReconnectCallback | null = null;

  /**
   * Set reconnection callback
   * Called when attempting to reconnect to a peer
   */
  setReconnectCallback(callback: ReconnectCallback): void {
    this.reconnectCallback = callback;
  }

  /**
   * Schedule reconnection for disconnected peer
   */
  scheduleReconnection(peer: PeerIdentity): void {
    // Don't schedule if already reconnecting
    if (this.reconnectionTasks.has(peer.id)) {
      return;
    }

    // Create reconnection task
    const task: ReconnectionTask = {
      peerId: peer.id,
      attempts: 0,
      nextAttemptAt: Date.now() + this.backoffSchedule[0]!,
      timeoutHandle: null,
    };

    this.reconnectionTasks.set(peer.id, task);

    // Schedule first attempt
    this.scheduleNextAttempt(peer, task);
  }

  /**
   * Schedule next reconnection attempt with exponential backoff
   */
  private scheduleNextAttempt(peer: PeerIdentity, task: ReconnectionTask): void {
    const delay = this.getBackoffDelay(task.attempts);
    task.nextAttemptAt = Date.now() + delay;

    // Clear existing timeout if any
    if (task.timeoutHandle !== null) {
      clearTimeout(task.timeoutHandle as ReturnType<typeof setTimeout>);
    }

    // Schedule attempt
    task.timeoutHandle = setTimeout(() => {
      void this.attemptReconnection(peer, task);
    }, delay);
  }

  /**
   * Get backoff delay for given attempt number
   */
  private getBackoffDelay(attempts: number): number {
    const index = Math.min(attempts, this.backoffSchedule.length - 1);
    return this.backoffSchedule[index]!;
  }

  /**
   * Attempt reconnection to peer
   */
  private async attemptReconnection(
    peer: PeerIdentity,
    task: ReconnectionTask
  ): Promise<void> {
    if (!this.reconnectCallback) {
      // No callback set, cancel reconnection
      this.cancelReconnection(peer.id);
      return;
    }

    task.attempts++;

    try {
      // Attempt reconnection via callback
      await this.reconnectCallback(peer);

      // Success! Remove task
      this.cancelReconnection(peer.id);
    } catch (error) {
      // Reconnection failed
      if (task.attempts >= this.maxAttempts) {
        // Max attempts reached, give up
        console.error(
          `Reconnection to ${peer.id} failed after ${task.attempts} attempts`,
          error
        );
        this.cancelReconnection(peer.id);
      } else {
        // Schedule next attempt with exponential backoff
        this.scheduleNextAttempt(peer, task);
      }
    }
  }

  /**
   * Cancel reconnection for peer
   */
  cancelReconnection(peerId: string): void {
    const task = this.reconnectionTasks.get(peerId);
    if (!task) {
      return;
    }

    // Clear timeout
    if (task.timeoutHandle !== null) {
      clearTimeout(task.timeoutHandle as ReturnType<typeof setTimeout>);
    }

    // Remove task
    this.reconnectionTasks.delete(peerId);
  }

  /**
   * Cancel all reconnections
   */
  cancelAll(): void {
    for (const [peerId] of this.reconnectionTasks) {
      this.cancelReconnection(peerId);
    }
  }

  /**
   * Check if peer has active reconnection task
   */
  isReconnecting(peerId: string): boolean {
    return this.reconnectionTasks.has(peerId);
  }

  /**
   * Get reconnection task for peer
   */
  getTask(peerId: string): ReconnectionTask | undefined {
    return this.reconnectionTasks.get(peerId);
  }

  /**
   * Get count of active reconnection tasks
   */
  getActiveCount(): number {
    return this.reconnectionTasks.size;
  }
}
