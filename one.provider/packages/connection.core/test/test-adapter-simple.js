#!/usr/bin/env node
/**
 * Simplified Refactored Test Using CubeOneCoreAdapter
 *
 * Demonstrates connection.core's adapter pattern for cleaner ONE.core integration
 * Tests:
 * 1. Invitation-based pairing with adapter wrapper
 * 2. Group creation with certificates using adapter
 * 3. Group sharing and message exchange
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

// Polyfill WebSocket for ONE.core
global.WebSocket = WebSocket;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMM_SERVER_PORT = 8100;
const ONE_MODELS_PATH = path.resolve(__dirname, '../../packages/one.models');

// Test instances
const instances = {
  alice: {
    name: 'Alice',
    email: 'alice@test.local',
    storageDir: path.join(os.tmpdir(), 'test-adapter-simple-alice'),
    adapter: null
  },
  bob: {
    name: 'Bob',
    email: 'bob@test.local',
    storageDir: path.join(os.tmpdir(), 'test-adapter-simple-bob'),
    adapter: null
  }
};

let commServer = null;

/**
 * Clean up storage directories
 */
function cleanStorage() {
  for (const instance of Object.values(instances)) {
    if (fs.existsSync(instance.storageDir)) {
      fs.rmSync(instance.storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(instance.storageDir, { recursive: true });
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
 * Initialize ONE.core instance
 */
async function initOneCoreInstance(name, email, storageDir) {
  console.log(`2️⃣ Initializing ${name}...`);

  // Load ONE.core platform
  await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/load-nodejs.js`);
  const { initInstance } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/instance.js`);
  const { setBaseDirOrName } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/storage-base.js`);
  const { createRandomString } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/crypto-helpers.js`);

  // Import recipes
  const { CORE_RECIPES } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/recipes.js`);
  const { default: RecipesStable } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/recipes-stable.js`);
  const { default: RecipesExperimental } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/recipes-experimental.js`);
  const { ReverseMapsExperimental } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/reversemaps-experimental.js`);

  setBaseDirOrName(storageDir);

  const secret = await createRandomString(32);
  const reverseMapConfig = ReverseMapsExperimental ? [...ReverseMapsExperimental] : [];

  await initInstance({
    name,
    email,
    ownerName: name,
    secret,
    directory: storageDir,
    encryptStorage: false,
    initialRecipes: [...CORE_RECIPES, ...RecipesStable, ...RecipesExperimental],
    initiallyEnabledReverseMapTypes: new Map(reverseMapConfig)
  });

  console.log(`   ✅ ${name} ONE.core instance initialized\n`);
}

/**
 * Initialize ONE.core models and adapter for an instance
 */
async function initAdapter(instanceName) {
  console.log(`3️⃣ Initializing adapter for ${instanceName}...`);

  const { default: LeuteModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/Leute/LeuteModel.js`);
  const { default: ChannelManager } = await import(`file://${ONE_MODELS_PATH}/lib/models/ChannelManager.js`);
  const { default: ConnectionsModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/ConnectionsModel.js`);
  const { default: TopicModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/Chat/TopicModel.js`);

  const leuteModel = new LeuteModel();
  await leuteModel.init();

  const channelManager = new ChannelManager(leuteModel);
  await channelManager.init();

  const connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl: `ws://localhost:${COMM_SERVER_PORT}`,
    acceptIncomingConnections: true,
    acceptUnknownInstances: true,
    acceptUnknownPersons: false,
    allowPairing: true
  });
  await connectionsModel.init();

  const topicModel = new TopicModel(channelManager, leuteModel);
  await topicModel.init();

  // Register pairing success handler
  connectionsModel.pairing.onPairingSuccess(async (initiatedLocally, localPersonId, localInstanceId, remotePersonId, remoteInstanceId, token) => {
    console.log(`   [${instanceName}] 🤝 Pairing success with ${remotePersonId.substring(0, 8)}`);

    // Create shared 1:1 channel
    const channelId = [localPersonId, remotePersonId].sort().join('<->');
    await channelManager.createChannel(channelId, null);
    console.log(`   [${instanceName}] ✅ Created shared channel: ${channelId.substring(0, 20)}...\n`);
  });

  // Create adapter wrapping ONE.core models
  const { CubeOneCoreAdapter } = await import('../dist/esm/adapters/cube/CubeOneCoreAdapter.js');
  const adapter = new CubeOneCoreAdapter(
    leuteModel,
    channelManager,
    connectionsModel,
    topicModel
  );

  console.log(`   ✅ ${instanceName} adapter ready\n`);

  return adapter;
}

/**
 * Wait for specified time
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run the test
 */
