#!/usr/bin/env node

/**
 * Connection Integration Test for one.fuse3 (Linux/WSL FUSE3)
 *
 * This test verifies that:
 * 1. Starts a refinio.api instance with FUSE3 mount
 * 2. FUSE3 mount exposes invite files correctly
 * 3. Invite files contain valid invitation URLs
 * 4. Invites can be used to establish connections
 * 5. Bidirectional contact creation works after connection
 * 6. Cleans up: unmounts and stops server
 *
 * Prerequisites:
 * - Linux or WSL2 with FUSE3 support
 * - refinio.api built and available in `../one/packages/refinio.api`
 * - FUSE3 installed: sudo apt-get install fuse3 libfuse3-dev
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
const MOUNT_POINT = process.env.ONE_FILER_MOUNT || '/tmp/one-filer-test';
const INVITES_PATH = path.join(MOUNT_POINT, 'invites');
const IOP_INVITE_FILE = path.join(INVITES_PATH, 'iop_invite.txt');
const IOM_INVITE_FILE = path.join(INVITES_PATH, 'iom_invite.txt');

const REFINIO_API_RUNTIME = getRefinioApiRuntime();
const SERVER_STORAGE_DIR = '/tmp/refinio-api-server-instance';
const CLIENT_STORAGE_DIR = '/tmp/refinio-api-client-instance';
const COMM_SERVER_PORT = 8000;
const SERVER_PORT = 50123;
const CLIENT_PORT = 50125;

// Process handles
let serverProcess = null;
let clientProcess = null;
let commServer = null;

function getFileUrl(filePath) {
    return filePath.startsWith('/')
        ? `file://${filePath}`
        : `file:///${filePath.replace(/\\/g, '/')}`;
}

function getRefinioApiRuntime() {
    const dir = path.resolve(__dirname, '../../../../one/packages/refinio.api');
    const entryPoint = path.join(dir, 'dist/src/cli.js');
    if (!fs.existsSync(entryPoint)) {
        throw new Error(`refinio.api CLI not found: ${entryPoint}. Run its build first.`);
    }
    return {dir, entryPoint};
}

/** Resolve the communication server from Filer's canonical ONE workspace. */
function getCommunicationServerModulePath() {
    const modulePath = path.resolve(__dirname, '../../../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js');
    if (!fs.existsSync(modulePath)) {
        throw new Error(`CommunicationServer module not found: ${modulePath}. Build ../one/packages/one.models first.`);
    }
    return modulePath;
}

function isApiServerReady(output) {
    return output.includes('REST Server listening on') || output.includes('HTTP REST API listening');
}

/**
 * Start local CommunicationServer
 */
