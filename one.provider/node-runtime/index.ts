/**
 * one.provider - Apple File Provider IPC Bridge
 *
 * Provides JSON-RPC 2.0 server over stdin/stdout for Swift <-> Node.js communication.
 * Bridges Apple File Provider API to one.core/one.models IFileSystem.
 *
 * Follows the pattern from one.fuse3 and one.projfs: accept IFileSystem and delegate to it.
 */

import '@refinio/one.core/lib/system/load-nodejs.js';
import {initInstance, closeInstance} from '@refinio/one.core/lib/instance.js';
import {setBaseDirOrName} from '@refinio/one.core/lib/system/storage-base.js';
import {createInterface} from 'readline';
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem.js';
import {ConnectionHandler} from './connection-handler.js';
import {createLegacyRootFileSystem} from './createLegacyRootFileSystem.js';
import {HttpRestServer} from './http-server.js';
import {DebugLogger} from './debug-logger.js';

console.log = (...args: Parameters<typeof console.error>) => console.error(...args);
console.info = (...args: Parameters<typeof console.error>) => console.error(...args);
console.warn = (...args: Parameters<typeof console.error>) => console.error(...args);

// JSON-RPC 2.0 types
interface JSONRPCRequest {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id?: string | number;
}

interface JSONRPCResponse {
    jsonrpc: '2.0';
    result?: any;
    error?: JSONRPCError;
    id: string | number | null;
}

interface JSONRPCError {
    code: number;
    message: string;
    data?: any;
}

// JSON-RPC error codes
const ErrorCodes = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,
    NOT_INITIALIZED: -32000,
    FILE_NOT_FOUND: -32001,
    PERMISSION_DENIED: -32002,
    INVALID_PATH: -32003,
    IO_ERROR: -32004,
} as const;

/**
 * JSON-RPC IPC Bridge
 * Communicates with Swift via stdin/stdout using JSON-RPC 2.0
 */
class IPCBridge {
    private fileSystem: IFileSystem | null = null;
    private httpServer: HttpRestServer | null = null;
    private leuteModel: any = null;
    private instancePath: string | null = null;
    private connectionsModel: any = null;
    private readonly debugLogger: DebugLogger;
    private readonly readline = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    constructor() {
        // Initialize debug logger first
        this.debugLogger = new DebugLogger('ipc');

        this.debugLogger.info('=== IPC Bridge Starting ===');
        this.debugLogger.info(`Node version: ${process.version}`);
        this.debugLogger.info(`Platform: ${process.platform}`);
        this.debugLogger.info(`CWD: ${process.cwd()}`);
        this.debugLogger.info(`Process ID: ${process.pid}`);

        // Keep console.error for stderr capture by Swift
        console.error('[IPC] Starting IPC Bridge...');
        console.error('[IPC] Node version:', process.version);
        console.error('[IPC] Platform:', process.platform);
        console.error('[IPC] CWD:', process.cwd());

        this.readline.on('line', (line) => this.handleMessage(line));
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());

