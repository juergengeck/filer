#!/usr/bin/env node
/**
 * Group Chat with ObjectFilter and AffirmationCertificate Test
 *
 * Tests HashGroup filtering with AffirmationCertificate:
 * 1. Alice invites Bob and Charlie (pairing)
 * 2. Alice creates HashGroup WITHOUT certificate - verify blocked by ObjectFilter
 * 3. Alice creates HashGroup WITH AffirmationCertificate
 * 4. CHUM auto-distributes certificates and HashGroup to Bob and Charlie
 * 5. Alice establishes a group chat with Bob and Charlie
 * 6. Bob sends "hello world" message, Charlie receives
 * 7. Alice stops, Charlie sends message, Bob receives (peer-to-peer)
 *
 * Uses separate worker processes for each instance since ONE.core
 * only allows one instance per JavaScript runtime.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const TEST_TIMEOUT = 120000; // 120 seconds (2 minutes)

// Storage directory for test instances
const BASE_STORAGE_DIR = path.join(os.tmpdir(), 'test-group-chat');

// Worker process configuration
const COMM_SERVER_URL = 'ws://localhost:8100';
const ALICE_PORT = 9001;
const BOB_PORT = 9002;
const CHARLIE_PORT = 9003;

let commServer = null;
let aliceProcess = null;
let bobProcess = null;
let charlieProcess = null;

/**
 * Clean up storage directory
 */
function cleanStorage() {
  if (fs.existsSync(BASE_STORAGE_DIR)) {
    fs.rmSync(BASE_STORAGE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(BASE_STORAGE_DIR, { recursive: true });
}

/**
 * Start CommunicationServer
 */
async function startCommServer() {
  console.log('1️⃣ Starting CommServer...');

  const ONE_MODELS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/one.models');
  const commServerPath = path.join(ONE_MODELS_PATH, 'lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js');

  if (!fs.existsSync(commServerPath)) {
    throw new Error(`CommunicationServer not found at ${commServerPath}`);
  }

  const fileUrl = `file://${commServerPath}`;
  const CommunicationServerModule = await import(fileUrl);
  const CommunicationServer = CommunicationServerModule.default;

  commServer = new CommunicationServer();
  await commServer.start('localhost', 8100);

  console.log('   ✅ CommServer started on localhost:8100\n');
}

/**
 * Start a worker process
 */
async function startWorker(name, email, port) {
  console.log(`2️⃣ Starting ${name} worker...`);

  const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-object-filter-worker.js');
  const storageDir = path.join(BASE_STORAGE_DIR, name);

  const workerProcess = spawn('node', [workerPath], {
    env: {
      ...process.env,
      INSTANCE_NAME: name,
      INSTANCE_EMAIL: email,
      INSTANCE_PORT: port.toString(),
      COMM_SERVER_URL,
      STORAGE_DIR: storageDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Capture output
  workerProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });

  workerProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  // Wait for worker to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${name} worker did not start within 10 seconds`));
    }, 10000);

    workerProcess.stdout.on('data', (data) => {
      if (data.toString().includes('Ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    workerProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    workerProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`${name} worker exited with code ${code}`));
      }
    });
  });

  console.log(`   ✅ ${name} worker ready on port ${port}\n`);
  return workerProcess;
}

/**
 * HTTP request helper
 */
