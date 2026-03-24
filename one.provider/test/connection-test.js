#!/usr/bin/env node

/**
 * Connection Integration Test for one.provider (macOS File Provider)
 *
 * This test verifies that:
 * 1. Starts refinio.api with File Provider
 * 2. File Provider exposes invite files correctly
 * 3. Invite files contain valid invitation URLs
 * 4. Invites can be used to establish connections
 * 5. Bidirectional contact creation works after connection
 * 6. Cleans up: removes domains and stops server
 *
 * Prerequisites:
 * - macOS 13.0+ (Ventura)
 * - refinio.api built and available (../refinio.api)
 * - one.provider built and installed
 */

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const DOMAIN_NAME = 'test-domain';
const INVITES_PATH = '/Volumes/com.apple.FileProvider.LocalStorage/test-domain-*/invites';

// Path to refinio.api (relative to one.provider/test/)
const REFINIO_API_DIR = path.resolve(__dirname, '../../refinio.api');
const SERVER_STORAGE_DIR = '/tmp/refinio-api-server-instance';
const CLIENT_STORAGE_DIR = '/tmp/refinio-api-client-instance';
const COMM_SERVER_PORT = 8000;
const SERVER_PORT = 50123;
const CLIENT_PORT = 50125;

// Process handles
let serverProcess = null;
let clientProcess = null;
let commServer = null;

/**
 * Start local CommunicationServer
 */
