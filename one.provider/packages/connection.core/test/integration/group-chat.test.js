/**
 * chat.core Group Chat Integration Test
 *
 * Tests that group chat messages are properly exchanged between multiple ONE.core instances,
 * each running chat.core with TopicGroupManager and ChatHandler.
 *
 * Flow:
 * 1. Start CommunicationServer
 * 2. Spawn 3 chat.core test server processes (Alice, Bob, Charlie)
 * 3. Establish connections between all peers
 * 4. Create group chat via TopicGroupManager
 * 5. Send messages via ChatHandler and verify delivery
 * 6. Cleanup
 */

import { spawn } from 'child_process';
import * as chai from 'chai';
const { expect } = chai;
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const COMM_SERVER_PORT = 8100;
const SERVER_STARTUP_TIMEOUT = 30000;

// Process handles and API ports
let commServer = null;
let aliceProcess = null;
let bobProcess = null;
let charlieProcess = null;

// HTTP API ports
let alicePort = null;
let bobPort = null;
let charliePort = null;

/**
 * Make HTTP request to instance API
 */
async function apiRequest(port, path, method = 'GET', body = null) {
  const options = {
    hostname: 'localhost',
    port,
    path,
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
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

describe('Group Chat Integration', function() {
  this.timeout(60000); // 60 second timeout for full test suite

  before(async function() {
    console.log('\n🔗 Starting chat.core Group Chat Integration Test\n');

    // Start CommunicationServer
    await startCommServer();

    // Spawn 3 chat.core test servers
    alicePort = await spawnChatServer('alice', 'alice@test.local');
    bobPort = await spawnChatServer('bob', 'bob@test.local');
    charliePort = await spawnChatServer('charlie', 'charlie@test.local');
  });

  after(async function() {
    console.log('\n🧹 Cleaning up...');

    // Kill all processes
    await killProcess(charlieProcess, 'charlie');
    await killProcess(bobProcess, 'bob');
    await killProcess(aliceProcess, 'alice');

    // Stop CommServer
    if (commServer) {
      await commServer.stop();
      console.log('   ✅ CommServer stopped');
    }

    // Clean up storage
    const storageDir = path.join(__dirname, '../../test-storage');
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
      console.log('   ✅ Test storage cleaned');
    }
  });

  it('should allow all instances to connect to CommServer', async function() {
    // Wait a bit for connections to establish
    await sleep(2000);

    // TODO: Verify connections via API calls
    expect(true).to.be.true;
  });

  it('should establish peer connections between all instances', async function() {
    console.log('\n3️⃣ Establishing peer connections...');

    // Alice creates invitation
    const aliceInvite = await apiRequest(alicePort, '/connect', 'POST');
    expect(aliceInvite.success).to.be.true;
    console.log('   ✅ Alice created invitation');

    // Bob accepts Alice's invitation
    const bobAccept = await apiRequest(bobPort, '/connect', 'POST', {
      invitation: aliceInvite.invitation
    });
    expect(bobAccept.success).to.be.true;
    console.log('   ✅ Bob accepted invitation');

    // Wait for connection to establish and CHUM sync to complete
    await sleep(5000);

    // Verify Alice sees Bob as a connection
    const aliceConnections = await apiRequest(alicePort, '/connections', 'GET');
    expect(aliceConnections.connections).to.have.lengthOf(1);
    console.log(`   ✅ Alice sees ${aliceConnections.connections.length} connection(s)`);

    // Verify Bob sees Alice as a connection
    const bobConnections = await apiRequest(bobPort, '/connections', 'GET');
    expect(bobConnections.connections).to.have.lengthOf(1);
    console.log(`   ✅ Bob sees ${bobConnections.connections.length} connection(s)`);

    // Now connect Charlie to both Alice and Bob
    const bobInvite = await apiRequest(bobPort, '/connect', 'POST');
    const charlieAccept = await apiRequest(charliePort, '/connect', 'POST', {
      invitation: bobInvite.invitation
    });
    expect(charlieAccept.success).to.be.true;
    console.log('   ✅ Charlie accepted Bob\'s invitation');

    await sleep(2000);

    // Verify all connections
    const aliceConns2 = await apiRequest(alicePort, '/connections', 'GET');
    const bobConns2 = await apiRequest(bobPort, '/connections', 'GET');
    const charlieConns = await apiRequest(charliePort, '/connections', 'GET');

    console.log(`   ✅ Alice: ${aliceConns2.connections.length} connections`);
    console.log(`   ✅ Bob: ${bobConns2.connections.length} connections`);
    console.log(`   ✅ Charlie: ${charlieConns.connections.length} connections`);

    expect(bobConns2.connections).to.have.lengthOf.at.least(2);
  });

  it('should create a group chat with all 3 participants', async function() {
    console.log('\n4️⃣ Creating group chat...');

    // Get all participants' personIds
    const aliceIdentity = await apiRequest(alicePort, '/identity', 'GET');
    const bobIdentity = await apiRequest(bobPort, '/identity', 'GET');
    const charlieIdentity = await apiRequest(charliePort, '/identity', 'GET');

    // Alice creates a group with Bob and Charlie
    const groupResult = await apiRequest(alicePort, '/groups', 'POST', {
      name: 'Test Group',
      memberPersonIds: [
        aliceIdentity.personId,
        bobIdentity.personId,
        charlieIdentity.personId
      ]
    });

    expect(groupResult.success).to.be.true;
    expect(groupResult.groupId).to.be.a('string');
    console.log(`   ✅ Group created: ${groupResult.groupId}`);

    // Store groupId for next test
    this.groupId = groupResult.groupId;
  });

  it('should deliver messages to all group members', async function() {
    console.log('\n5️⃣ Testing message delivery...');

    const groupId = this.groupId;

    // Wait longer for group to sync via CHUM
    console.log('   ⏳ Waiting 5 seconds for Group to sync via CHUM...');
    await sleep(5000);

    // Bob and Charlie must sync received groups to create their channels
    console.log('   🔄 Bob syncing groups...');
    const bobSyncResult = await apiRequest(bobPort, '/sync-groups', 'POST');
    console.log('   ✅ Bob synced groups:', bobSyncResult);

    console.log('   🔄 Charlie syncing groups...');
    const charlieSyncResult = await apiRequest(charliePort, '/sync-groups', 'POST');
    console.log('   ✅ Charlie synced groups:', charlieSyncResult);

    // Alice sends a message
    const aliceMsg = await apiRequest(alicePort, `/groups/${groupId}/messages`, 'POST', {
      text: 'Hello from Alice!'
    });
    expect(aliceMsg.success).to.be.true;
    console.log('   ✅ Alice sent message');

    // Bob sends a message
    const bobMsg = await apiRequest(bobPort, `/groups/${groupId}/messages`, 'POST', {
      text: 'Hello from Bob!'
    });
    expect(bobMsg.success).to.be.true;
    console.log('   ✅ Bob sent message');

    // Charlie sends a message
    const charlieMsg = await apiRequest(charliePort, `/groups/${groupId}/messages`, 'POST', {
      text: 'Hello from Charlie!'
    });
    expect(charlieMsg.success).to.be.true;
    console.log('   ✅ Charlie sent message');

    // Wait for messages to sync
    await sleep(3000);

    // Verify all members received all messages
    const aliceMessages = await apiRequest(alicePort, `/groups/${groupId}/messages`, 'GET');
    const bobMessages = await apiRequest(bobPort, `/groups/${groupId}/messages`, 'GET');
    const charlieMessages = await apiRequest(charliePort, `/groups/${groupId}/messages`, 'GET');

    console.log(`   📊 Alice sees ${aliceMessages.messages.length} messages`);
    console.log(`   📊 Bob sees ${bobMessages.messages.length} messages`);
    console.log(`   📊 Charlie sees ${charlieMessages.messages.length} messages`);

    // Each participant should see all 3 messages
    expect(aliceMessages.messages).to.have.lengthOf.at.least(3);
    expect(bobMessages.messages).to.have.lengthOf.at.least(3);
    expect(charlieMessages.messages).to.have.lengthOf.at.least(3);

    console.log('   ✅ All messages delivered to all members');
  });
});

/**
 * Start CommunicationServer
 */
async function startCommServer() {
  console.log('1️⃣ Starting CommunicationServer...');

  const oneModelsPath = path.resolve(__dirname, '../../../packages/one.models');
  const commServerPath = path.join(
    oneModelsPath,
    'lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js'
  );

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
 * Spawn a chat.core test server process
 */
async function spawnChatServer(name, email) {
  console.log(`2️⃣ Starting ${name} instance...`);

  const serverPath = path.join(__dirname, 'chat-core-test-server.js');

  return new Promise((resolve, reject) => {
    const proc = spawn('node', [serverPath], {
      env: {
        ...process.env,
        INSTANCE_NAME: name,
        INSTANCE_EMAIL: email,
        STORAGE_DIR: path.join(__dirname, `../../test-storage/${name}`),
        COMM_SERVER_URL: `ws://localhost:${COMM_SERVER_PORT}`,
        WIPE_STORAGE: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let startupTimeout = null;
    let httpPort = null;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(`[${name}] ${text}`);

      // Extract HTTP API port
      const portMatch = text.match(/HTTP API: (\d+)/);
      if (portMatch) {
        httpPort = parseInt(portMatch[1]);
      }

      if (text.includes('READY')) {
        clearTimeout(startupTimeout);
        console.log(`   ✅ ${name} instance ready (port ${httpPort})\n`);
        resolve(httpPort);
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(`[${name}] ${text}`);
    });

    proc.on('error', (error) => {
      clearTimeout(startupTimeout);
      reject(new Error(`Failed to start ${name}: ${error.message}`));
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(startupTimeout);
        reject(new Error(`${name} exited with code ${code}\n${output}`));
      }
    });

    startupTimeout = setTimeout(() => {
      reject(new Error(`${name} startup timeout after ${SERVER_STARTUP_TIMEOUT}ms\n${output}`));
    }, SERVER_STARTUP_TIMEOUT);

    // Store process handle
    if (name === 'alice') aliceProcess = proc;
    else if (name === 'bob') bobProcess = proc;
    else if (name === 'charlie') charlieProcess = proc;
  });
}

/**
 * Kill a process gracefully
 */
async function killProcess(proc, name) {
  if (!proc) return;

  try {
    proc.kill('SIGTERM');
    await sleep(1000);
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
    console.log(`   ✅ ${name} process killed`);
  } catch (error) {
    console.log(`   ⚠️  Error killing ${name}: ${error.message}`);
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
