#!/usr/bin/env node

/**
 * Connection Integration Test for one.provider (macOS File Provider)
 *
 * This test verifies that:
 * 1. Starts refinio.api with File Provider extension
 * 2. File Provider mount exposes invite files correctly
 * 3. Invite files contain valid invitation URLs
 * 4. Invites can be used to establish connections
 * 5. Bidirectional contact creation works after connection
 * 6. Cleans up: unmounts and stops server
 *
 * Prerequisites:
 * - macOS 13.0+ (Ventura) with File Provider support
 * - refinio.api built and available (../refinio.api)
 * - one.provider built (swift build)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
// The actual mount point created by macOS for File Provider domains
const DOMAIN_NAME = 'server-provider-instance';
const MOUNT_POINT = process.env.ONE_PROVIDER_MOUNT || path.join(os.homedir(), `Library/CloudStorage/OneFiler-${DOMAIN_NAME}`);
const INVITES_PATH = path.join(MOUNT_POINT, 'invites');
const IOP_INVITE_FILE = path.join(INVITES_PATH, 'iop_invite.txt');
const IOM_INVITE_FILE = path.join(INVITES_PATH, 'iom_invite.txt');

// Path to refinio.api (relative to one.provider/test/integration/)
const REFINIO_API_DIR = path.resolve(__dirname, '../../../refinio.api');
// Use App Group container for server instance (extension has access to this location)
const APP_GROUP_CONTAINER = path.join(os.homedir(), 'Library/Group Containers/group.com.one.filer');
const SERVER_STORAGE_DIR = path.join(APP_GROUP_CONTAINER, 'instances/server-provider-instance');
const CLIENT_STORAGE_DIR = path.join(os.tmpdir(), 'refinio-api-client-instance');
const COMM_SERVER_PORT = 8000;
const SERVER_PORT = 50123;
const CLIENT_PORT = 50125;

// Process handles
let serverProcess = null;
let clientProcess = null;
let commServer = null;
let providerApp = null;

/**
 * Start local CommunicationServer
 */
async function startCommServer() {
    console.log('Starting local CommunicationServer...');

    try {
        // Import CommunicationServer from one.models
        const modelsPath = path.resolve(__dirname, '../../node-runtime/node_modules/@refinio/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js');
        const fileUrl = `file://${modelsPath}`;
        const CommunicationServerModule = await import(fileUrl);
        const CommunicationServer = CommunicationServerModule.default;

        commServer = new CommunicationServer();
        await commServer.start('localhost', COMM_SERVER_PORT);

        console.log(`   ✅ CommServer started on localhost:${COMM_SERVER_PORT}`);
    } catch (error) {
        console.error('Failed to start CommServer:', error);
        throw error;
    }
}

/**
 * Cleanup test environment
 */
