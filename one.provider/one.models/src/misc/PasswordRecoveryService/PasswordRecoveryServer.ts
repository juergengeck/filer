import type {ServerResponse} from 'http';
import http from 'http';
import type {IdentityWithSecrets} from '../IdentityExchange.js';
import {OEvent} from '../OEvent.js';
import type {RecoveryInformation} from './PasswordRecovery.js';
import {unpackRecoveryInformation} from './PasswordRecovery.js';
import {hexToUint8Array} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

export default class PasswordRecoveryServer {
    public onPasswordRecoveryRequest = new OEvent<(info: RecoveryInformation) => void>();

    private identity: IdentityWithSecrets;
    private server: http.Server | null = null;
    private readonly port: number;
    private readonly maxMessageCharCount: number;

    constructor(identity: IdentityWithSecrets, port: number, maxMessageCharCount = 10000) {
        this.identity = identity;
        this.port = port;
        this.maxMessageCharCount = maxMessageCharCount;
    }

    /**
     * Start the password recovery server
     */
    async start(): Promise<void> {
        if (this.server !== null) {
            throw new Error('Password recovery server is already started.');
        }

        return new Promise<void>((resolve, reject) => {
            const server = http.createServer(this.handleRequest.bind(this));

            server.on('error', err => {
                reject(err);
            });

            server.listen(this.port, () => {
                this.server = server;
                resolve();
            });
        });
    }

    /**
     * Stop the password recovery server
     */
    async stop(): Promise<void> {
        return new Promise<void>(resolve => {
            if (this.server) {
                this.server.close(err => {
                    if (err) {
                        console.error(err);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handles the REST request.
     *
     * @param req
     * @param res
     */
    private async handleRequest(req: http.IncomingMessage, res: ServerResponse): Promise<void> {
        // Password recovery route
        if (req.url === '/passwordRecoveryRequests') {
            if (req.method === 'POST') {
                try {
                    let buffer = '';
                    for await (const chunk of req) {
                        if (buffer.length > this.maxMessageCharCount) {
                            res.writeHead(500, {'Content-Type': 'application/json'});
                            res.write(JSON.stringify({message: 'Request is too long'}));
                            res.end();
                            return;
                        }
                        buffer += chunk;
                    }
                    const bundledRecoveryInformation = JSON.parse(buffer);
                    const recoveryInformation = unpackRecoveryInformation(
                        hexToUint8Array(this.identity.instanceKeySecret),
                        bundledRecoveryInformation
                    );
                    this.onPasswordRecoveryRequest.emit(recoveryInformation);
                    res.writeHead(201, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, OPTIONS',
                        'Access-Control-Allow-Headers': '*'
                    });
                } catch (e) {
                    console.log(e);
                    res.writeHead(500, {'Content-Type': 'application/json'});
                    res.write(JSON.stringify({message: e.toString()}));
                }

                res.end();
            } else if (req.method === 'OPTIONS') {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                });
                res.end();
            } else {
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({message: 'Method not supported'}));
            }
        }

        // If no route present
        else {
            res.writeHead(404, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({message: 'Route not found'}));
        }
    }
}
