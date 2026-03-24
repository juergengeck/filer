/**
 * HTTP REST API Server for one.provider
 *
 * Provides REST endpoints for connection management, contacts, and status.
 * Optional component that can be enabled via environment variables.
 */

import http from 'http';
import type {ConnectionHandler} from './connection-handler.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';

export class HttpRestServer {
    private server: http.Server | null = null;
    private connectionHandler: ConnectionHandler;
    private leuteModel: LeuteModel;
    private port: number;

    constructor(connectionHandler: ConnectionHandler, leuteModel: LeuteModel, port: number) {
        this.connectionHandler = connectionHandler;
        this.leuteModel = leuteModel;
        this.port = port;
    }

    /**
     * Start the HTTP server
     */
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                // CORS headers for browser access
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                try {
                    await this.handleRequest(req, res);
                } catch (error: any) {
                    console.error('[HttpRestServer] Request handling error:', error);
                    res.writeHead(500, {'Content-Type': 'application/json'});
                    res.end(JSON.stringify({error: error.message}));
                }
            });

            this.server.listen(this.port, () => {
                console.error(`[HttpRestServer] Listening on port ${this.port}`);
                resolve();
            });

            this.server.on('error', reject);
        });
    }

    /**
     * Stop the HTTP server
     */
    async stop(): Promise<void> {
        if (this.server) {
            return new Promise((resolve) => {
                this.server!.close(() => {
                    console.error('[HttpRestServer] Stopped');
                    resolve();
                });
            });
        }
    }

    /**
     * Handle incoming HTTP requests
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const url = req.url || '/';
        const method = req.method || 'GET';

        console.error(`[HttpRestServer] ${method} ${url}`);

        // Health check endpoint
        if (url === '/health') {
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({status: 'ok', service: 'one.provider'}));
            return;
        }

        // Status endpoint - returns instance info
        if (url === '/api/status' && method === 'GET') {
            const status = await this.connectionHandler.getStatus();
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(status));
            return;
        }

        // Create invitation endpoint
        if (url === '/api/connections/create-invite' && method === 'POST') {
            const result = await this.connectionHandler.createInvite();

            if (result.success && result.inviteUrl) {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({inviteUrl: result.inviteUrl}));
            } else {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: result.error || 'Failed to create invite'}));
            }
            return;
        }

        // Accept invitation and establish connection
        if (url === '/api/connections/invite' && method === 'POST') {
            const body = await this.readBody(req);
            const data = JSON.parse(body);

            // Parse invitation from URL or direct data
            let inviteData;
            if (data.inviteUrl) {
                const hashPart = data.inviteUrl.split('#')[1];
                const decoded = decodeURIComponent(hashPart);
                inviteData = JSON.parse(decoded);
            } else if (data.invitation) {
                inviteData = data.invitation;
            } else {
                res.writeHead(400, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Missing inviteUrl or invitation'}));
                return;
            }

            const result = await this.connectionHandler.connectWithInvite(inviteData);

            if (result.success && result.connectionInfo) {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({
                    personId: result.connectionInfo.personId,
                    instanceId: result.connectionInfo.remoteInstanceId,
                    connectionId: result.connectionInfo.remoteInstanceId,
                    contactCreated: result.connectionInfo.contactCreated
                }));
            } else {
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: result.error || 'Connection failed'}));
            }
            return;
        }

        // List active connections
        if (url === '/api/connections' && method === 'GET') {
            const result = await this.connectionHandler.listConnections();
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(result.connections || []));
            return;
        }

        // List contacts
        if (url === '/api/contacts' && method === 'GET') {
            const contacts = await this.leuteModel.others();
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify(contacts));
            return;
        }

        // 404 for unknown routes
        res.writeHead(404, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: 'Not found'}));
    }

    /**
     * Read request body as string
     */
    private async readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            req.on('end', () => {
                resolve(body);
            });
            req.on('error', reject);
        });
    }
}