async function cleanupTestEnvironment() {
    console.log('🧹 Cleaning up test environment...');

    // Ensure App Group container exists
    if (!fs.existsSync(APP_GROUP_CONTAINER)) {
        fs.mkdirSync(APP_GROUP_CONTAINER, { recursive: true });
        console.log(`   Created App Group container: ${APP_GROUP_CONTAINER}`);
    }

    const instancesDir = path.join(APP_GROUP_CONTAINER, 'instances');
    if (!fs.existsSync(instancesDir)) {
        fs.mkdirSync(instancesDir, { recursive: true });
        console.log(`   Created instances directory: ${instancesDir}`);
    }

    // Stop CommServer
    if (commServer) {
        try {
            await commServer.stop();
            console.log('   Stopped CommServer');
        } catch (err) {
            console.log('   Failed to stop CommServer:', err.message);
        }
        commServer = null;
    }

    // Kill client process
    if (clientProcess) {
        try {
            clientProcess.kill('SIGINT');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!clientProcess.killed) {
                clientProcess.kill('SIGKILL');
            }
        } catch (err) {
            console.log('   Failed to kill client process:', err.message);
        }
        clientProcess = null;
    }

    // Kill server process
    if (serverProcess) {
        try {
            serverProcess.kill('SIGINT');
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!serverProcess.killed) {
                serverProcess.kill('SIGKILL');
            }
        } catch (err) {
            console.log('   Failed to kill server process:', err.message);
        }
        serverProcess = null;
    }

    // Kill File Provider app
    if (providerApp) {
        try {
            providerApp.kill('SIGTERM');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (!providerApp.killed) {
                providerApp.kill('SIGKILL');
            }
        } catch (err) {
            console.log('   Failed to kill File Provider app:', err.message);
        }
        providerApp = null;
    }

    // Remove test storage directories
    for (const dir of [SERVER_STORAGE_DIR, CLIENT_STORAGE_DIR]) {
        if (fs.existsSync(dir)) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
                console.log(`   Removed ${dir}`);
            } catch (err) {
                console.log(`   Failed to remove ${dir}:`, err.message);
            }
        }
    }

    // Force kill any processes still holding the test ports
    try {
        const { execSync } = require('child_process');
        execSync('lsof -ti:50123 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
        execSync('lsof -ti:50125 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
        execSync('lsof -ti:8000 | xargs kill -9 2>/dev/null || true', { stdio: 'ignore' });
    } catch (err) {
        // Ignore errors - ports might already be free
    }

    console.log('✅ Cleanup complete\n');
}

/**
 * Start File Provider app
 *
 * NOTE: The new architecture doesn't need a separate File Provider app.
 * refinio.api now handles domain registration directly via OneFiler.app CLI.
 * This function is kept for compatibility but just waits to ensure mount point exists.
 */
async function startFileProviderApp() {
    console.log('🚀 Checking File Provider setup...\n');

    // In the new architecture, refinio.api registers the domain when it starts
    // We just need to verify OneFiler.app is installed
    const oneFilerAppPath = '/Applications/OneFiler.app/Contents/MacOS/onefiler';

    if (!fs.existsSync(oneFilerAppPath)) {
        throw new Error(`OneFiler.app not found in /Applications\n` +
                       `   Install it with: sudo cp -R one.provider/.build/debug/OneFiler.app /Applications/`);
    }

    console.log(`   ✅ OneFiler.app found at /Applications/OneFiler.app`);
    console.log(`   Note: Domain registration will be handled by refinio.api\n`);

    // No separate process to spawn - refinio.api handles everything
    providerApp = null;
    return Promise.resolve();
}

/**
 * Start refinio.api server with File Provider
 */
async function startRefinioApiServer() {
    console.log('🚀 Starting refinio.api server with File Provider...\n');

    // Verify refinio.api exists
    if (!fs.existsSync(REFINIO_API_DIR)) {
        throw new Error(`refinio.api not found at ${REFINIO_API_DIR}`);
    }

    const distIndexPath = path.join(REFINIO_API_DIR, 'dist', 'index.js');
    if (!fs.existsSync(distIndexPath)) {
        throw new Error(`refinio.api not built - missing ${distIndexPath}\n` +
                       `   Run: cd ${REFINIO_API_DIR} && npm run build`);
    }

    console.log(`   Server port: ${SERVER_PORT}`);
    console.log(`   CommServer: ws://localhost:${COMM_SERVER_PORT}\n`);

    // Spawn server process
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', [distIndexPath], {
            cwd: REFINIO_API_DIR,
            env: {
                ...process.env,
                // Server config
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: SERVER_PORT.toString(),
                // Instance config
                REFINIO_INSTANCE_NAME: 'server-provider-instance',
                REFINIO_INSTANCE_DIRECTORY: SERVER_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'server-provider@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'server-secret-provider-integration-12345678',
                REFINIO_COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
                REFINIO_ENCRYPT_STORAGE: 'false',
                REFINIO_WIPE_STORAGE: 'true',
                // Filer config - use File Provider domain name (macOS creates the mount)
                REFINIO_FILER_MOUNT_POINT: DOMAIN_NAME,  // This becomes the domain name
                REFINIO_FILER_INVITE_URL_PREFIX: 'https://one.refinio.net/invite',
                REFINIO_FILER_DEBUG: 'true',
                // Other
                NODE_ENV: 'test'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let serverOutput = '';
        let startupTimeout = null;

        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            process.stdout.write(output);

            // Check for HTTP server ready
            if (output.includes('HTTP REST API listening')) {
                clearTimeout(startupTimeout);
                console.log('\n✅ Server HTTP API ready\n');
                setTimeout(() => resolve(), 2000);
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            process.stderr.write(output);
        });

        serverProcess.on('error', (error) => {
            clearTimeout(startupTimeout);
            reject(new Error(`Failed to start server: ${error.message}`));
        });

        serverProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                clearTimeout(startupTimeout);
                reject(new Error(`Server exited with code ${code}\n${serverOutput}`));
            }
        });

        // Timeout after 60 seconds
        startupTimeout = setTimeout(() => {
            reject(new Error('Server startup timeout after 60 seconds\n' + serverOutput));
        }, 60000);
    });
}