        console.error('[IPC] IPC Bridge ready, waiting for messages...');
        this.debugLogger.info('IPC Bridge ready, waiting for messages...');
    }

    /**
     * Handle incoming JSON-RPC message
     */
    private async handleMessage(line: string): Promise<void> {
        this.debugLogger.debug(`← Received message, length: ${line.length}`);
        console.error('[IPC] Received message, length:', line.length);
        let request: any;

        try {
            request = JSON.parse(line);
            this.debugLogger.debug(`← Parsed request: method=${request.method}, id=${request.id}`);
            console.error('[IPC] Parsed request, method:', request.method, 'id:', request.id);
        } catch (error) {
            console.error('[IPC] Parse error:', error);
            this.debugLogger.error(`Parse error: ${error}`);
            this.sendError(null, ErrorCodes.PARSE_ERROR, 'Parse error', error);
            return;
        }

        if (!this.isValidRequest(request)) {
            console.error('[IPC] Invalid request');
            this.debugLogger.error('Invalid request structure');
            this.sendError(request.id ?? null, ErrorCodes.INVALID_REQUEST, 'Invalid Request');
            return;
        }

        try {
            this.debugLogger.info(`→ Dispatching: ${request.method} (id: ${request.id})`);
            console.error('[IPC] Dispatching method:', request.method);
            const result = await this.dispatch(request.method, request.params);
            this.debugLogger.info(`✓ Completed: ${request.method} (id: ${request.id})`);
            console.error('[IPC] Method', request.method, 'completed successfully');
            this.sendResponse(request.id!, result);
        } catch (error: any) {
            const code = error.code ?? ErrorCodes.INTERNAL_ERROR;
            const message = error.message ?? 'Internal error';
            console.error('[IPC] Method', request.method, 'failed:', message);

            this.debugLogger.error(`✗ Failed: ${request.method} (id: ${request.id})`);
            this.debugLogger.error(`  Code: ${code}`);
            this.debugLogger.error(`  Message: ${message}`);
            this.debugLogger.error(`  Stack: ${error.stack || 'No stack trace'}`);

            this.sendError(request.id ?? null, code, message, error);
        }
    }

    /**
     * Validate JSON-RPC request structure
     */
    private isValidRequest(req: any): req is JSONRPCRequest {
        return (
            req &&
            req.jsonrpc === '2.0' &&
            typeof req.method === 'string' &&
            (req.id === undefined || typeof req.id === 'string' || typeof req.id === 'number')
        );
    }

    /**
     * Dispatch method call to appropriate handler
     */
    private async dispatch(method: string, params: any): Promise<any> {
        switch (method) {
            case 'initialize':
                return this.initialize(params);
            case 'stat':
                return this.stat(params);
            case 'readDir':
                return this.readDir(params);
            case 'readFile':
                return this.readFile(params);
            case 'readFileInChunks':
                return this.readFileInChunks(params);
            case 'createDir':
                return this.createDir(params);
            case 'createFile':
                return this.createFile(params);
            case 'unlink':
                return this.unlink(params);
            case 'rmdir':
                return this.rmdir(params);
            case 'rename':
                return this.rename(params);
            case 'writeFile':
                return this.writeFile(params);
            case 'getChanges':
                return this.getChanges(params);
            case 'getCurrentAnchor':
                return this.getCurrentAnchor(params);
            default:
                throw {code: ErrorCodes.METHOD_NOT_FOUND, message: `Method not found: ${method}`};
        }
    }

    /**
     * Initialize the file system
     * Uses the same initialization pattern as refinio.api
     *
     * IMPORTANT: Must receive the same owner credentials that created the instance,
     * otherwise it will calculate a different instance hash and fail.
     */
    private async initialize(params: {
        instancePath: string;
        email?: string;
        secret?: string;
        name?: string;
    }): Promise<{status: 'ok'}> {
        this.debugLogger.info('=== Initialize Started ===');

        if (!params?.instancePath) {
            this.debugLogger.error('Initialize failed: instancePath is required');
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'instancePath is required'};
        }

        // Store instance path
        this.instancePath = params.instancePath;
        this.debugLogger.info(`Instance path: ${params.instancePath}`);

        // Use provided credentials or fall back to environment variables
        const email = params.email || process.env.REFINIO_INSTANCE_EMAIL || 'fileprovider@local';
        const secret = params.secret || process.env.REFINIO_INSTANCE_SECRET || 'default-secret';
        const name = params.name || process.env.REFINIO_INSTANCE_NAME || 'file-provider';

        // DISABLED: setBaseDirOrName cannot handle paths with spaces (e.g., "Group Containers")
        // We rely on the 'directory' parameter in initInstance() instead
        // setBaseDirOrName(params.instancePath);

        // Import all recipes (same as refinio.api)
        const [coreRecipes, stableRecipes, experimentalRecipes, stableReverseMaps, experimentalReverseMaps] = await Promise.all([
            import('@refinio/one.core/lib/recipes.js'),
            import('@refinio/one.models/lib/recipes/recipes-stable.js'),
            import('@refinio/one.models/lib/recipes/recipes-experimental.js'),
            import('@refinio/one.models/lib/recipes/reversemaps-stable.js'),
            import('@refinio/one.models/lib/recipes/reversemaps-experimental.js')
        ]);

        const CORE_RECIPES = (coreRecipes as any).CORE_RECIPES || [];
        const RecipesStable = (stableRecipes as any).default || [];
        const RecipesExperimental = (experimentalRecipes as any).default || [];
        const ReverseMapsStable = (stableReverseMaps as any).ReverseMapsStable || new Map();
        const ReverseMapsExperimental = (experimentalReverseMaps as any).ReverseMapsExperimental || new Map();
        const ReverseMapsForIdObjectsStable = (stableReverseMaps as any).ReverseMapsForIdObjectsStable || new Map();
        const ReverseMapsForIdObjectsExperimental = (experimentalReverseMaps as any).ReverseMapsForIdObjectsExperimental || new Map();

        const reverseMaps = new Map([...ReverseMapsStable, ...ReverseMapsExperimental]);
        const reverseMapsForIdObjects = new Map([...ReverseMapsForIdObjectsStable, ...ReverseMapsForIdObjectsExperimental]);

        this.debugLogger.info('Initializing ONE.core instance...');
        this.debugLogger.debug(`  Name: ${name}`);
        this.debugLogger.debug(`  Email: ${email}`);

        // Initialize ONE.core instance (connect to existing instance with matching credentials)
        await initInstance({
            name,
            email,
            secret,
            ownerName: 'File Provider',
            directory: params.instancePath,
            encryptStorage: false,
            initialRecipes: [...CORE_RECIPES, ...RecipesStable, ...RecipesExperimental],
            initiallyEnabledReverseMapTypes: reverseMaps as any,
            initiallyEnabledReverseMapTypesForIdObjects: reverseMapsForIdObjects as any,
            wipeStorage: false
        });

        this.debugLogger.info('ONE.core instance initialized');

        // Initialize models (same pattern as refinio.api)
        this.debugLogger.info('Importing models...');
        const {LeuteModel, ChannelManager, ConnectionsModel} = await import('@refinio/one.models/lib/models/index.js');
        const {default: TopicModel} = await import('@refinio/one.models/lib/models/Chat/TopicModel.js');
        const {default: Notifications} = await import('@refinio/one.models/lib/models/Notifications.js');
        const {default: IoMManager} = await import('@refinio/one.models/lib/models/IoM/IoMManager.js');
        const {default: QuestionnaireModel} = await import('@refinio/one.models/lib/models/QuestionnaireModel.js');

        const commServerUrl = process.env.REFINIO_COMM_SERVER_URL || 'wss://comm10.dev.refinio.one';
        const leuteModel = new LeuteModel(commServerUrl, true);
        const channelManager = new ChannelManager(leuteModel);
        const topicModel = new TopicModel(channelManager, leuteModel);
        const notifications = new Notifications(channelManager);
        const iomManager = new IoMManager(leuteModel, commServerUrl);
        const enableQuestionnaires = process.env.ONE_PROVIDER_ENABLE_QUESTIONNAIRES === '1';
        const questionnaireModel = enableQuestionnaires
            ? new QuestionnaireModel(channelManager, leuteModel)
            : null;
        const journalModel = null as any; // Not needed for File Provider

        const connectionsModel = new ConnectionsModel(leuteModel, {
            commServerUrl,
            acceptIncomingConnections: true, // Enable incoming via CommServer relay
            acceptUnknownInstances: false,
            acceptUnknownPersons: false,
            allowPairing: true,
            allowDebugRequests: false,
            pairingTokenExpirationDuration: 3600000,
            establishOutgoingConnections: true, // Enable outgoing connections
            noImport: false,
            noExport: false
        });

        // Initialize all models
        this.debugLogger.info('Initializing models...');
        await leuteModel.init();
        this.debugLogger.debug('  LeuteModel initialized');
        await channelManager.init();
        this.debugLogger.debug('  ChannelManager initialized');
        await topicModel.init();
        this.debugLogger.debug('  TopicModel initialized');
        await iomManager.init();
        this.debugLogger.debug('  IoMManager initialized');
        if (questionnaireModel) {
            await questionnaireModel.init();
            this.debugLogger.debug('  QuestionnaireModel initialized');
        } else {
            this.debugLogger.info('Questionnaires disabled during initialize');
        }
        await connectionsModel.init();
        this.debugLogger.debug('  ConnectionsModel initialized');
        this.debugLogger.info('All models initialized');

        // Store models for HTTP server
        this.leuteModel = leuteModel;
        this.connectionsModel = connectionsModel;

        // Create the current filer projection behind a dedicated compatibility boundary.
        this.debugLogger.info('Creating filesystems...');
        const inviteUrlPrefix = process.env.ONE_PROVIDER_INVITE_URL_PREFIX || 'https://lama.one/invite';
        const {mountPoints, rootFileSystem} = await createLegacyRootFileSystem(
            {
                channelManager,
                connectionsModel,
                iomManager,
                leuteModel,
                notifications,
                questionnaireModel,
                topicModel
            },
            inviteUrlPrefix
        );
        console.error('[IPC] Mounting filesystems...');
        this.debugLogger.info('Mounting filesystems...');
        console.error(`[IPC] All filesystems mounted: ${mountPoints.join(', ')}`);
        this.debugLogger.info(`All filesystems mounted: ${mountPoints.join(', ')}`);

        this.fileSystem = rootFileSystem;

        // Optionally start HTTP REST API server
        const httpPort = process.env.ONE_PROVIDER_HTTP_PORT;
        if (httpPort) {
            console.error('[IPC] HTTP REST API enabled on port', httpPort);
            const inviteUrlPrefix = process.env.ONE_PROVIDER_INVITE_URL_PREFIX || 'https://lama.one/invite';
            const connectionHandler = new ConnectionHandler(leuteModel, connectionsModel, inviteUrlPrefix);
            this.httpServer = new HttpRestServer(connectionHandler, leuteModel, parseInt(httpPort, 10));

            try {
                await this.httpServer.start();
                console.error('[IPC] HTTP REST API started successfully');
            } catch (error) {
                console.error('[IPC] Failed to start HTTP REST API:', error);
                this.httpServer = null;
            }
        } else {
            console.error('[IPC] HTTP REST API disabled (set ONE_PROVIDER_HTTP_PORT to enable)');
        }

        // Wait for invite files to be created (ConnectionsModel creates them asynchronously)
        console.error('[IPC] Waiting for invite files to be created...');
        const maxAttempts = 50; // 50 * 200ms = 10 seconds max
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const result = await this.fileSystem.readDir('/invites');
                if (result.children && result.children.length > 0) {
                    console.error(`[IPC] Invite files ready after ${attempt * 200}ms: ${result.children.join(', ')}`);
                    break;
                }
            } catch (error) {
                console.error(`[IPC] Error checking invites (attempt ${attempt}):`, error);
            }

            if (attempt === maxAttempts - 1) {
                console.error('[IPC] WARNING: Invite files not created after 10 seconds');
            }

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (process.env.ONE_PROVIDER_VALIDATE_INVITES_ON_INIT === '1') {
            // Deep invite validation forces PairingManager to bring up its listener, which can make
            // startup network-bound. Keep it opt-in for diagnostics.
            console.error('[IPC] Validating invite creation...');
            try {
                const testInvite = await this.fileSystem!.readFile('/invites/iop_invite.txt');
                const inviteText = new TextDecoder().decode(new Uint8Array(testInvite.content));
                console.error(`[IPC] ✅ Invite created successfully (${testInvite.content.byteLength} bytes)`);
                console.error(`[IPC]    URL prefix: ${inviteText.substring(0, 50)}...`);

                if (!inviteText.includes('invite#')) {
                    throw new Error('Invite URL malformed - missing hash separator');
                }

                const hashIndex = inviteText.indexOf('#');
                if (hashIndex > 0) {
                    const encodedJson = inviteText.substring(hashIndex + 1);
                    const decodedJson = decodeURIComponent(encodedJson);
                    const invitation = JSON.parse(decodedJson);
                    console.error('[IPC] ✅ Invite structure valid:');
                    console.error(`[IPC]    - Token: ${invitation.token?.substring(0, 16)}... (${invitation.token?.length} chars)`);
                    console.error(`[IPC]    - PublicKey: ${invitation.publicKey?.substring(0, 32)}... (${invitation.publicKey?.length} chars)`);
                    console.error(`[IPC]    - Connection URL: ${invitation.url}`);
                }
            } catch (error) {
                console.error(`[IPC] ❌ ERROR: Failed to validate invite: ${error}`);
                this.debugLogger.error(`Failed to validate invite: ${error}`);
                throw new Error(`Invite validation failed: ${error}`);
            }
        } else {
            console.error('[IPC] Skipping deep invite validation during initialize');
        }

        this.debugLogger.info('=== Initialize Completed Successfully ===');
        return {status: 'ok'};
    }

    /**
     * Get file/directory stats
     */
    private async stat(params: {path: string}): Promise<{mode: number; size: number}> {
        this.assertInitialized();
        if (!params?.path) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path is required'};
        }

        const stats = await this.fileSystem!.stat(params.path);
        return {mode: stats.mode, size: stats.size};
    }

    /**
     * Read directory contents
     */
    private async readDir(params: {path: string}): Promise<{children: string[]}> {
        this.assertInitialized();
        if (!params?.path) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path is required'};
        }

        this.debugLogger.debug(`readDir called with path: "${params.path}"`);

        const result = await this.fileSystem!.readDir(params.path);

        this.debugLogger.debug(`readDir result for "${params.path}": ${result.children.length} children`);
        this.debugLogger.debug(`readDir children: ${JSON.stringify(result.children)}`);

        return {children: result.children};
    }

    /**
     * Read file contents
     */
    private async readFile(params: {path: string}): Promise<{content: string}> {
        this.assertInitialized();
        if (!params?.path) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path is required'};
        }

        const result = await this.fileSystem!.readFile(params.path);
        const buffer = Buffer.from(result.content);
        return {content: buffer.toString('base64')};
    }

    /**
     * Read file in chunks
     */
    private async readFileInChunks(params: {path: string; length: number; position: number}): Promise<{content: string}> {
        this.assertInitialized();
        if (!params?.path || params.length === undefined || params.position === undefined) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path, length, and position are required'};
        }

        const result = await this.fileSystem!.readFileInChunks(params.path, params.length, params.position);
        const buffer = Buffer.from(result.content);
        return {content: buffer.toString('base64')};
    }

    /**
     * Create directory
     */
    private async createDir(params: {path: string; mode: number}): Promise<{status: 'ok'}> {
        this.assertInitialized();
        if (!params?.path || params.mode === undefined) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path and mode are required'};
        }

        await this.fileSystem!.createDir(params.path, params.mode);
        return {status: 'ok'};
    }

    /**
     * Create file
     */
    private async createFile(params: {path: string; fileHash: string; fileName: string; mode: number}): Promise<{status: 'ok'}> {
        this.assertInitialized();
        if (!params?.path || !params.fileHash || !params.fileName || params.mode === undefined) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path, fileHash, fileName, and mode are required'};
        }

        await this.fileSystem!.createFile(params.path, params.fileHash as any, params.fileName, params.mode);
        return {status: 'ok'};
    }

    /**
     * Delete file
     */
    private async unlink(params: {path: string}): Promise<{result: number}> {
        this.assertInitialized();
        if (!params?.path) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path is required'};
        }

        const result = await this.fileSystem!.unlink(params.path);
        return {result};
    }

    /**
     * Remove directory
     */
    private async rmdir(params: {path: string}): Promise<{result: number}> {
        this.assertInitialized();
        if (!params?.path) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'path is required'};
        }

        const result = await this.fileSystem!.rmdir(params.path);
        return {result};
    }

    /**
     * Rename file/directory
     */
    private async rename(params: {src: string; dest: string}): Promise<{result: number}> {
        this.assertInitialized();
        if (!params?.src || !params?.dest) {
            throw {code: ErrorCodes.INVALID_PARAMS, message: 'src and dest are required'};
        }

        const result = await this.fileSystem!.rename(params.src, params.dest);
        return {result};
    }

    /**
     * Write file contents (not implemented in IFileSystem)
     */
    private async writeFile(params: {path: string; content: string}): Promise<{status: 'ok'}> {
        throw {code: ErrorCodes.INTERNAL_ERROR, message: 'writeFile not implemented in IFileSystem'};
    }

    /**
     * Get changes since anchor (not implemented yet)
     */
    private async getChanges(params: {since: string}): Promise<{
        updated: Array<{id: string; name: string; type: string; size: number; modified: number}>;
        deleted: string[];
        newAnchor: string;
    }> {
        this.assertInitialized();
        return {updated: [], deleted: [], newAnchor: Date.now().toString()};
    }

    /**
     * Get current sync anchor
     */
    private async getCurrentAnchor(params: {}): Promise<{anchor: string}> {
        this.assertInitialized();
        return {anchor: Date.now().toString()};
    }

    /**
     * Assert file system is initialized
     */
    private assertInitialized(): void {
        if (!this.fileSystem) {
            throw {code: ErrorCodes.NOT_INITIALIZED, message: 'FileSystem not initialized. Call initialize() first.'};
        }
    }

    /**
     * Send successful JSON-RPC response
     */
    private sendResponse(id: string | number, result: any): void {
        const response: JSONRPCResponse = {jsonrpc: '2.0', result, id};
        process.stdout.write(`${JSON.stringify(response)}\n`);
    }

    /**
     * Send JSON-RPC error response
     */
    private sendError(id: string | number | null, code: number, message: string, data?: any): void {
        const response: JSONRPCResponse = {
            jsonrpc: '2.0',
            error: {code, message, data},
            id
        };
        process.stdout.write(`${JSON.stringify(response)}\n`);
    }

    /**
     * Shutdown gracefully
     */
    private async shutdown(): Promise<void> {
        console.error('[IPC] Shutting down...');
        this.debugLogger.info('=== Shutdown Started ===');

        // Stop HTTP server if running
        if (this.httpServer) {
            try {
                this.debugLogger.info('Stopping HTTP server...');
                await this.httpServer.stop();
                this.debugLogger.info('HTTP server stopped');
            } catch (error) {
                console.error('[IPC] Error stopping HTTP server:', error);
                this.debugLogger.error(`Error stopping HTTP server: ${error}`);
            }
        }

        // Close ONE instance
        this.debugLogger.info('Closing ONE instance...');
        await closeInstance();
        this.debugLogger.info('ONE instance closed');
        this.readline.close();
        this.debugLogger.info('=== Shutdown Completed ===');
        process.exit(0);
    }
}

// Start IPC bridge
new IPCBridge();