async function httpRequest(port, path, method = 'GET', body = null) {
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {}
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Wait for a specific event from a worker
 */
async function waitForEvent(port, eventName, timeoutMs = 30000) {
  const http = await import('http');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout waiting for event '${eventName}' from port ${port}`));
    }, timeoutMs);

    const req = http.request({
      hostname: 'localhost',
      port,
      path: '/events',
      method: 'GET',
      headers: { 'Accept': 'text/event-stream' }
    }, (res) => {
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.event === eventName) {
                clearTimeout(timeout);
                req.destroy();
                resolve(event.data);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    req.end();
  });
}

/**
 * Run the test
 */
async function runTest() {
  console.log('🔬 Group Chat with Attestation Certificate Test\n');
  console.log('='.repeat(70));

  try {
    // Clean up and prepare
    cleanStorage();

    // Start infrastructure
    await startCommServer();

    // Start worker processes
    aliceProcess = await startWorker('Alice', 'alice@test.local', ALICE_PORT);
    bobProcess = await startWorker('Bob', 'bob@test.local', BOB_PORT);
    charlieProcess = await startWorker('Charlie', 'charlie@test.local', CHARLIE_PORT);

    // 3️⃣ Get worker identities
    console.log('3️⃣ Getting worker identities...');

    const aliceStatus = await httpRequest(ALICE_PORT, '/status');
    const bobStatus = await httpRequest(BOB_PORT, '/status');
    const charlieStatus = await httpRequest(CHARLIE_PORT, '/status');

    console.log(`   👤 Alice ID: ${aliceStatus.myId.substring(0, 8)}`);
    console.log(`   👤 Bob ID: ${bobStatus.myId.substring(0, 8)}`);
    console.log(`   👤 Charlie ID: ${charlieStatus.myId.substring(0, 8)}\n`);

    // 4️⃣ Alice invites Bob and Charlie (pairing)
    console.log('4️⃣ Alice invites Bob and Charlie...');

    // Pair Alice and Bob
    const bobInvitation = await httpRequest(BOB_PORT, '/create-invitation', 'POST');
    console.log('   📧 Bob created invitation');

    const bobPairingPromise = waitForEvent(BOB_PORT, 'pairing-complete');
    const aliceBobPairingPromise = waitForEvent(ALICE_PORT, 'pairing-complete');

    await httpRequest(ALICE_PORT, '/accept-invitation', 'POST', { invitation: bobInvitation.invitation });
    console.log('   🤝 Alice connected to Bob');

    await Promise.all([bobPairingPromise, aliceBobPairingPromise]);
    console.log('   ✅ Alice-Bob pairing complete');

    // Pair Alice and Charlie
    const charlieInvitation = await httpRequest(CHARLIE_PORT, '/create-invitation', 'POST');
    console.log('   📧 Charlie created invitation');

    const charliePairingPromise = waitForEvent(CHARLIE_PORT, 'pairing-complete');
    const aliceCharliePairingPromise = waitForEvent(ALICE_PORT, 'pairing-complete');

    await httpRequest(ALICE_PORT, '/accept-invitation', 'POST', { invitation: charlieInvitation.invitation });
    console.log('   🤝 Alice connected to Charlie');

    await Promise.all([charliePairingPromise, aliceCharliePairingPromise]);
    console.log('   ✅ Alice-Charlie pairing complete\n');

    // Wait for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Debug: List channels
    console.log('\n🔍 DEBUG: Listing Alice\'s channels...');
    const aliceChannels = await httpRequest(ALICE_PORT, '/list-channels', 'GET');
    console.log(`   Alice has ${aliceChannels.count} channels`);

    console.log('\n🔍 DEBUG: Listing Bob\'s channels...');
    const bobChannels = await httpRequest(BOB_PORT, '/list-channels', 'GET');
    console.log(`   Bob has ${bobChannels.count} channels\n`);

    // 5️⃣ Alice creates HashGroup WITHOUT certificate - should be blocked
    console.log('5️⃣ Alice creates HashGroup WITHOUT certificate (testing filter)...');

    const hashGroupWithoutCertResponse = await httpRequest(ALICE_PORT, '/create-group-no-cert', 'POST', {
      person: [aliceStatus.myId, bobStatus.myId, charlieStatus.myId]
    });

    console.log(`   🔐 HashGroup created: ${hashGroupWithoutCertResponse.hashGroupHash.substring(0, 8)}`);
    console.log(`   ✅ Access rights granted to Bob and Charlie\n`);

    // Wait for CHUM to sync
    console.log('   ⏳ Waiting for CHUM to sync (10s)...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify Bob did NOT receive the HashGroup object (blocked by filter)
    const bobHashGroupCheck = await httpRequest(BOB_PORT, '/has-hashgroup', 'POST', { hashGroupHash: hashGroupWithoutCertResponse.hashGroupHash });
    if (bobHashGroupCheck.present) {
      throw new Error('❌ OBJECT FILTER FAILED: Bob received HashGroup WITHOUT certificate!');
    }
    console.log('   ✅ ObjectFilter works: HashGroup blocked without certificate\n');

    // 6️⃣ Alice creates HashGroup WITH certificates for group chat
    console.log('6️⃣ Alice creates HashGroup WITH certificate for group chat...');

    const groupResponse = await httpRequest(ALICE_PORT, '/create-group', 'POST', {
      person: [aliceStatus.myId, bobStatus.myId, charlieStatus.myId]
    });

    console.log(`   🔐 HashGroup created: ${groupResponse.hashGroupHash.substring(0, 8)}`);
    console.log(`   📜 Certificate: ${groupResponse.certificateId.substring(0, 8)}`);
    console.log(`   ✍️  Signature: ${groupResponse.signatureId.substring(0, 8)}, License: ${groupResponse.licenseId.substring(0, 8)}\n`);

    // 7️⃣ Wait for CHUM to automatically sync certificates and HashGroup
    console.log('7️⃣ Waiting for CHUM to automatically distribute certificates and HashGroup...');

    // Wait for CHUM sync
    console.log('   ⏳ Waiting for CHUM sync (20s)...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    // Check Bob received HashGroup
    console.log('   🔍 Checking if Bob received HashGroup...');
    let bobHasHashGroup = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const bobHashGroupCheck = await httpRequest(BOB_PORT, '/has-hashgroup', 'POST', { hashGroupHash: groupResponse.hashGroupHash });
      if (bobHashGroupCheck.present) {
        bobHasHashGroup = true;
        console.log(`   ✅ Bob received HashGroup after ${attempt + 1} attempts`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!bobHasHashGroup) {
      throw new Error('Bob did not receive HashGroup object with certificate');
    }

    // Check Charlie received HashGroup
    console.log('   🔍 Checking if Charlie received HashGroup...');
    let charlieHasHashGroup = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const charlieHashGroupCheck = await httpRequest(CHARLIE_PORT, '/has-hashgroup', 'POST', { hashGroupHash: groupResponse.hashGroupHash });
      if (charlieHashGroupCheck.present) {
        charlieHasHashGroup = true;
        console.log(`   ✅ Charlie received HashGroup after ${attempt + 1} attempts\n`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!charlieHasHashGroup) {
      throw new Error('Charlie did not receive HashGroup object with certificate');
    }

    // 8️⃣ Alice establishes group chat
    console.log('8️⃣ Alice establishes group chat Topic...');

    const topicResponse = await httpRequest(ALICE_PORT, '/create-topic', 'POST', {
      groupId: groupResponse.groupId,
      person: [aliceStatus.myId, bobStatus.myId, charlieStatus.myId]
    });

    console.log(`   💬 Topic created: ${topicResponse.topicId.substring(0, 8)}\n`);

    // Wait for topic setup
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 9️⃣ Bob sends "hello world"
    console.log('9️⃣ Bob sends "hello world" message...');

    await httpRequest(BOB_PORT, '/send-message', 'POST', {
      topicId: topicResponse.topicId,
      content: 'hello world'
    });
    console.log('   ✉️  Bob sent message\n');

    // Wait for message to propagate
    console.log('   ⏳ Waiting for message propagation (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 🔟 Charlie confirms receipt
    console.log('🔟 Charlie checks for Bob\'s message...');

    let charlieGotMessage = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const messages = await httpRequest(CHARLIE_PORT, '/get-messages', 'POST', {
        topicId: topicResponse.topicId
      });

      const bobMessage = messages.messages?.find(m =>
        m.author === bobStatus.myId && m.content === 'hello world'
      );

      if (bobMessage) {
        charlieGotMessage = true;
        console.log(`   ✅ Charlie received Bob's message after ${attempt + 1} attempts`);
        console.log(`   📩 Message: "${bobMessage.content}"\n`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!charlieGotMessage) {
      throw new Error('Charlie did not receive Bob\'s message');
    }

    // 1️⃣1️⃣ Stop Alice to test peer-to-peer group chat
    console.log('1️⃣1️⃣ Stopping Alice to test peer-to-peer communication...');
    if (aliceProcess) {
      aliceProcess.kill();
      console.log('   🛑 Alice stopped');
    }

    // Wait for Alice to stop
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 1️⃣2️⃣ Charlie sends message to Bob (without Alice)
    console.log('1️⃣2️⃣ Charlie sends message to Bob (Alice offline)...');

    await httpRequest(CHARLIE_PORT, '/send-message', 'POST', {
      topicId: topicResponse.topicId,
      content: 'hello from charlie'
    });
    console.log('   ✉️  Charlie sent message\n');

    // Wait for message to propagate
    console.log('   ⏳ Waiting for message propagation (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 1️⃣3️⃣ Bob confirms receipt of Charlie's message
    console.log('1️⃣3️⃣ Bob checks for Charlie\'s message...');

    let bobGotCharlieMessage = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const messages = await httpRequest(BOB_PORT, '/get-messages', 'POST', {
        topicId: topicResponse.topicId
      });

      const charlieMessage = messages.messages?.find(m =>
        m.author === charlieStatus.myId && m.content === 'hello from charlie'
      );

      if (charlieMessage) {
        bobGotCharlieMessage = true;
        console.log(`   ✅ Bob received Charlie's message after ${attempt + 1} attempts`);
        console.log(`   📩 Message: "${charlieMessage.content}"\n`);
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!bobGotCharlieMessage) {
      throw new Error('Bob did not receive Charlie\'s message (peer-to-peer failed)');
    }

    // Test Summary
    console.log('='.repeat(70));
    console.log('✅ TEST PASSED: HashGroup ObjectFilter with certificates works!');
    console.log('   1. ✅ Pairing successful (Alice-Bob, Alice-Charlie)');
    console.log('   2. ✅ ObjectFilter blocks HashGroup without certificate');
    console.log('   3. ✅ HashGroup with certificate created and distributed');
    console.log('   4. ✅ CHUM auto-distributed certificates and HashGroup');
    console.log('   5. ✅ Group chat Topic established');
    console.log('   6. ✅ Bob sent message, Charlie received');
    console.log('   7. ✅ Alice stopped');
    console.log('   8. ✅ Charlie sent message, Bob received (PEER-TO-PEER!)');
    console.log('='.repeat(70));

    process.exit(0);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (aliceProcess) {
      aliceProcess.kill();
    }
    if (bobProcess) {
      bobProcess.kill();
    }
    if (charlieProcess) {
      charlieProcess.kill();
    }
    if (commServer) {
      await commServer.close();
    }
  }

  process.exit(0);
}

// Run with timeout
const timeoutHandle = setTimeout(() => {
  console.error('\n❌ TEST TIMEOUT: Test took longer than', TEST_TIMEOUT / 1000, 'seconds');
  if (aliceProcess) aliceProcess.kill();
  if (bobProcess) bobProcess.kill();
  if (charlieProcess) charlieProcess.kill();
  process.exit(1);
}, TEST_TIMEOUT);

runTest().finally(() => {
  clearTimeout(timeoutHandle);
});