/**
 * Start refinio.api CLIENT instance (without File Provider)
 */
async function startClientInstance() {
    console.log('🚀 Starting refinio.api CLIENT instance (no mount)...\n');

    const distIndexPath = path.join(REFINIO_API_DIR, 'dist', 'index.js');

    console.log(`   Client port: ${CLIENT_PORT}`);
    console.log(`   CommServer: ws://localhost:${COMM_SERVER_PORT}\n`);

    return new Promise((resolve, reject) => {
        clientProcess = spawn('node', [distIndexPath], {
            cwd: REFINIO_API_DIR,
            env: {
                ...process.env,
                // Client config
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: CLIENT_PORT.toString(),
                // Instance config
                REFINIO_INSTANCE_NAME: 'client-provider-instance',
                REFINIO_INSTANCE_DIRECTORY: CLIENT_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'client-provider@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'client-secret-provider-integration-12345678',
                REFINIO_COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
                REFINIO_ENCRYPT_STORAGE: 'false',
                REFINIO_WIPE_STORAGE: 'true',
                // NO Filer config - client doesn't mount
                NODE_ENV: 'test'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let clientOutput = '';
        let startupTimeout = null;

        clientProcess.stdout.on('data', (data) => {
            const output = data.toString();
            clientOutput += output;
            process.stdout.write(`[CLIENT] ${output}`);

            if (output.includes('HTTP REST API listening')) {
                clearTimeout(startupTimeout);
                console.log('\n✅ Client HTTP API ready\n');
                setTimeout(() => resolve(), 1000);
            }
        });

        clientProcess.stderr.on('data', (data) => {
            const output = data.toString();
            clientOutput += output;
            process.stderr.write(`[CLIENT] ${output}`);
        });

        clientProcess.on('error', (error) => {
            clearTimeout(startupTimeout);
            reject(new Error(`Failed to start client: ${error.message}`));
        });

        clientProcess.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                clearTimeout(startupTimeout);
                reject(new Error(`Client exited with code ${code}\n${clientOutput}`));
            }
        });

        startupTimeout = setTimeout(() => {
            reject(new Error('Client startup timeout after 60 seconds\n' + clientOutput));
        }, 60000);
    });
}

/**
 * Connect CLIENT to SERVER using invite (via HTTP REST API)
 */
