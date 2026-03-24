/**
 * @author REFINIO GmbH
 * @copyright REFINIO GmbH 2024
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * QuicVC Transport Implementation for one.core
 * 
 * This implements QUIC with Verifiable Credentials transport
 * by adapting the QuicVCClient and QuicVCServer implementations
 * to match the QuicTransport interface.
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import tweetnacl from 'tweetnacl';
import { createHash } from 'crypto';
import type { 
    QuicTransport, 
    QuicConnection, 
    QuicStream, 
    QuicConfig 
} from './quic-transport.js';
import type { WebsocketStatistics } from '../recipes.js';
import type { AnyFunction } from '../util/function.js';
import { createError } from '../errors.js';
import Debug from 'debug';

const debug = Debug('one:quicvc:transport');

// QUICVC packet types
export enum QuicVCPacketType {
    INITIAL = 0x00,      // Contains VC_INIT frame
    HANDSHAKE = 0x01,    // Contains VC_RESPONSE frame
    PROTECTED = 0x02,    // Regular data packets (encrypted)
    RETRY = 0x03         // Retry with different parameters
}

// QUICVC frame types
export enum QuicVCFrameType {
    VC_INIT = 0x10,      // Client credential presentation
    VC_RESPONSE = 0x11,  // Server credential response
    VC_ACK = 0x12,       // Acknowledge VC exchange
    STREAM = 0x08,       // Stream data (QUIC standard)
    ACK = 0x02,          // Acknowledgment (QUIC standard)
    HEARTBEAT = 0x20     // Custom heartbeat frame
}

export interface QuicVCCredential {
    id: string;
    type: string[];
    issuer: string;
    issuanceDate: string;
    credentialSubject: {
        id: string;
        deviceId: string;
        publicKeyHex: string;
        type: 'Device';
    };
    proof?: {
        type: string;
        created: string;
        proofPurpose: string;
        proofValue: string;
    };
}

interface CryptoKeys {
    encryptionKey: Uint8Array;
    decryptionKey: Uint8Array;
    sendIV: Uint8Array;
    receiveIV: Uint8Array;
    sendHMAC: Uint8Array;
    receiveHMAC: Uint8Array;
}

export class QuicVCConnection implements QuicConnection {
    readonly id: string;
    readonly remoteAddress: string;
    readonly remotePort: number;
    
    deviceId: string;
    dcid: Uint8Array;
    scid: Uint8Array;
    state: 'initial' | 'handshake' | 'established' | 'closed';
    nextPacketNumber: bigint;
    highestReceivedPacket: bigint;
    localVC: QuicVCCredential | null;
    remoteVC: any | null;
    challenge: string;
    keys: CryptoKeys | null;
    socket: dgram.Socket | null;

    constructor(id: string, remoteAddress: string, remotePort: number) {
        this.id = id;
        this.remoteAddress = remoteAddress;
        this.remotePort = remotePort;
        this.deviceId = `quicvc-${Date.now()}`;
        this.dcid = tweetnacl.randomBytes(16);
        this.scid = tweetnacl.randomBytes(16);
        this.state = 'initial';
        this.nextPacketNumber = 0n;
        this.highestReceivedPacket = -1n;
        this.localVC = null;
        this.remoteVC = null;
        this.challenge = '';
        this.keys = null;
        this.socket = null;
    }
}

export class QuicVCStream implements QuicStream {
    readonly id: number;
    readonly connection: QuicConnection;
    private transport: QuicVCTransport;

    constructor(id: number, connection: QuicConnection, transport: QuicVCTransport) {
        this.id = id;
        this.connection = connection;
        this.transport = transport;
    }

    async write(data: Uint8Array): Promise<void> {
        const streamFrame = {
            type: QuicVCFrameType.STREAM,
            streamId: this.id,
            offset: 0,
            data: Array.from(data)
        };
        
        await this.transport.sendProtectedPacket(this.connection as QuicVCConnection, [streamFrame]);
    }

    async read(): Promise<Uint8Array> {
        // For now, return empty data - would need proper stream buffering
        return new Uint8Array(0);
    }

    async close(): Promise<void> {
        debug(`Closing stream ${this.id}`);
    }
}

export class QuicVCTransport extends EventEmitter implements QuicTransport {
    readonly type = 'quic-transport' as const;
    readonly connId: number = Date.now();
    
    private statistics: WebsocketStatistics = {
        requestsSentTotal: 0,
        requestsReceivedTotal: 0,
        requestsReceivedInvalid: 0
    };
    
    private connections: Map<string, QuicVCConnection> = new Map();
    private streams: Map<string, QuicVCStream> = new Map();
    private services: Map<number, AnyFunction> = new Map();
    private server: dgram.Socket | null = null;
    private keypair: tweetnacl.BoxKeyPair | null = null;
    private signKeypair: tweetnacl.SignKeyPair | null = null;
    private readonly CONNECTION_ID_LENGTH = 16;
    private readonly QUICVC_VERSION = 0x00000001;
    private readonly QUICVC_PORT = 49497;
    
    promise: Promise<WebsocketStatistics>;
    
    get stats(): Readonly<WebsocketStatistics> {
        return this.statistics;
    }
    
    constructor() {
        super();
        debug('QuicVCTransport created');
        this.promise = Promise.resolve(this.statistics);
        this.generateKeypairs();
    }
    
    private generateKeypairs(): void {
        this.keypair = tweetnacl.box.keyPair();
        this.signKeypair = tweetnacl.sign.keyPair();
        debug('Generated keypairs for QUICVC');
    }
    
    // QuicTransport interface methods
    
    async listen(config: QuicConfig): Promise<void> {
        const port = config.port || this.QUICVC_PORT;
        const host = config.host || 'localhost';
        
        debug(`Starting QuicVC server on ${host}:${port}`);
        
        this.server = dgram.createSocket('udp4');
        
        this.server.on('message', (data: Buffer, rinfo: dgram.RemoteInfo) => {
            this.handleIncomingPacket(data, rinfo);
        });
        
        this.server.on('error', (error: Error) => {
            debug('Server error:', error);
            this.emit('error', error);
        });
        
        await new Promise<void>((resolve, reject) => {
            this.server!.bind(port, host, () => {
                debug(`QuicVC server listening on ${host}:${port}`);
                resolve();
            });
            this.server!.once('error', reject);
        });
    }
    
    async connect(config: QuicConfig): Promise<QuicConnection> {
        const host = config.host || 'localhost';
        const port = config.port || this.QUICVC_PORT;
        
        debug(`Connecting to ${host}:${port}`);
        
        const connection = new QuicVCConnection(`${host}:${port}`, host, port);
        connection.localVC = this.createLocalCredential();
        connection.challenge = this.generateChallenge();
        connection.socket = dgram.createSocket('udp4');
        
        // Setup socket handlers
        connection.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
            this.handlePacket(connection, msg, rinfo);
        });
        
        connection.socket.on('error', (err: Error) => {
            debug('Socket error:', err);
            this.emit('error', err);
        });
        
        // Bind socket
        await new Promise<void>((resolve, reject) => {
            connection.socket!.bind(0, '0.0.0.0', () => {
                resolve();
            });
            connection.socket!.once('error', reject);
        });
        
        this.connections.set(connection.id, connection);
        
        // Send initial packet
        await this.sendInitialPacket(connection);
        
        // Wait for handshake
        await this.waitForHandshake(connection);
        
        return connection;
    }
    
    async createStream(connection: QuicConnection): Promise<QuicStream> {
        const streamId = Date.now();
        const stream = new QuicVCStream(streamId, connection, this);
        
        this.streams.set(`${connection.id}-${streamId}`, stream);
        return stream;
    }
    
    close(reason?: string): void {
        debug('Closing QuicVC transport', reason);
        
        // Close all connections
        for (const connection of this.connections.values()) {
            connection.state = 'closed';
            if (connection.socket) {
                connection.socket.close();
            }
        }
        
        // Close server
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        
        this.connections.clear();
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
        // Send to all established connections
        for (const connection of this.connections.values()) {
            if (connection.state === 'established') {
                const message = { type, args };
                const streamFrame = {
                    type: QuicVCFrameType.STREAM,
                    streamId: 0,
                    offset: 0,
                    data: JSON.stringify(message)
                };
                
                await this.sendProtectedPacket(connection, [streamFrame]);
                this.statistics.requestsSentTotal++;
            }
        }
        
        return undefined;
    }
    
    // Private implementation methods
    
    private createLocalCredential(): QuicVCCredential {
        if (!this.keypair || !this.signKeypair) {
            throw new Error('Keypairs not generated');
        }
        
        const deviceId = `quicvc-${Date.now()}`;
        const publicKeyHex = Buffer.from(this.keypair.publicKey).toString('hex');
        
        const credential: QuicVCCredential = {
            id: `urn:uuid:${this.generateUUID()}`,
            type: ['VerifiableCredential', 'DeviceIdentityCredential'],
            issuer: 'did:refinio:quicvc',
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
                id: `did:refinio:device:${deviceId}`,
                deviceId,
                publicKeyHex,
                type: 'Device'
            }
        };
        
        // Sign the credential
        const message = JSON.stringify(credential.credentialSubject);
        const signature = tweetnacl.sign.detached(
            Buffer.from(message),
            this.signKeypair.secretKey
        );
        
        credential.proof = {
            type: 'Ed25519Signature2020',
            created: new Date().toISOString(),
            proofPurpose: 'assertionMethod',
            proofValue: Buffer.from(signature).toString('hex')
        };
        
        return credential;
    }
    
    private async sendInitialPacket(connection: QuicVCConnection): Promise<void> {
        if (!connection.localVC) {
            throw new Error('No local credential available');
        }
        
        const vcInitFrame = {
            type: QuicVCFrameType.VC_INIT,
            credential: connection.localVC,
            challenge: connection.challenge,
            timestamp: Date.now()
        };
        
        const packet = this.createPacket(
            QuicVCPacketType.INITIAL,
            connection,
            JSON.stringify(vcInitFrame)
        );
        
        await this.sendPacket(connection, packet);
        debug('Sent INITIAL packet with VC_INIT frame');
    }
    
    private async handleIncomingPacket(data: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
        // Handle incoming packets on server side
        const connId = `${rinfo.address}:${rinfo.port}`;
        let connection = this.connections.get(connId);
        
        if (!connection) {
            // Create new connection
            connection = new QuicVCConnection(connId, rinfo.address, rinfo.port);
            this.connections.set(connId, connection);
            this.emit('connection', connection);
        }
        
        await this.handlePacket(connection, data, rinfo);
    }
    
    private async handlePacket(connection: QuicVCConnection, data: Buffer, rinfo: dgram.RemoteInfo): Promise<void> {
        try {
            const header = this.parsePacketHeader(data);
            if (!header) return;
            
            connection.highestReceivedPacket = header.packetNumber;
            this.statistics.requestsReceivedTotal++;
            
            switch (header.type) {
                case QuicVCPacketType.INITIAL:
                    await this.handleInitialPacket(connection, data, header);
                    break;
                case QuicVCPacketType.HANDSHAKE:
                    await this.handleHandshakePacket(connection, data, header);
                    break;
                case QuicVCPacketType.PROTECTED:
                    await this.handleProtectedPacket(connection, data, header);
                    break;
            }
        } catch (error) {
            debug('Error handling packet:', error);
            this.statistics.requestsReceivedInvalid++;
        }
    }
    
    private async handleInitialPacket(connection: QuicVCConnection, data: Buffer, header: any): Promise<void> {
        const payload = this.extractPayload(data, header);
        const frame = JSON.parse(payload.toString());
        
        if (frame.type !== QuicVCFrameType.VC_INIT) return;
        
        debug('Received VC_INIT from client');
        connection.remoteVC = frame.credential;
        connection.localVC = this.createLocalCredential();
        
        // Send handshake response
        const vcResponseFrame = {
            type: QuicVCFrameType.VC_RESPONSE,
            credential: connection.localVC,
            timestamp: Date.now()
        };
        
        const packet = this.createPacket(
            QuicVCPacketType.HANDSHAKE,
            connection,
            JSON.stringify(vcResponseFrame)
        );
        
        await this.sendPacketTo(packet, connection.remoteAddress, connection.remotePort);
        connection.state = 'established';
        debug('Sent VC_RESPONSE to client');
    }
    
    private async handleHandshakePacket(connection: QuicVCConnection, data: Buffer, header: any): Promise<void> {
        const payload = this.extractPayload(data, header);
        const frame = JSON.parse(payload.toString());
        
        if (frame.type !== QuicVCFrameType.VC_RESPONSE) return;
        
        debug('Received VC_RESPONSE from server');
        connection.remoteVC = frame.credential;
        connection.keys = await this.deriveApplicationKeys(connection);
        connection.state = 'established';
        
        this.emit('connected', connection.deviceId);
        debug('QuicVC handshake complete');
    }
    
    private async handleProtectedPacket(connection: QuicVCConnection, data: Buffer, header: any): Promise<void> {
        if (connection.state !== 'established') return;
        
        const payload = this.extractPayload(data, header);
        
        try {
            const frames = JSON.parse(payload.toString());
            
            for (const frame of frames) {
                switch (frame.type) {
                    case QuicVCFrameType.STREAM:
                        if (frame.data && typeof frame.data === 'string') {
                            try {
                                const message = JSON.parse(frame.data);
                                if (message.type !== undefined && this.services.has(message.type)) {
                                    const service = this.services.get(message.type);
                                    if (service) {
                                        service(...(message.args || []));
                                    }
                                }
                            } catch {
                                // Not a service message, emit as data
                                this.emit('data', connection.deviceId, frame.data);
                            }
                        }
                        break;
                    case QuicVCFrameType.HEARTBEAT:
                        debug('Received heartbeat');
                        break;
                }
            }
        } catch (error) {
            debug('Failed to parse protected packet frames:', error);
        }
    }
    
    async sendProtectedPacket(connection: QuicVCConnection, frames: any[]): Promise<void> {
        const packet = this.createPacket(
            QuicVCPacketType.PROTECTED,
            connection,
            JSON.stringify(frames)
        );
        
        await this.sendPacket(connection, packet);
    }
    
    private createPacket(type: QuicVCPacketType, connection: QuicVCConnection, payload: string): Buffer {
        const header = {
            type,
            version: this.QUICVC_VERSION,
            dcid: connection.dcid,
            scid: connection.scid,
            packetNumber: connection.nextPacketNumber++
        };
        
        const headerBytes = this.serializeHeader(header);
        const payloadBytes = Buffer.from(payload);
        
        return Buffer.concat([headerBytes, payloadBytes]);
    }
    
    private serializeHeader(header: any): Buffer {
        const buffer = Buffer.alloc(1 + 4 + 1 + 1 + header.dcid.length + header.scid.length + 8);
        let offset = 0;
        
        buffer.writeUInt8(header.type, offset++);
        buffer.writeUInt32BE(header.version, offset); offset += 4;
        buffer.writeUInt8(header.dcid.length, offset++);
        buffer.writeUInt8(header.scid.length, offset++);
        
        Buffer.from(header.dcid).copy(buffer, offset);
        offset += header.dcid.length;
        
        Buffer.from(header.scid).copy(buffer, offset);
        offset += header.scid.length;
        
        buffer.writeBigUInt64BE(header.packetNumber, offset);
        
        return buffer;
    }
    
    private parsePacketHeader(data: Buffer): any {
        if (data.length < 15) return null;
        
        let offset = 0;
        
        const type = data.readUInt8(offset++);
        const version = data.readUInt32BE(offset); offset += 4;
        const dcidLen = data.readUInt8(offset++);
        const scidLen = data.readUInt8(offset++);
        
        if (data.length < offset + dcidLen + scidLen + 8) return null;
        
        const dcid = data.slice(offset, offset + dcidLen);
        offset += dcidLen;
        
        const scid = data.slice(offset, offset + scidLen);
        offset += scidLen;
        
        const packetNumber = data.readBigUInt64BE(offset);
        
        return { type, version, dcid, scid, packetNumber };
    }
    
    private extractPayload(data: Buffer, header: any): Buffer {
        const headerSize = 1 + 4 + 1 + 1 + header.dcid.length + header.scid.length + 8;
        return data.slice(headerSize);
    }
    
    private async sendPacket(connection: QuicVCConnection, packet: Buffer): Promise<void> {
        if (connection.socket) {
            await this.sendPacketVia(connection.socket, packet, connection.remoteAddress, connection.remotePort);
        } else {
            await this.sendPacketTo(packet, connection.remoteAddress, connection.remotePort);
        }
    }
    
    private async sendPacketTo(packet: Buffer, address: string, port: number): Promise<void> {
        if (!this.server) return;
        
        return new Promise((resolve, reject) => {
            this.server!.send(packet, port, address, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    
    private async sendPacketVia(socket: dgram.Socket, packet: Buffer, address: string, port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            socket.send(packet, port, address, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
    
    private async waitForHandshake(connection: QuicVCConnection, timeout: number = 5000): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (connection.state !== 'established') {
                    reject(new Error('Handshake timeout'));
                }
            }, timeout);
            
            const checkState = () => {
                if (connection.state === 'established') {
                    clearTimeout(timer);
                    resolve();
                } else if (connection.state === 'closed') {
                    clearTimeout(timer);
                    reject(new Error('Connection closed during handshake'));
                } else {
                    setTimeout(checkState, 100);
                }
            };
            
            checkState();
        });
    }
    
    private async deriveApplicationKeys(connection: QuicVCConnection): Promise<CryptoKeys> {
        const salt = Buffer.from('quicvc-application-salt-v1');
        
        const info = Buffer.concat([
            Buffer.from(connection.localVC?.credentialSubject.publicKeyHex || ''),
            Buffer.from(connection.remoteVC?.credentialSubject?.publicKeyHex || '')
        ]);
        
        const combined = Buffer.concat([salt, info]);
        const hash1 = createHash('sha256').update(combined).digest();
        const hash2 = createHash('sha256').update(hash1).digest();
        const keyMaterial = Buffer.concat([hash1, hash2]).slice(0, 192);
        
        return {
            encryptionKey: new Uint8Array(keyMaterial.slice(0, 32)),
            decryptionKey: new Uint8Array(keyMaterial.slice(32, 64)),
            sendIV: new Uint8Array(keyMaterial.slice(64, 80)),
            receiveIV: new Uint8Array(keyMaterial.slice(80, 96)),
            sendHMAC: new Uint8Array(keyMaterial.slice(96, 128)),
            receiveHMAC: new Uint8Array(keyMaterial.slice(128, 160))
        };
    }
    
    private generateChallenge(): string {
        return Buffer.from(tweetnacl.randomBytes(32)).toString('hex');
    }
    
    private generateUUID(): string {
        const bytes = tweetnacl.randomBytes(16);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        
        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20, 32)
        ].join('-');
    }
}

// Export factory function
export function createQuicVCTransport(): QuicTransport {
    return new QuicVCTransport();
}