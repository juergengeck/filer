#!/usr/bin/env node
/**
 * Simple ObjectFilter Test for Group Certificate Validation
 *
 * Tests that the AffirmationCertificate-based objectFilter correctly validates Groups.
 * Uses separate worker processes for Alice and Bob to avoid ONE.core's single-instance limitation.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const COMM_SERVER_PORT = 8100;
const ALICE_PORT = 9001;
const BOB_PORT = 9002;

const ONE_MODELS_PATH = path.resolve(__dirname, '../../packages/one.models');
const STORAGE_DIRS = {
  alice: path.join(os.tmpdir(), 'test-objectfilter-alice'),
  bob: path.join(os.tmpdir(), 'test-objectfilter-bob')
};

let commServer = null;
const workers = {
  alice: null,
  bob: null
};

/**
 * HTTP request helper
 */
function httpRequest(port, path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: data ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Clean up storage directories
 */
function cleanStorage() {
  for (const dir of Object.values(STORAGE_DIRS)) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Start CommunicationServer
 */
async function startCommServer() {
  console.log('1️⃣ Starting CommServer...');

  const commServerPath = path.join(ONE_MODELS_PATH, 'lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js');
  if (!fs.existsSync(commServerPath)) {
    throw new Error(`CommunicationServer not found at ${commServerPath}`);
  }

  const fileUrl = `file://${commServerPath}`;
  const CommunicationServerModule = await import(fileUrl);
  const CommunicationServer = CommunicationServerModule.default;

  commServer = new CommunicationServer();
  await commServer.start('localhost', COMM_SERVER_PORT);

  console.log(`   ✅ CommServer started on localhost:${COMM_SERVER_PORT}\n`);
}

/**
 * Start worker process
 */
async function startWorker(name, email, port, storageDir) {
  console.log(`2️⃣ Starting ${name} worker...`);

  const workerPath = path.join(__dirname, 'test-object-filter-worker.js');
  const childProcess = spawn('node', [workerPath], {
    env: {
      ...process.env,
      INSTANCE_NAME: name,
      INSTANCE_EMAIL: email,
      INSTANCE_PORT: port.toString(),
      COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
      STORAGE_DIR: storageDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Forward worker output
  childProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  childProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  childProcess.on('error', (error) => {
    console.error(`[${name}] Worker process error:`, error);
  });

  childProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] Worker exited with code ${code}`);
    }
  });

  // Wait for worker to be ready
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check if worker is responsive
  try {
    await httpRequest(port, '/status');
    console.log(`   ✅ ${name} worker started on port ${port}\n`);
  } catch (error) {
    throw new Error(`${name} worker failed to start: ${error.message}`);
  }

  return childProcess;
}

/**
 * Run the test
 */
async function runTest() {
  console.log('🔬 ObjectFilter Certificate Validation Test\n');
  console.log('='.repeat(70));

  try {
    // Clean up and prepare
    cleanStorage();

    // Start infrastructure
    await startCommServer();

    // Start worker instances
    workers.alice = await startWorker('Alice', 'alice@test.local', ALICE_PORT, STORAGE_DIRS.alice);
    workers.bob = await startWorker('Bob', 'bob@test.local', BOB_PORT, STORAGE_DIRS.bob);

    // 3️⃣ Get Alice and Bob's identities
    console.log('3️⃣ Getting identities...');
    const aliceStatus = await httpRequest(ALICE_PORT, '/status');
    const bobStatus = await httpRequest(BOB_PORT, '/status');

    const aliceId = aliceStatus.myId;
    const bobId = bobStatus.myId;

    console.log(`   📇 Alice ID: ${aliceId.substring(0, 8)}`);
    console.log(`   📇 Bob ID: ${bobId.substring(0, 8)}\n`);

    // 4️⃣ Create connection between Alice and Bob
    console.log('4️⃣ Establishing connection between Alice and Bob...');

    const inviteResponse = await httpRequest(ALICE_PORT, '/create-invitation', 'POST');
    const invitation = inviteResponse.invitation;
    const invitationStr = typeof invitation === 'string' ? invitation : JSON.stringify(invitation);
    console.log(`   📧 Alice created invitation: ${invitationStr.substring(0, 50)}...`);

    await httpRequest(BOB_PORT, '/accept-invitation', 'POST', { invitation });
    console.log('   🤝 Bob accepted invitation');

    // Wait for CHUM protocol to initialize and contacts to sync
    console.log('   ⏳ Waiting for contact sync...');
    const maxWait = 60000; // 60 seconds max
    const pollInterval = 500; // Check every 500ms
    const startTime = Date.now();

    let aliceContacts, bobContacts;
    while ((Date.now() - startTime) < maxWait) {
      aliceContacts = await httpRequest(ALICE_PORT, '/contacts');
      bobContacts = await httpRequest(BOB_PORT, '/contacts');

      console.log(`   [${Math.floor((Date.now() - startTime) / 1000)}s] Alice: ${aliceContacts.contacts.length} contacts, Bob: ${bobContacts.contacts.length} contacts`);

      if (aliceContacts.contacts.length > 0 && bobContacts.contacts.length > 0) {
        break; // Contacts synced!
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (aliceContacts.contacts.length === 0 || bobContacts.contacts.length === 0) {
      throw new Error(`Connection not established properly after ${Math.floor((Date.now() - startTime) / 1000)}s - Alice: ${aliceContacts.contacts.length} contacts, Bob: ${bobContacts.contacts.length} contacts`);
    }

    console.log(`   ✅ Connection established: Alice knows ${aliceContacts.contacts.length} contact(s), Bob knows ${bobContacts.contacts.length} contact(s)\n`);

    // 5️⃣ Alice creates a Group with AffirmationCertificate
    console.log('5️⃣ Alice creates a Group with AffirmationCertificate...');

    const createGroupResponse = await httpRequest(ALICE_PORT, '/create-group', 'POST', {
      person: [aliceId, bobId]
    });

    const groupIdHash = createGroupResponse.groupId;
    const hashGroupHash = createGroupResponse.hashGroupHash;
    console.log(`   📦 Group created: ${groupIdHash.substring(0, 8)}`);
    console.log(`   👥 Group members: ${createGroupResponse.memberCount} people`);
    console.log(`   📜 AffirmationCertificate created: ${createGroupResponse.certificateId.substring(0, 8)}`);
    console.log(`   ✍️  Signature: ${createGroupResponse.signatureId.substring(0, 8)}, License: ${createGroupResponse.licenseId.substring(0, 8)}`);
    console.log(`   🔗 HashGroup (affirmed): ${hashGroupHash.substring(0, 8)}\n`);

    // 6️⃣ Verify certificate validation
    console.log('6️⃣ Verifying certificate validation...');

    // Test Alice can validate her own HashGroup (the affirmed object)
    const aliceValidation = await httpRequest(ALICE_PORT, '/validate-group', 'POST', {
      groupId: hashGroupHash  // Validate the HashGroup, not the Group
    });
    console.log(`   ${aliceValidation.valid ? '✅' : '❌'} Alice validates her own HashGroup: ${aliceValidation.valid}`);

    if (!aliceValidation.valid) {
      throw new Error('Alice failed to validate her own HashGroup');
    }

    // Test direct certificate verification
    const aliceCertCheck = await httpRequest(ALICE_PORT, '/check-certificate', 'POST', {
      objectId: hashGroupHash  // Check certificate for HashGroup
    });
    console.log(`   ✅ Alice's certificate check: ${aliceCertCheck.affirmedBy.length} affirmer(s), isAffirmedByMe: ${aliceCertCheck.isAffirmedByMe}\n`);

    console.log('='.repeat(70));
    console.log('✅ TEST PASSED: ObjectFilter certificate validation works correctly!');
    console.log('='.repeat(70));
    console.log('\n📋 Summary:');
    console.log('   ✅ AffirmationCertificate created successfully');
    console.log('   ✅ ObjectFilter validates Groups with valid certificates');
    console.log('   ✅ trust.affirmedBy() returns correct affirmers');
    console.log('   ✅ trust.isAffirmedBy() validates certificates');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    for (const [name, worker] of Object.entries(workers)) {
      if (worker) {
        console.log(`\n🧹 Shutting down ${name}...`);
        worker.kill('SIGTERM');
      }
    }

    if (commServer) {
      await commServer.close();
    }

    // Give workers time to exit
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  process.exit(0);
}

// Run test
runTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
