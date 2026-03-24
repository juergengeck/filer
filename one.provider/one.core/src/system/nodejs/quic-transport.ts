/**
 * @author REFINIO GmbH
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * Node.js QUIC Transport Implementation
 * 
 * This provides a WebSocket-based passthrough for QUIC functionality
 * since native QUIC is not yet available in Node.js stable releases.
 * It implements the QuicTransport interface using WebSockets as the
 * underlying transport mechanism.
 */

import { EventEmitter } from 'events';
import type { 
    QuicTransport, 
    QuicConnection, 
    QuicStream, 
    QuicConfig 
} from '../quic-transport.js';
import type { WebsocketStatistics } from '../../recipes.js';
import type { AnyFunction } from '../../util/function.js';
import { createError } from '../../errors.js';
import Debug from 'debug';
import WebSocket from 'ws';

const debug = Debug('one:quic:transport:nodejs');

/**
 * WebSocket-based QUIC transport for Node.js
 * This is a passthrough implementation that uses WebSockets
 * to provide QUIC-like functionality until native QUIC is available
 */
export class NodeQuicTransport extends EventEmitter implements QuicTransport {
    readonly type = 'quic-transport' as const;
    readonly connId: number = Date.now();
    
    private statistics: WebsocketStatistics = {
        requestsSentTotal: 0,
        requestsReceivedTotal: 0,
        requestsReceivedInvalid: 0
    };
    
    private connections: Map<string, QuicConnection> = new Map();
    private streams: Map<string, QuicStream> = new Map();
    private services: Map<number, AnyFunction> = new Map();
    private wsServer: any = null;
    private wsClients: Map<string, any> = new Map();
    
    promise: Promise<WebsocketStatistics>;
    
    get stats(): Readonly<WebsocketStatistics> {
        return this.statistics;
    }
    
    constructor() {
        super();
        debug('NodeQuicTransport created - using WebSocket passthrough');
        this.promise = Promise.resolve(this.statistics);
    }
    
    // QuicTransport interface methods
    
    async listen(config: QuicConfig): Promise<void> {
        const port = config.port || 9876;
        const host = config.host || 'localhost';
        
        debug(`Starting WebSocket server on ${host}:${port} as QUIC passthrough`);
        
        // Create WebSocket server
        const { WebSocketServer } = await import('ws');
        
        this.wsServer = new WebSocketServer({ 
            port, 
            host,
            perMessageDeflate: false 
        });
        
        this.wsServer.on('connection', (ws: any, req: any) => {
            const remoteAddress = req.socket.remoteAddress || 'unknown';
            const remotePort = req.socket.remotePort || 0;
            const connId = `${remoteAddress}:${remotePort}`;
            
            debug(`New WebSocket connection from ${connId}`);
            
            const connection: QuicConnection = {
                id: connId,
                remoteAddress,
                remotePort
            };
            
            this.connections.set(connId, connection);
            this.wsClients.set(connId, ws);
            
            // Handle WebSocket events
            ws.on('message', (data: Buffer) => {
                this.handleMessage(connection, data);
            });
            
            ws.on('close', () => {
                debug(`Connection closed: ${connId}`);
                this.connections.delete(connId);
                this.wsClients.delete(connId);
                this.emit('close', connection);
            });
            
            ws.on('error', (error: Error) => {
                debug(`Connection error ${connId}:`, error);
                this.emit('error', error, connection);
            });
            
            this.emit('connection', connection);
        });
        
        this.wsServer.on('error', (error: Error) => {
            debug('Server error:', error);
            this.emit('error', error);
        });
        
        debug(`WebSocket server listening on ${host}:${port}`);
    }
    
    async connect(config: QuicConfig): Promise<QuicConnection> {
        const host = config.host || 'localhost';
        const port = config.port || 9876;
        const url = `ws://${host}:${port}`;
        
        debug(`Connecting to ${url}`);
        
        const ws = new WebSocket(url);
        
        return new Promise((resolve, reject) => {
            ws.on('open', () => {
                const connId = `${host}:${port}`;
                const connection: QuicConnection = {
                    id: connId,
                    remoteAddress: host,
                    remotePort: port
                };
                
                this.connections.set(connId, connection);
                this.wsClients.set(connId, ws);
                
                debug(`Connected to ${url}`);
                resolve(connection);
            });
            
            ws.on('error', (error: Error) => {
                debug(`Connection failed to ${url}:`, error);
                reject(error);
            });
        });
    }
    
    async createStream(connection: QuicConnection): Promise<QuicStream> {
        const streamId = Date.now();
        const stream: QuicStream = {
            id: streamId,
            connection,
            write: async (data: Uint8Array) => {
                const ws = this.wsClients.get(connection.id);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                    this.statistics.requestsSentTotal++;
                }
            },
            read: async () => {
                // For simplicity, return empty data
                // Real implementation would queue incoming messages
                return new Uint8Array(0);
            },
            close: async () => {
                this.streams.delete(`${connection.id}-${streamId}`);
            }
        };
        
        this.streams.set(`${connection.id}-${streamId}`, stream);
        return stream;
    }
    
    // WebsocketPromisifierAPI requires this signature
    close(reason?: string): void {
        this.closeAsync().catch(error => {
            debug('Error during close:', error);
        });
    }
    
    // Internal async close implementation
    private async closeAsync(): Promise<void> {
        debug('Closing QUIC transport');
        
        // Close all client connections
        for (const ws of this.wsClients.values()) {
            ws.close();
        }
        
        // Close server if running
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        
        this.connections.clear();
        this.wsClients.clear();
        this.streams.clear();
        this.services.clear();
    }
    
    // WebsocketPromisifierAPI methods
    
    addService(id: number, fn: AnyFunction): void {
        debug(`Adding service ${id}`);
        this.services.set(id, fn);
    }
    
    removeService(id: number): void {
        debug(`Removing service ${id}`);
        this.services.delete(id);
    }
    
    clearServices(): void {
        debug('Clearing all services');
        this.services.clear();
    }
    
    async send(type: number, ...args: readonly unknown[]): Promise<unknown> {
        // Send to all connected clients
        const message = JSON.stringify({ type, args });
        
        for (const [connId, ws] of this.wsClients.entries()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
                this.statistics.requestsSentTotal++;
            }
        }
        
        return undefined;
    }
    
    // Private helper methods
    
    private handleMessage(connection: QuicConnection, data: Buffer): void {
        try {
            // Try to parse as JSON for structured messages
            const message = JSON.parse(data.toString());
            
            if (message.type !== undefined && this.services.has(message.type)) {
                const service = this.services.get(message.type);
                if (service) {
                    const result = service(...(message.args || []));
                    // Send result back if needed
                    const ws = this.wsClients.get(connection.id);
                    if (ws && result !== undefined) {
                        ws.send(JSON.stringify({ type: 'response', result }));
                    }
                }
            }
            
            this.statistics.requestsReceivedTotal++;
            this.emit('message', data, connection);
        } catch (error) {
            debug('Failed to handle message:', error);
            this.statistics.requestsReceivedInvalid++;
        }
    }
}

// Export factory function
export function createNodeQuicTransport(): QuicTransport {
    return new NodeQuicTransport();
}