/**
 * @author REFINIO GmbH
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

import { createError } from '../errors.js';
import type { WebsocketPromisifierAPI } from '../websocket-promisifier.js';
import Debug from 'debug';

const debug = Debug('one:quic:transport');

export interface QuicConfig {
    port?: number;
    host?: string;
    maxDatagramSize?: number;
}

export interface QuicConnection {
    readonly id: string;
    readonly remoteAddress: string;
    readonly remotePort: number;
}

export interface QuicStream {
    readonly id: number;
    readonly connection: QuicConnection;
    write(data: Uint8Array): Promise<void>;
    read(): Promise<Uint8Array>;
    close(): Promise<void>;
}

/**
 * Extended QUIC transport interface with optional flags
 * for different implementations
 */
export interface ExtendedQuicTransport extends QuicTransport {
    isPassthrough?: boolean;
}

/**
 * QUIC transport that implements the WebsocketPromisifierAPI interface
 * to integrate with the chum protocol.
 * 
 * Also includes EventEmitter methods for event handling.
 */
export interface QuicTransport extends WebsocketPromisifierAPI {
    type: 'quic-transport';
    listen(config: QuicConfig): Promise<void>;
    connect(config: QuicConfig): Promise<QuicConnection>;
    createStream(connection: QuicConnection): Promise<QuicStream>;
    // close is inherited from WebsocketPromisifierAPI: close(reason?: string): void
    
    /**
     * Register an event handler
     */
    on(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Register a one-time event handler
     */
    once(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Remove an event handler
     */
    off(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Emit an event
     */
    emit(event: string, ...args: any[]): boolean;

    /**
     * Get the number of listeners for an event
     */
    listenerCount(event: string): number;
    
    /**
     * Get all listeners for an event
     */
    listeners(event: string): Function[];
    
    /**
     * Remove all listeners for all events or a specific event
     */
    removeAllListeners(event?: string): this;
    
    /**
     * Set the maximum number of listeners
     */
    setMaxListeners(n: number): this;
    
    /**
     * Get the maximum number of listeners
     */
    getMaxListeners(): number;
    
    /**
     * Get all event names for which there are listeners
     */
    eventNames(): (string | symbol)[];
    
    /**
     * Add a listener prepended to the listeners array
     */
    prependListener(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Add a one-time listener prepended to the listeners array
     */
    prependOnceListener(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Returns a copy of the array of listeners for the event
     */
    rawListeners(event: string): Function[];
}

// Platform-specific implementation - modified to allow overrides
let QT: QuicTransport | null = null;

/**
 * Set the platform implementation
 * Modified to allow overriding without throwing errors
 */
export function setPlatformForQt(qt: QuicTransport): void {
    // Always allow overriding the implementation
    QT = qt;
}

/**
 * Check if the QUIC transport is initialized
 */
export function isQuicTransportInitialized(): boolean {
    return QT !== null;
}

/**
 * Get the QUIC transport implementation
 * Modified to return null when not initialized instead of throwing an error
 */
export function getQuicTransport(): QuicTransport | null {
    return QT;
}

/**
 * Create a QuicVC transport instance
 * This is a convenience function for creating QuicVC transport
 */
export async function createQuicVCTransport(): Promise<QuicTransport> {
    const { createQuicVCTransport: createTransport } = await import('./quicvc-transport.js');
    return createTransport();
} 