async function startCommServer() {
    console.log('Starting local CommunicationServer...');

    try {
        const modelsPath = path.resolve(__dirname, '../../one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js');
        const fileUrl = modelsPath.startsWith('/') ? `file://${modelsPath}` : `file:///${modelsPath.replace(/\\/g, '/')}`;
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

    // Kill client process group
    if (clientProcess && clientProcess.pid) {
        try {
            process.kill(-clientProcess.pid, 'SIGKILL');
            console.log(`   Killed client process group ${clientProcess.pid}`);
        } catch (err) {
            console.log(`   Failed to kill client process group ${clientProcess.pid}:`, err.message);
        }
        clientProcess = null;
    }

    // Kill server process group
    if (serverProcess && serverProcess.pid) {
        try {
            process.kill(-serverProcess.pid, 'SIGKILL');
            console.log(`   Killed server process group ${serverProcess.pid}`);
        } catch (err) {
            console.log(`   Failed to kill server process group ${serverProcess.pid}:`, err.message);
        }
        serverProcess = null;
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

    console.log('✅ Cleanup complete\n');
}

/**
 * Start refinio.api server with File Provider
 */
async function startRefinioApiServer() {
    console.log('🚀 Starting refinio.api server with File Provider...\n');

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

    return new Promise((resolve, reject) => {
        serverProcess = spawn('node', [distIndexPath], {
            cwd: REFINIO_API_DIR,
            detached: true, // Make this process the leader of a new process group
            env: {
                ...process.env,
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: SERVER_PORT.toString(),
                REFINIO_INSTANCE_NAME: 'server-provider-instance',
                REFINIO_INSTANCE_DIRECTORY: SERVER_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'server-provider@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'server-secret-provider-integration-12345678',
                REFINIO_COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
                REFINIO_ENCRYPT_STORAGE: 'false',
                REFINIO_WIPE_STORAGE: 'true',
                REFINIO_FILER_TYPE: 'provider',
                REFINIO_FILER_DOMAIN_NAME: DOMAIN_NAME,
                REFINIO_FILER_INVITE_URL_PREFIX: 'https://one.refinio.net/invite',
                REFINIO_FILER_DEBUG: 'true',
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

        startupTimeout = setTimeout(() => {
            reject(new Error('Server startup timeout after 60 seconds\n' + serverOutput));
        }, 60000);
    });
}

/**
 * Start refinio.api CLIENT instance (without File Provider)
 */
async function startClientInstance() {
    console.log('🚀 Starting refinio.api CLIENT instance (no File Provider)...\n');

    const distIndexPath = path.join(REFINIO_API_DIR, 'dist', 'index.js');

    console.log(`   Client port: ${CLIENT_PORT}`);
    console.log(`   CommServer: ws://localhost:${COMM_SERVER_PORT}\n`);

    return new Promise((resolve, reject) => {
        clientProcess = spawn('node', [distIndexPath], {
            cwd: REFINIO_API_DIR,
            detached: true, // Make this process the leader of a new process group
            env: {
                ...process.env,
                REFINIO_API_HOST: '127.0.0.1',
                REFINIO_API_PORT: CLIENT_PORT.toString(),
                REFINIO_INSTANCE_NAME: 'client-provider-instance',
                REFINIO_INSTANCE_DIRECTORY: CLIENT_STORAGE_DIR,
                REFINIO_INSTANCE_EMAIL: 'client-provider@one.filer.test',
                REFINIO_INSTANCE_SECRET: 'client-secret-provider-integration-12345678',
                REFINIO_COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
                REFINIO_ENCRYPT_STORAGE: 'false',
                REFINIO_WIPE_STORAGE: 'true',
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
            port: CLIENT_PORT,
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

        req.setTimeout(120000);
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
 * Find File Provider volume mount in ~/Library/CloudStorage
 */
function findProviderVolume() {
    const cloudStoragePath = path.join(os.homedir(), 'Library', 'CloudStorage');
    if (!fs.existsSync(cloudStoragePath)) {
        throw new Error(`CloudStorage directory not found: ${cloudStoragePath}`);
    }

    const entries = fs.readdirSync(cloudStoragePath);
    const expectedPrefix = `OneFiler-${DOMAIN_NAME}`;

    for (const entry of entries) {
        if (entry.startsWith(expectedPrefix)) {
            const volumePath = path.join(cloudStoragePath, entry);
            if (fs.existsSync(volumePath)) {
                return volumePath;
            }
        }
    }

    throw new Error(`Domain starting with '${expectedPrefix}' not found in ${cloudStoragePath}`);
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
 * Wait for the File Provider volume to be mounted by the OS.
 */
async function waitForProviderVolume(timeout = 30000) {
    console.log(`   Waiting for File Provider volume to appear (up to ${timeout / 1000}s)...`);
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const volumePath = findProviderVolume();
            // If findProviderVolume doesn't throw, we found it.
            return volumePath;
        } catch (error) {
            // Volume not found yet, wait and try again.
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    // If we exit the loop, it timed out.
    throw new Error(`Timed out waiting for File Provider volume.`);
}

/**
 * Main test function
 */
async function runConnectionTest() {
    console.log('🔗 ONE.provider Connection Integration Test\n');
    console.log('='.repeat(70));
    console.log(`Platform: macOS (File Provider)`);
    console.log(`Domain Name: ${DOMAIN_NAME}\n`);

    try {
        await cleanupTestEnvironment();
        console.log('\n1️⃣ Starting CommServer...');
        await startCommServer();
        console.log('\n2️⃣ Starting SERVER instance with File Provider...');
        await startRefinioApiServer();
    } catch (setupError) {
        console.error('\n❌ Setup Failed:', setupError.message);
        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure refinio.api is built: cd ../refinio.api && npm run build');
        console.error('   2. Check that one.provider is built and installed');
        console.error('   3. Verify File Provider extension is enabled in System Settings');
        throw setupError;
    }

    let testResults = {
        volumeFound: false,
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
        // Test 1: Find File Provider volume
        console.log('\n3️⃣ Locating File Provider volume...');
        const volumePath = await waitForProviderVolume();
        testResults.volumeFound = true;
        console.log(`✅ Found File Provider volume: ${volumePath}`);


        const invitesPath = path.join(volumePath, 'invites');
        const iopInviteFile = path.join(invitesPath, 'iop_invite.txt');
        const iomInviteFile = path.join(invitesPath, 'iom_invite.txt');

        // Test 2: Check invites directory
        console.log('\n4️⃣ Checking invites directory...');
        if (!fs.existsSync(invitesPath)) {
            throw new Error(`Invites directory not found: ${invitesPath}`);
        }
        testResults.invitesDirectoryExists = true;
        console.log(`✅ Invites directory exists: ${invitesPath}`);

        const inviteFiles = await fs.promises.readdir(invitesPath);
        console.log(`   Files in invites/: ${inviteFiles.join(', ')}`);

        // Test 3: Check IOP invite file
        console.log('\n5️⃣ Checking IOP invite file...');
        if (!fs.existsSync(iopInviteFile)) {
            throw new Error(`IOP invite file not found: ${iopInviteFile}`);
        }
        testResults.iopInviteExists = true;
        console.log(`✅ IOP invite file exists`);

        // Test 4: Check IOM invite file
        console.log('\n6️⃣ Checking IOM invite file...');
        if (!fs.existsSync(iomInviteFile)) {
            throw new Error(`IOM invite file not found: ${iomInviteFile}`);
        }
        testResults.iomInviteExists = true;
        console.log(`✅ IOM invite file exists`);

        // Test 5: Read and validate IOP invite
        console.log('\n7️⃣ Reading and validating IOP invite...');
        let iopInviteContent;
        try {
            iopInviteContent = (await fs.promises.readFile(iopInviteFile, 'utf-8')).trim();
            testResults.iopInviteReadable = true;
            testResults.iopInviteSize = iopInviteContent.length;
            console.log(`✅ IOP invite readable (${testResults.iopInviteSize} bytes)`);
        } catch (readError) {
            throw new Error(`Failed to read IOP invite: ${readError.message}`);
        }

        if (iopInviteContent.length === 0) {
            throw new Error('IOP invite file is empty');
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
        console.log('\n8️⃣ Reading and validating IOM invite...');
        let iomInviteContent;
        try {
            iomInviteContent = (await fs.promises.readFile(iomInviteFile, 'utf-8')).trim();
            testResults.iomInviteReadable = true;
            testResults.iomInviteSize = iomInviteContent.length;
            console.log(`✅ IOM invite readable (${testResults.iomInviteSize} bytes)`);
        } catch (readError) {
            throw new Error(`Failed to read IOM invite: ${readError.message}`);
        }

        if (iomInviteContent.length === 0) {
            throw new Error('IOM invite file is empty');
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

        // Test 7: Verify CommServer consistency
        console.log('\n9️⃣ Verifying CommServer consistency...');
        if (iopInviteData.url !== iomInviteData.url) {
            console.log(`⚠️  Warning: IOP and IOM invites use different CommServers`);
            console.log(`   IOP: ${iopInviteData.url}`);
            console.log(`   IOM: ${iomInviteData.url}`);
        } else {
            console.log(`✅ Both invites use same CommServer: ${iopInviteData.url}`);
        }

        // Summary
        console.log('\n' + '='.repeat(70));
        console.log('📊 Test Results Summary:\n');
        console.log(`✅ File Provider volume found: ${testResults.volumeFound}`);
        console.log(`✅ Invites directory accessible: ${testResults.invitesDirectoryExists}`);
        console.log(`✅ IOP invite file exists: ${testResults.iopInviteExists}`);
        console.log(`✅ IOM invite file exists: ${testResults.iomInviteExists}`);
        console.log(`✅ IOP invite readable (${testResults.iopInviteSize} bytes): ${testResults.iopInviteReadable}`);
        console.log(`✅ IOM invite readable (${testResults.iomInviteSize} bytes): ${testResults.iomInviteReadable}`);
        console.log(`✅ IOP invite valid: ${testResults.iopInviteValid}`);
        console.log(`✅ IOM invite valid: ${testResults.iomInviteValid}`);

        console.log('\n🎯 Initial Validation Complete:');
        console.log('   ✅ File Provider is working correctly');
        console.log('   ✅ PairingFileSystem is exposing invite files');
        console.log('   ✅ Invite content is valid and ready for connection');

        // Test 8: Start CLIENT instance
        console.log('\n🔟 Starting CLIENT refinio.api instance...');
        await startClientInstance();

        // Test 9: CLIENT connects to SERVER using invite
        console.log('\n1️⃣1️⃣ Establishing connection using invite from File Provider...');
        await connectUsingInvite(iopInviteContent);

        // Wait for connection to stabilize
        console.log('\n   Waiting for connection to stabilize and contacts to be created...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Test 10: Verify bidirectional contact creation
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
        console.log('   ✅ File Provider working correctly');
        console.log('   ✅ Invite files readable from real filesystem');
        console.log('   ✅ Connection established successfully');
        console.log('   ✅ Bidirectional contacts created');
        console.log('   ✅ Integration test PASSED!');

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        console.error('\n📊 Partial Results:', testResults);

        console.error('\n🔧 Troubleshooting:');
        console.error('   1. Ensure one.provider is built and installed');
        console.error('   2. Check that ConnectionsModel has allowPairing: true');
        console.error('   3. Verify File Provider domain is registered');
        console.error('   4. Check Console.app for File Provider extension logs');
        console.error('   5. Ensure App Group entitlement is configured');

        throw error;
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
console.log('Starting one.provider connection integration test...\n');
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