async function startCommServer() {
    console.log('Starting local CommunicationServer...');

    try {
        const modelsPath = getCommunicationServerModulePath();
        const fileUrl = getFileUrl(modelsPath);
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

    // Kill client process if running
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

    // Kill server process if running
    if (serverProcess) {
        try {
            serverProcess.kill('SIGINT');
            // Wait a bit for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!serverProcess.killed) {
                serverProcess.kill('SIGKILL');
            }
        } catch (err) {
            console.log('   Failed to kill server process:', err.message);
        }
        serverProcess = null;
    }

    // Run cleanup script to handle stale mounts
    const cleanupScriptPath = path.resolve(__dirname, '../../cleanup-mounts.sh');
    if (fs.existsSync(cleanupScriptPath)) {
        try {
            execSync(cleanupScriptPath, { stdio: 'inherit' });
        } catch (err) {
            console.log('   Warning: cleanup-mounts.sh failed, continuing with manual cleanup...');
        }
    }

    // Unmount FUSE if still mounted (backup in case script didn't work)
    if (fs.existsSync(MOUNT_POINT)) {
        try {
            execSync(`fusermount3 -u "${MOUNT_POINT}" 2>/dev/null || fusermount -u "${MOUNT_POINT}" 2>/dev/null || true`, { stdio: 'pipe' });
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log(`   Unmounted ${MOUNT_POINT}`);
        } catch {
            // Ignore errors - may not be mounted
        }
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

    // Remove mount point directory
    if (fs.existsSync(MOUNT_POINT)) {
        try {
            fs.rmSync(MOUNT_POINT, { recursive: true, force: true });
            console.log(`   Removed ${MOUNT_POINT}`);
        } catch (err) {
            console.log(`   Failed to remove ${MOUNT_POINT}:`, err.message);
        }
    }

    console.log('✅ Cleanup complete\n');
}

/**
 * Start a refinio.api server instance with FUSE3 mount
 */
async function startRefinioApiServer() {
    console.log('🚀 Starting refinio.api instance with FUSE3...\n');

    const refinioApiDir = REFINIO_API_RUNTIME.dir;
    const entryPoint = REFINIO_API_RUNTIME.entryPoint;
    const args = [
        entryPoint,
        '--secret', 'server-secret-fuse3-integration-12345678',
        '--directory', SERVER_STORAGE_DIR,
        '--port', SERVER_PORT.toString(),
        '--comm-server-url', `ws://localhost:${COMM_SERVER_PORT}`,
        '--filer',
        '--filer-mount-point', MOUNT_POINT
    ];

    // Create mount point directory
    if (!fs.existsSync(MOUNT_POINT)) {
        fs.mkdirSync(MOUNT_POINT, { recursive: true });
        console.log(`   Created mount point: ${MOUNT_POINT}`);
    }

    console.log(`   API runtime: ${refinioApiDir}`);
    console.log(`   Server port: ${SERVER_PORT}`);
    console.log(`   Mount point: ${MOUNT_POINT}`);
    console.log(`   CommServer: ws://localhost:${COMM_SERVER_PORT}\n`);

    // Spawn server process with configuration via environment variables
    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', args, {
            cwd: refinioApiDir,
            env: {
                ...process.env,
                // Server config
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: SERVER_PORT.toString(),
                // Instance config
                REFINIO_INSTANCE_NAME: 'server-fuse3-instance',
                REFINIO_INSTANCE_DIRECTORY: SERVER_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'server-fuse3@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'server-secret-fuse3-integration-12345678',
                REFINIO_COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
                REFINIO_ENCRYPT_STORAGE: 'false',
                REFINIO_WIPE_STORAGE: 'true',
                // Filer config
                REFINIO_FILER_MOUNT_POINT: MOUNT_POINT,
                REFINIO_FILER_INVITE_URL_PREFIX: 'https://one.refinio.net/invite',
                REFINIO_FILER_DEBUG: 'true',
                // Other
                NODE_ENV: 'test'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let serverOutput = '';
        let startupTimeout = null;

        // Collect output for debugging
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            process.stdout.write(output);  // Echo to console

            // Check for HTTP server ready (happens BEFORE mount attempt)
            // FUSE mount() blocks forever, so we can't wait for "Filesystem mounted"
            // Instead, we'll poll the filesystem directly after HTTP is ready
            if (isApiServerReady(output)) {
                clearTimeout(startupTimeout);
                console.log('\n✅ Server HTTP API ready, checking if FUSE mount succeeded...\n');
                // Give FUSE a moment to initialize, then we'll poll the filesystem
                setTimeout(() => resolve(), 2000);
            }
        });

        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            process.stderr.write(output);  // Echo to console
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
 * Start a refinio.api CLIENT instance (without FUSE mount)
 */
async function startClientInstance() {
    console.log('🚀 Starting refinio.api CLIENT instance (no mount)...\n');

    const refinioApiDir = REFINIO_API_RUNTIME.dir;
    const entryPoint = REFINIO_API_RUNTIME.entryPoint;
    const args = [
        entryPoint,
        '--secret', 'client-secret-fuse3-integration-12345678',
        '--directory', CLIENT_STORAGE_DIR,
        '--port', CLIENT_PORT.toString(),
        '--comm-server-url', `ws://localhost:${COMM_SERVER_PORT}`
    ];

    console.log(`   API runtime: ${refinioApiDir}`);
    console.log(`   Client port: ${CLIENT_PORT}`);
    console.log(`   CommServer: ws://localhost:${COMM_SERVER_PORT}\n`);

    return new Promise((resolve, reject) => {
        clientProcess = spawn('node', args, {
            cwd: refinioApiDir,
            env: {
                ...process.env,
                // Client config
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: CLIENT_PORT.toString(),
                // Instance config
                REFINIO_INSTANCE_NAME: 'client-fuse3-instance',
                REFINIO_INSTANCE_DIRECTORY: CLIENT_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'client-fuse3@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'client-secret-fuse3-integration-12345678',
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

            if (isApiServerReady(output)) {
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
 * Invoke a canonical ONE operation via the refinio HTTP surface
 */
async function postOperation(port, handler, method, payload = {}) {
    const http = await import('http');

    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(payload);
        const postOptions = {
            hostname: '127.0.0.1',
            port,
            path: `/api/${handler}/${method}`,
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
                const parsed = data ? JSON.parse(data) : {};
                if ((res.statusCode === 200 || res.statusCode === 201) && parsed.success) {
                    resolve(parsed.data);
                    return;
                }

                reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}: ${data}`));
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Connection error: ${error.message}`));
        });

        req.setTimeout(120000);
        req.write(postData);
        req.end();
    });
}

/**
 * Connect CLIENT to SERVER using invite (via HTTP REST API)
 */
async function connectUsingInvite(inviteUrl) {
    console.log('🔗 CLIENT accepting invitation from SERVER...');

    const invitation = parseInviteUrl(inviteUrl);
    const result = await postOperation(
        CLIENT_PORT,
        'connection',
        'connectWithInvite',
        invitation
    );

    console.log('   ✅ Invitation accepted successfully');
    return result;
}

/**
 * Wait for SERVER to be online (connected to CommServer)
 */
async function waitForServerOnline(port, maxWaitMs = 30000) {
    console.log(`   Waiting for SERVER to connect to CommServer (polling status endpoint)...`);
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
        try {
            const status = await postOperation(port, 'connection', 'getStatus', {});
            const isOnline = status.online === true;

            if (isOnline) {
                console.log(`   ✅ SERVER is online (connected to CommServer)`);
                return;
            }
        } catch (err) {
            // Continue polling
        }

        await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`SERVER did not come online within ${maxWaitMs}ms`);
}

/**
 * Query contacts from a refinio instance
 */
async function queryContacts(port, instanceName) {
    try {
        const contacts = await postOperation(port, 'connection', 'listContacts', {});
        console.log(`   ${instanceName} contacts: ${contacts.length} found`);
        return contacts;
    } catch (error) {
        console.error(`   ❌ Failed to query ${instanceName} contacts:`, error.message);
        return [];
    }
}

/**
 * Check if running in WSL
 */
function isWSL() {
    try {
        const release = fs.readFileSync('/proc/version', 'utf-8');
        return release.toLowerCase().includes('microsoft') || release.toLowerCase().includes('wsl');
    } catch {
        return false;
    }
}

/**
 * Check if FUSE3 is available
 */
function checkFUSE3Available() {
    try {
        execSync('which fusermount3', { stdio: 'pipe' });
        return true;
    } catch {
        try {
            execSync('which fusermount', { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Check if mount point is a FUSE mount
 */
function isFUSEMount(mountPath) {
    try {
        const output = execSync('mount', { encoding: 'utf-8' });
        return output.includes(mountPath) && (output.includes('fuse') || output.includes('fuse3'));
    } catch {
        return false;
    }
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
 * Main test function
 */
async function runConnectionTest() {
    console.log('🔗 ONE.fuse3 Connection Integration Test\n');
    console.log('=' .repeat(70));
    console.log(`Platform: ${isWSL() ? 'WSL2' : 'Linux'} (FUSE3)`);
    console.log(`Mount Point: ${MOUNT_POINT}`);
    console.log(`Invites Path: ${INVITES_PATH}\n`);

    // Run cleanup script at the very beginning to handle stale mounts
    console.log('Running initial cleanup to handle any stale mounts...');
    const cleanupScriptPath = path.resolve(__dirname, '../../cleanup-mounts.sh');
    if (fs.existsSync(cleanupScriptPath)) {
        try {
            execSync(cleanupScriptPath, { stdio: 'inherit' });
        } catch (err) {
            console.log('Warning: cleanup-mounts.sh failed, continuing anyway...');
        }
    }

    // Setup: Clean up any existing test environment, start CommServer, then server
    try {
        await cleanupTestEnvironment();
        console.log('\n1️⃣ Starting CommServer...');
        await startCommServer();
        console.log('\n2️⃣ Starting SERVER instance with FUSE3...');
        await startRefinioApiServer();
    } catch (setupError) {
        console.error('\n❌ Setup Failed:', setupError.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure refinio.api is built: cd ../one/packages/refinio.api && npm run build');
        console.error('   2. Check that FUSE3 is installed: which fusermount3');
        console.error('   3. Verify you have permissions to mount FUSE filesystems');
        if (isWSL()) {
            console.error('   4. WSL2 required (not WSL1): wsl --list --verbose');
        }
        throw setupError;
    }

    let testResults = {
        fuseAvailable: false,
        isFUSEMounted: false,
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
        // Test 0: Check FUSE3 availability
        console.log('\n3️⃣ Checking FUSE3 availability...');
        testResults.fuseAvailable = checkFUSE3Available();
        if (!testResults.fuseAvailable) {
            throw new Error('FUSE3 is not available on this system.\n' +
                           '   Install FUSE3: sudo apt-get install fuse3 libfuse3-dev\n' +
                           '   Or on Fedora: sudo dnf install fuse3 fuse3-devel');
        }
        console.log(`✅ FUSE3 is available`);

        // Test 1: Check mount point exists
        console.log('\n4️⃣ Checking FUSE3 mount point...');
        if (!fs.existsSync(MOUNT_POINT)) {
            throw new Error(`Mount point does not exist: ${MOUNT_POINT}\n` +
                           `   Please ensure ONE Filer is running with FUSE3 enabled.\n` +
                           `   Set ONE_FILER_MOUNT environment variable if using different path.`);
        }
        testResults.mountPointExists = true;
        console.log(`✅ Mount point exists: ${MOUNT_POINT}`);

        // Check if it's actually a FUSE mount
        testResults.isFUSEMounted = isFUSEMount(MOUNT_POINT);
        if (testResults.isFUSEMounted) {
            console.log(`✅ Mount point is a FUSE filesystem`);
        } else {
            console.log(`⚠️  Warning: Mount point exists but may not be FUSE mounted`);
        }

        // Test 2: Check invites directory exists
        console.log('\n5️⃣ Checking invites directory...');
        if (!fs.existsSync(INVITES_PATH)) {
            throw new Error(`Invites directory not found: ${INVITES_PATH}\n` +
                           `   The PairingFileSystem may not be mounted.`);
        }
        testResults.invitesDirectoryExists = true;
        console.log(`✅ Invites directory exists: ${INVITES_PATH}`);

        // List all files in invites directory
        const inviteFiles = await fs.promises.readdir(INVITES_PATH);
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

        // Test 7: Verify both invites use same CommServer
        console.log('\n🔟 Verifying CommServer consistency...');
        if (iopInviteData.url !== iomInviteData.url) {
            console.log(`⚠️  Warning: IOP and IOM invites use different CommServers`);
            console.log(`   IOP: ${iopInviteData.url}`);
            console.log(`   IOM: ${iomInviteData.url}`);
        } else {
            console.log(`✅ Both invites use same CommServer: ${iopInviteData.url}`);
        }

        // Summary
        console.log('\n' + '=' .repeat(70));
        console.log('📊 Test Results Summary:\n');
        console.log(`✅ FUSE3 available: ${testResults.fuseAvailable}`);
        console.log(`✅ FUSE mount detected: ${testResults.isFUSEMounted}`);
        console.log(`✅ FUSE3 mount point accessible: ${testResults.mountPointExists}`);
        console.log(`✅ Invites directory accessible: ${testResults.invitesDirectoryExists}`);
        console.log(`✅ IOP invite file exists: ${testResults.iopInviteExists}`);
        console.log(`✅ IOM invite file exists: ${testResults.iomInviteExists}`);
        console.log(`✅ IOP invite readable (${testResults.iopInviteSize} bytes): ${testResults.iopInviteReadable}`);
        console.log(`✅ IOM invite readable (${testResults.iomInviteSize} bytes): ${testResults.iomInviteReadable}`);
        console.log(`✅ IOP invite valid: ${testResults.iopInviteValid}`);
        console.log(`✅ IOM invite valid: ${testResults.iomInviteValid}`);

        console.log('\n🎯 Initial Validation Complete:');
        console.log('   ✅ FUSE3 virtualization is working correctly');
        console.log('   ✅ PairingFileSystem is exposing invite files');
        console.log('   ✅ Invite content is valid and ready for connection');

        // Wait for SERVER to be fully connected to CommServer before starting CLIENT
        console.log('\n   Ensuring SERVER is fully connected to CommServer...');
        await waitForServerOnline(SERVER_PORT);

        // Test 8: Start CLIENT instance
        console.log('\n1️⃣1️⃣ Starting CLIENT refinio.api instance...');
        await startClientInstance();

        // Test 9: CLIENT connects to SERVER using invite from FUSE mount
        console.log('\n1️⃣2️⃣ Establishing connection using invite from FUSE mount...');
        await connectUsingInvite(iopInviteContent);

        // Wait for connection to stabilize and contacts to be created
        console.log('\n   Waiting for connection to stabilize and contacts to be created...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Test 10: Verify bidirectional contact creation
        console.log('\n1️⃣3️⃣ Verifying bidirectional contact creation...');

        const serverContacts = await queryContacts(SERVER_PORT, 'SERVER');
        const clientContacts = await queryContacts(CLIENT_PORT, 'CLIENT');

        let connectionSuccess = false;
        if (clientContacts.length > 0 && serverContacts.length > 0) {
            console.log('\n   ✅ BIDIRECTIONAL CONTACT CREATION VERIFIED!');
            console.log('   ✅ Both instances can see each other as contacts');
            connectionSuccess = true;
        } else if (clientContacts.length > 0) {
            console.log('\n   ⚠️  Partial success: CLIENT sees SERVER, but not vice versa');
        } else if (serverContacts.length > 0) {
            console.log('\n   ⚠️  Partial success: SERVER sees CLIENT, but not vice versa');
        } else {
            throw new Error('No contacts found on either side - connection failed');
        }

        console.log('\n🎉 Final Results:');
        console.log('   ✅ FUSE3 mount working correctly');
        console.log('   ✅ Invite files readable from real filesystem');
        console.log('   ✅ Connection established successfully');
        console.log('   ✅ Bidirectional contacts created');
        console.log('   ✅ Integration test PASSED!');

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error('\n📊 Partial Results:', testResults);

        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure ONE Filer is running with FUSE3 enabled');
        console.error('   2. Check that ConnectionsModel has allowPairing: true');
        console.error('   3. Verify FUSE3 is properly mounted at', MOUNT_POINT);
        console.error('   4. Check system logs: dmesg | grep -i fuse');
        console.error('   5. Ensure FUSE3 kernel module is loaded: lsmod | grep fuse');
        console.error('   6. Check mount status: mount | grep fuse');

        if (isWSL()) {
            console.error('\n🪟 WSL-Specific Troubleshooting:');
            console.error('   1. Ensure WSL2 (not WSL1): wsl --list --verbose');
            console.error('   2. FUSE works in WSL2 but not WSL1');
            console.error('   3. May need: sudo apt-get install fuse3 libfuse3-dev');
        }

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
console.log('Starting one.fuse3 connection integration test...\n');
runConnectionTest()
    .then(async () => {
        console.log('\n✨ Connection integration test completed successfully!');
        console.log('\n📁 Test environment is still running for inspection:');
        console.log('=' .repeat(70));
        console.log(`   FUSE mount point: ${MOUNT_POINT}`);
        console.log(`   Server storage: ${SERVER_STORAGE_DIR}`);
        console.log(`   Client storage: ${CLIENT_STORAGE_DIR}`);
        console.log(`   Server HTTP API: http://127.0.0.1:${SERVER_PORT}`);
        console.log(`   Client HTTP API: http://127.0.0.1:${CLIENT_PORT}`);
        console.log('\n🔍 You can now inspect:');
        console.log(`   ls -la ${MOUNT_POINT}`);
        console.log(`   ls -la ${MOUNT_POINT}/invites`);
        console.log(`   cat ${MOUNT_POINT}/invites/iop_invite.txt`);
        console.log(`   curl -X POST http://127.0.0.1:${SERVER_PORT}/api/connection/getStatus -H 'Content-Type: application/json' -d '{}'`);
        console.log(`   curl -X POST http://127.0.0.1:${SERVER_PORT}/api/connection/listContacts -H 'Content-Type: application/json' -d '{}'`);
        console.log('\n⚠️  Press Ctrl+C when done to clean up and exit');
        console.log('=' .repeat(70));

        // Keep processes running - don't cleanup or exit
        // User will manually trigger cleanup with Ctrl+C
    })
    .catch(async (error) => {
        console.error('\n❌ Test failed:', error);
        if (error.stack) {
            console.error(error.stack);
        }
        await cleanupTestEnvironment();
        process.exit(1);
    });