async function runTest() {
  console.log('🔬 CubeOneCoreAdapter Simple Test\n');
  console.log('='.repeat(70));

  try {
    // Clean up and prepare
    cleanStorage();

    // Start infrastructure
    await startCommServer();

    // Initialize Alice
    await initOneCoreInstance(
      instances.alice.name,
      instances.alice.email,
      instances.alice.storageDir
    );
    instances.alice.adapter = await initAdapter('Alice');

    // Initialize Bob
    await initOneCoreInstance(
      instances.bob.name,
      instances.bob.email,
      instances.bob.storageDir
    );
    instances.bob.adapter = await initAdapter('Bob');

    // 4️⃣ Get identities using adapter
    console.log('4️⃣ Getting identities via adapter...');
    const aliceId = await instances.alice.adapter.leute.myMainIdentity();
    const bobId = await instances.bob.adapter.leute.myMainIdentity();
    console.log(`   👤 Alice ID: ${aliceId.substring(0, 8)}`);
    console.log(`   👤 Bob ID: ${bobId.substring(0, 8)}\n`);

    // 5️⃣ Establish connection using adapter
    console.log('5️⃣ Creating invitation and pairing via adapter...');

    const invitation = await instances.alice.adapter.connections.createInvitation();
    console.log(`   📧 Alice created invitation: ${invitation.substring(0, 50)}...`);

    await instances.bob.adapter.connections.acceptInvitation(invitation);
    console.log('   🤝 Bob accepted invitation');

    // Wait for pairing to complete
    console.log('   ⏳ Waiting for pairing...');
    await wait(3000);
    console.log('   ✅ Pairing complete\n');

    // 6️⃣ Alice creates Group with certificates using adapter
    console.log('6️⃣ Alice creates Group with certificates via adapter...');

    const group = await instances.alice.adapter.attestation.createGroupWithCertificate(
      'Test Group',
      [aliceId, bobId]
    );

    console.log(`   📦 Group created: ${group.groupId.substring(0, 8)}`);
    console.log(`   📜 Certificate: ${group.certificateId.substring(0, 8)}`);
    console.log(`   ✍️  Signature: ${group.signatureId.substring(0, 8)}, License: ${group.licenseId.substring(0, 8)}\n`);

    // 7️⃣ Share group with Bob using adapter
    console.log('7️⃣ Sharing group with Bob via adapter...');

    await instances.alice.adapter.attestation.shareGroupWithMember(
      bobId,
      group.groupId,
      {
        certificate: group.certificateId,
        signature: group.signatureId,
        license: group.licenseId
      }
    );
    console.log('   📤 Shared group and certificates with Bob');

    // Wait for CHUM sync
    console.log('   ⏳ Waiting for CHUM sync (15s)...');
    await wait(15000);

    // Verify Bob received group and certificates using adapter
    const bobHasGroup = await instances.bob.adapter.attestation.hasGroup(group.groupId);
    const bobHasCerts = await instances.bob.adapter.attestation.hasCertificates({
      certificate: group.certificateId,
      signature: group.signatureId,
      license: group.licenseId
    });

    console.log(`   ${bobHasGroup ? '✅' : '❌'} Bob has Group: ${bobHasGroup}`);
    console.log(`   ${bobHasCerts ? '✅' : '❌'} Bob has Certificates: ${bobHasCerts}\n`);

    if (!bobHasGroup || !bobHasCerts) {
      throw new Error('Bob did not receive Group or certificates');
    }

    // 8️⃣ Create group chat topic using adapter
    console.log('8️⃣ Creating group chat topic via adapter...');

    const topicId = await instances.alice.adapter.topics.createNewTopic(
      'Test Chat',
      [aliceId, bobId],
      group.groupId
    );

    console.log(`   💬 Topic created: ${topicId.substring(0, 8)}\n`);

    // 9️⃣ Bob sends message using adapter
    console.log('9️⃣ Bob sends message via adapter...');

    await instances.bob.adapter.topics.addMessage(topicId, 'Hello from Bob!', bobId);
    console.log('   ✉️  Bob sent message');

    // Wait for message propagation
    console.log('   ⏳ Waiting for message propagation (5s)...');
    await wait(5000);

    // 🔟 Alice reads messages using adapter
    console.log('🔟 Alice reads messages via adapter...');

    const messages = await instances.alice.adapter.topics.getMessagesForTopic(topicId);
    const bobMessage = messages.find(m => m.author === bobId && m.content === 'Hello from Bob!');

    console.log(`   ${bobMessage ? '✅' : '❌'} Alice received Bob's message: ${!!bobMessage}`);
    if (bobMessage) {
      console.log(`   📩 Message: "${bobMessage.content}"\n`);
    }

    if (!bobMessage) {
      throw new Error('Alice did not receive Bob\'s message');
    }

    // Test Summary
    console.log('='.repeat(70));
    console.log('✅ TEST PASSED: CubeOneCoreAdapter integration works!');
    console.log('   1. ✅ CubeOneCoreAdapter wraps ONE.core models cleanly');
    console.log('   2. ✅ Invitation-based pairing via adapter');
    console.log('   3. ✅ Group created with certificates via adapter');
    console.log('   4. ✅ Certificates distributed via CHUM');
    console.log('   5. ✅ Group chat topic established');
    console.log('   6. ✅ Messages sent and received via adapter');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    if (commServer) {
      await commServer.close();
    }
  }

  process.exit(0);
}

// Run test
runTest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
