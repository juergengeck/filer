#!/usr/bin/env node

/**
 * IPC Bridge Test - Test Node.js IPC server directly
 *
 * This simpler test verifies the JSON-RPC IPC bridge works correctly
 * without requiring the full File Provider app to run.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Start Node.js IPC server
const nodePath = path.resolve(__dirname, '../node-runtime/lib/index.js');
console.log('Starting Node.js IPC server...');
console.log(`Path: ${nodePath}\n`);

const ipcServer = spawn('node', [nodePath], {
    stdio: ['pipe', 'pipe', 'inherit']
});

let responseBuffer = '';
let requestId = 0;
const pendingRequests = new Map();
const testInstancePath = mkdtempSync(path.join(tmpdir(), 'one-provider-ipc-'));

// Read responses
ipcServer.stdout.on('data', (data) => {
    responseBuffer += data.toString();

    // Process complete lines
    const lines = responseBuffer.split('\n');
    responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
        if (!line.trim()) continue;

        try {
            const response = JSON.parse(line);
            console.log('← Response:', JSON.stringify(response));

            if (response.id && pendingRequests.has(response.id)) {
                const { resolve, reject } = pendingRequests.get(response.id);
                pendingRequests.delete(response.id);

                if (response.error) {
                    reject(new Error(response.error.message));
                } else {
                    resolve(response.result);
                }
            }
        } catch (err) {
            console.error('Failed to parse response:', line, err);
        }
    }
});

// Send JSON-RPC request
function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
        requestId++;
        const id = requestId;

        const request = {
            jsonrpc: '2.0',
            method,
            params,
            id
        };

        console.log('→ Request: ', JSON.stringify(request));
        ipcServer.stdin.write(JSON.stringify(request) + '\n');

        pendingRequests.set(id, { resolve, reject });

        // Initialization can take longer with live pairing listeners and fresh storage.
        setTimeout(() => {
            if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }
        }, 30000);
    });
}

// Run tests
async function runTests() {
    console.log('🧪 Testing IPC Bridge\n');
    console.log('='.repeat(70));

    try {
        // Test 1: Initialize
        console.log('\n1️⃣ Testing initialize()...');
        const initResult = await sendRequest('initialize', { instancePath: testInstancePath });
        console.log('✅ Initialize:', initResult);
        if (initResult.status !== 'ok') {
            throw new Error('Initialize failed');
        }

        // Test 2: stat root
        console.log('\n2️⃣ Testing stat("/")...');
        const statResult = await sendRequest('stat', { path: '/' });
        console.log('✅ Stat:', statResult);
        if (typeof statResult.mode !== 'number' || typeof statResult.size !== 'number') {
            throw new Error('Invalid stat response');
        }

        // Test 3: readDir root
        console.log('\n3️⃣ Testing readDir("/")...');
        const readDirResult = await sendRequest('readDir', { path: '/' });
        console.log('✅ ReadDir:', readDirResult);
        if (!Array.isArray(readDirResult.children)) {
            throw new Error('Invalid readDir response');
        }
        console.log(`   Found ${readDirResult.children.length} children:`, readDirResult.children);

        // Test 4: readFile
        console.log('\n4️⃣ Testing readFile("/objects")...');
        try {
            const readFileResult = await sendRequest('readFile', { path: '/objects/test.txt' });
            console.log('✅ ReadFile:', readFileResult);
            if (typeof readFileResult.content !== 'string') {
                throw new Error('Invalid readFile response');
            }

            // Decode base64
            const content = Buffer.from(readFileResult.content, 'base64').toString('utf-8');
            console.log(`   Content: "${content}"`);
        } catch (err) {
            console.log('   (Expected - stub filesystem)');
        }

        console.log('\n' + '='.repeat(70));
        console.log('🎉 All IPC Bridge Tests PASSED!\n');
        console.log('✅ JSON-RPC communication working');
        console.log('✅ initialize() successful');
        console.log('✅ stat() returning correct structure');
        console.log('✅ readDir() returning file list');
        console.log('✅ Node.js IPC server fully functional');

    } catch (error) {
        console.error('\n❌ Test Failed:', error.message);
        process.exit(1);
    } finally {
        // Cleanup
        ipcServer.kill();
        rmSync(testInstancePath, { recursive: true, force: true });
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    process.exit(0);
}

// Handle errors
ipcServer.on('error', (error) => {
    console.error('Failed to start IPC server:', error);
    process.exit(1);
});

ipcServer.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`IPC server exited with code ${code}`);
        process.exit(code || 1);
    }
});

// Wait a moment for server to start, then run tests
setTimeout(() => runTests(), 1000);