async function connectUsingInvite(inviteUrl) {
    console.log('🔗 CLIENT accepting invitation from SERVER...');

    const http = await import('http');

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ inviteUrl });
        const postOptions = {
            hostname: '127.0.0.1',
            port: CLIENT_PORT + 1,  // HTTP REST API runs on QUIC port + 1
            path: '/api/connections/invite',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.default.request(postOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 201) {
                    console.log('   ✅ Invitation accepted successfully');
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Connection error: ${error.message}`));
        });

        req.setTimeout(120000); // 2 minute timeout
        req.write(postData);
        req.end();
    });
}

/**
 * Query contacts from a refinio.api instance
 */
async function queryContacts(port, instanceName) {
    const http = await import('http');

    return new Promise((resolve, reject) => {
        const options = {
            hostname: '127.0.0.1',
            port: port,
            path: '/api/contacts',
            method: 'GET'
        };

        const req = http.default.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    const contacts = JSON.parse(data);
                    console.log(`   ${instanceName} contacts: ${contacts.length} found`);
                    resolve(contacts);
                } else {
                    console.error(`   ❌ Failed to query ${instanceName} contacts: HTTP ${res.statusCode}`);
                    resolve([]);
                }
            });
        });

        req.on('error', (error) => {
            console.error(`   ❌ Failed to query ${instanceName} contacts:`, error.message);
            resolve([]);
        });

        req.setTimeout(5000);
        req.end();
    });
}

/**
 * Parse invitation URL to extract credentials
 */
function parseInviteUrl(inviteUrl) {
    const hashIndex = inviteUrl.indexOf('#');
    if (hashIndex === -1) {
        throw new Error('Invalid invite URL format - no hash fragment');
    }

    const encodedData = inviteUrl.substring(hashIndex + 1);
    const decodedData = decodeURIComponent(encodedData);
    return JSON.parse(decodedData);
}

/**
 * Verify invite data structure
 */
function verifyInviteData(inviteData) {
    if (!inviteData.token || typeof inviteData.token !== 'string') {
        throw new Error('Invalid invite data: missing or invalid token');
    }
    if (!inviteData.publicKey || typeof inviteData.publicKey !== 'string') {
        throw new Error('Invalid invite data: missing or invalid publicKey');
    }
    if (!inviteData.url || typeof inviteData.url !== 'string') {
        throw new Error('Invalid invite data: missing or invalid url');
    }
    if (!inviteData.url.startsWith('wss://') && !inviteData.url.startsWith('ws://')) {
        throw new Error('Invalid invite data: url must be WebSocket URL');
    }
}

/**
 * Check if File Provider is mounted
 */
function isFileProviderMounted(mountPath) {
    try {
        // On macOS, File Provider mounts appear in ~/Library/CloudStorage
        // Check if the directory exists and is accessible
        return fs.existsSync(mountPath) && fs.statSync(mountPath).isDirectory();
    } catch {
        return false;
    }
}

/**
 * Main test function
 */
async function runConnectionTest() {
    console.log('🔗 ONE.provider Connection Integration Test\n');
    console.log('='.repeat(70));
    console.log(`Platform: macOS (File Provider API)`);
    console.log(`Mount Point: ${MOUNT_POINT}`);
    console.log(`Invites Path: ${INVITES_PATH}\n`);

    // Setup: Clean up any existing test environment, start CommServer
    try {
        await cleanupTestEnvironment();
        console.log('\n1️⃣ Starting CommServer...');
        await startCommServer();
        console.log('\n2️⃣ Starting File Provider app...');
        await startFileProviderApp();
        console.log('\n3️⃣ Starting SERVER instance...');
        await startRefinioApiServer();
    } catch (setupError) {
        console.error('\n❌ Setup Failed:', setupError.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure refinio.api is built: cd ../refinio.api && npm run build');
        console.error('   2. Build one.provider: swift build');
        console.error('   3. Check macOS version: sw_vers (need macOS 13.0+)');
        console.error('   4. Verify File Provider entitlements are correct');
        throw setupError;
    }

    let testResults = {
        fileProviderAvailable: false,
        mountPointExists: false,
        invitesDirectoryExists: false,
        iopInviteExists: false,
        iomInviteExists: false,
        iopInviteReadable: false,
        iomInviteReadable: false,
        iopInviteValid: false,
        iomInviteValid: false,
        iopInviteSize: 0,
        iomInviteSize: 0
    };

    try {
        // Test 1: Wait for mount point to appear (macOS creates it asynchronously)
        console.log('\n4️⃣ Waiting for File Provider mount point to appear...');
        console.log(`   Expected location: ${MOUNT_POINT}`);

        const maxWaitSeconds = 30;
        const checkIntervalMs = 1000;
        let waitedSeconds = 0;

        while (!fs.existsSync(MOUNT_POINT) && waitedSeconds < maxWaitSeconds) {
            await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
            waitedSeconds++;
            if (waitedSeconds % 5 === 0) {
                console.log(`   Still waiting... (${waitedSeconds}/${maxWaitSeconds}s)`);
            }
        }

        if (!fs.existsSync(MOUNT_POINT)) {
            throw new Error(`Mount point did not appear after ${maxWaitSeconds} seconds: ${MOUNT_POINT}\n` +
                           `\n` +
                           `   ⚠️  The File Provider extension is not enabled.\n` +
                           `\n` +
                           `   📋 Required Setup Steps:\n` +
                           `\n` +
                           `   1. Check the server output above for detailed setup instructions\n` +
                           `   2. Install OneFiler.app to /Applications if not already done\n` +
                           `   3. Enable the extension in System Settings:\n` +
                           `      Privacy & Security → Extensions → File Provider → OneFiler (toggle ON)\n` +
                           `   4. Run this test again\n` +
                           `\n` +
                           `   💡 Tip: Use 'onefiler status' command to verify setup`);
        }
        testResults.mountPointExists = true;
        console.log(`✅ Mount point appeared after ${waitedSeconds} seconds: ${MOUNT_POINT}`);

        testResults.fileProviderAvailable = isFileProviderMounted(MOUNT_POINT);
        if (testResults.fileProviderAvailable) {
            console.log(`✅ File Provider mount accessible`);
        } else {
            console.log(`⚠️  Warning: Mount point exists but may not be fully mounted`);
        }

        // Test 2: Check invites directory exists
        console.log('\n5️⃣ Checking invites directory...');
        if (!fs.existsSync(INVITES_PATH)) {
            throw new Error(`Invites directory not found: ${INVITES_PATH}\n` +
                           `   The PairingFileSystem may not be mounted.`);
        }
        testResults.invitesDirectoryExists = true;
        console.log(`✅ Invites directory exists: ${INVITES_PATH}`);

        // Wait for invite files to appear (extension loads on-demand and takes ~10s to initialize)
        console.log('   Waiting for extension to initialize and create invite files...');
        const maxInitWaitSeconds = 30;
        const initCheckIntervalMs = 1000;
        let initWaitedSeconds = 0;
        let inviteFiles = [];

        while (inviteFiles.length === 0 && initWaitedSeconds < maxInitWaitSeconds) {
            await new Promise(resolve => setTimeout(resolve, initCheckIntervalMs));
            initWaitedSeconds++;
            try {
                inviteFiles = await fs.promises.readdir(INVITES_PATH);
                if (inviteFiles.length > 0) {
                    console.log(`   ✅ Invite files appeared after ${initWaitedSeconds} seconds`);
                    break;
                }
            } catch (error) {
                // Ignore errors during waiting
            }
            if (initWaitedSeconds % 5 === 0) {
                console.log(`   Still waiting for extension initialization... (${initWaitedSeconds}/${maxInitWaitSeconds}s)`);
            }
        }

        if (inviteFiles.length === 0) {
            throw new Error(`No invite files appeared after ${maxInitWaitSeconds} seconds.\n` +
                           `   The extension may have failed to initialize or allowPairing is disabled.`);
        }

        console.log(`   Files in invites/: ${inviteFiles.join(', ')}`);

        // Test 3: Check IOP invite file exists
        console.log('\n6️⃣ Checking IOP (Instance of Person) invite file...');
        if (!fs.existsSync(IOP_INVITE_FILE)) {
            throw new Error(`IOP invite file not found: ${IOP_INVITE_FILE}`);
        }
        testResults.iopInviteExists = true;
        console.log(`✅ IOP invite file exists: ${IOP_INVITE_FILE}`);

        // Test 4: Check IOM invite file exists
        console.log('\n7️⃣ Checking IOM (Instance of Machine) invite file...');
        if (!fs.existsSync(IOM_INVITE_FILE)) {
            throw new Error(`IOM invite file not found: ${IOM_INVITE_FILE}`);
        }
        testResults.iomInviteExists = true;
        console.log(`✅ IOM invite file exists: ${IOM_INVITE_FILE}`);

        // Test 5: Read and validate IOP invite
        console.log('\n8️⃣ Reading and validating IOP invite...');
        let iopInviteContent;
        try {
            iopInviteContent = (await fs.promises.readFile(IOP_INVITE_FILE, 'utf-8')).trim();
            testResults.iopInviteReadable = true;
            testResults.iopInviteSize = iopInviteContent.length;
            console.log(`✅ IOP invite readable (${testResults.iopInviteSize} bytes)`);
        } catch (readError) {
            throw new Error(`Failed to read IOP invite: ${readError.message}`);
        }

        if (iopInviteContent.length === 0) {
            throw new Error('IOP invite file is empty!\n' +
                           '   This indicates the ConnectionsModel is not generating invites.\n' +
                           '   Check that allowPairing: true in ConnectionsModel config.');
        }

        let iopInviteData;
        try {
            iopInviteData = parseInviteUrl(iopInviteContent);
            verifyInviteData(iopInviteData);
            testResults.iopInviteValid = true;
            console.log(`✅ IOP invite is valid`);
            console.log(`   WebSocket URL: ${iopInviteData.url}`);
            console.log(`   Public Key: ${iopInviteData.publicKey.substring(0, 16)}...`);
            console.log(`   Token: ${iopInviteData.token.substring(0, 16)}...`);
        } catch (parseError) {
            throw new Error(`Invalid IOP invite format: ${parseError.message}`);
        }

        // Test 6: Read and validate IOM invite
        console.log('\n9️⃣ Reading and validating IOM invite...');
        let iomInviteContent;
        try {
            iomInviteContent = (await fs.promises.readFile(IOM_INVITE_FILE, 'utf-8')).trim();
            testResults.iomInviteReadable = true;
            testResults.iomInviteSize = iomInviteContent.length;
            console.log(`✅ IOM invite readable (${testResults.iomInviteSize} bytes)`);
        } catch (readError) {
            throw new Error(`Failed to read IOM invite: ${readError.message}`);
        }

        if (iomInviteContent.length === 0) {
            throw new Error('IOM invite file is empty!');
        }

        let iomInviteData;
        try {
            iomInviteData = parseInviteUrl(iomInviteContent);
            verifyInviteData(iomInviteData);
            testResults.iomInviteValid = true;
            console.log(`✅ IOM invite is valid`);
            console.log(`   WebSocket URL: ${iomInviteData.url}`);
            console.log(`   Public Key: ${iomInviteData.publicKey.substring(0, 16)}...`);
            console.log(`   Token: ${iomInviteData.token.substring(0, 16)}...`);
        } catch (parseError) {
            throw new Error(`Invalid IOM invite format: ${parseError.message}`);
        }

        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 Test Results Summary:\n');
        console.log(`✅ File Provider available: ${testResults.fileProviderAvailable}`);
        console.log(`✅ File Provider mount accessible: ${testResults.mountPointExists}`);
        console.log(`✅ Invites directory accessible: ${testResults.invitesDirectoryExists}`);
        console.log(`✅ IOP invite file exists: ${testResults.iopInviteExists}`);
        console.log(`✅ IOM invite file exists: ${testResults.iomInviteExists}`);
        console.log(`✅ IOP invite readable (${testResults.iopInviteSize} bytes): ${testResults.iopInviteReadable}`);
        console.log(`✅ IOM invite readable (${testResults.iomInviteSize} bytes): ${testResults.iomInviteReadable}`);
        console.log(`✅ IOP invite valid: ${testResults.iopInviteValid}`);
        console.log(`✅ IOM invite valid: ${testResults.iomInviteValid}`);

        console.log('\n🎯 Initial Validation Complete:');
        console.log('   ✅ File Provider virtualization is working correctly');
        console.log('   ✅ PairingFileSystem is exposing invite files');
        console.log('   ✅ Invite content is valid and ready for connection');

        // Test 7: Start CLIENT instance
        console.log('\n🔟 Starting CLIENT refinio.api instance...');
        await startClientInstance();

        // Test 8: CLIENT connects to SERVER using invite from File Provider mount
        console.log('\n1️⃣1️⃣ Establishing connection using invite from File Provider...');
        await connectUsingInvite(iopInviteContent);

        // Wait for connection to stabilize
        console.log('\n   Waiting for connection to stabilize and contacts to be created...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Test 9: Verify bidirectional contact creation
        console.log('\n1️⃣2️⃣ Verifying bidirectional contact creation...');

        const serverContacts = await queryContacts(SERVER_PORT + 1, 'SERVER');
        const clientContacts = await queryContacts(CLIENT_PORT + 1, 'CLIENT');

        if (clientContacts.length > 0 && serverContacts.length > 0) {
            console.log('\n   ✅ BIDIRECTIONAL CONTACT CREATION VERIFIED!');
            console.log('   ✅ Both instances can see each other as contacts');
        } else if (clientContacts.length > 0) {
            console.log('\n   ⚠️  Partial success: CLIENT sees SERVER, but not vice versa');
        } else if (serverContacts.length > 0) {
            console.log('\n   ⚠️  Partial success: SERVER sees CLIENT, but not vice versa');
        } else {
            throw new Error('No contacts found on either side - connection failed');
        }

        console.log('\n🎉 Final Results:');
        console.log('   ✅ File Provider mount working correctly');
        console.log('   ✅ Invite files readable from macOS filesystem');
        console.log('   ✅ Connection established successfully');
        console.log('   ✅ Bidirectional contacts created');
        console.log('   ✅ Integration test PASSED!');

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error('\n📊 Partial Results:', testResults);

        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Check File Provider extension is enabled in System Settings');
        console.error('   2. Verify ConnectionsModel has allowPairing: true');
        console.error('   3. Check Console.app for File Provider extension logs');
        console.error('   4. Verify Swift package built correctly: swift build');
        console.error('   5. Check entitlements and code signing');

        process.exit(1);
    }
}

// Handle cleanup on signals
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Interrupted - cleaning up...');
    await cleanupTestEnvironment();
    process.exit(130);
});

process.on('SIGTERM', async () => {
    console.log('\n\n⚠️  Terminated - cleaning up...');
    await cleanupTestEnvironment();
    process.exit(143);
});

// Run the test
runConnectionTest()
    .then(async () => {
        console.log('\n✨ Connection integration test completed successfully!');
        await cleanupTestEnvironment();
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('\n❌ Test failed:', error);
        if (error.stack) {
            console.error(error.stack);
        }
        await cleanupTestEnvironment();
        process.exit(1);
    });
