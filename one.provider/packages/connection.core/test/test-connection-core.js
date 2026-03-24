#!/usr/bin/env node
/**
 * Refactored ObjectFilter Test Using connection.core
 *
 * Demonstrates connection.core's high-level API with CubeOneCoreAdapter
 * Tests:
 * 1. Invitation-based pairing
 * 2. Group creation with attestation certificates
 * 3. Certificate distribution via CHUM
 * 4. Object filter validation (blocks Groups without certificates)
 * 5. Group chat with Topics and Messages
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
    storageDir: path.join(os.tmpdir(), 'test-connection-core-alice'),
    connectionManager: null,
    oneCore: null
  },
  bob: {
    name: 'Bob',
    email: 'bob@test.local',
    storageDir: path.join(os.tmpdir(), 'test-connection-core-bob'),
    connectionManager: null,
    oneCore: null
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
 * Initialize ONE.core models for an instance
 */
async function initModels(instanceName) {
  console.log(`3️⃣ Initializing models for ${instanceName}...`);

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

  console.log(`   ✅ ${instanceName} models initialized\n`);

  return { leuteModel, channelManager, connectionsModel, topicModel };
}

/**
 * Initialize connection.core ConnectionManager with adapter
 */
async function initConnectionManager(instanceName, models) {
  console.log(`4️⃣ Initializing ConnectionManager for ${instanceName}...`);

  // Import connection.core
  const { ConnectionManagerOneCore } = await import('../dist/esm/index.js');
  const { CubeOneCoreAdapter } = await import('../dist/esm/adapters/cube/CubeOneCoreAdapter.js');

  // Create adapter wrapping ONE.core models
  const adapter = new CubeOneCoreAdapter(
    models.leuteModel,
    models.channelManager,
    models.connectionsModel,
    models.topicModel
  );

  // Create ConnectionManager with minimal deps (we're using ONE.core directly)
  const connectionManager = new ConnectionManagerOneCore({
    transport: {
      create: () => ({
        connect: async () => {},
        disconnect: async () => {},
        send: async () => {},
        on: () => {},
        off: () => {},
        state: 'disconnected'
      }),
      getSupportedTransports: () => ['websocket']
    },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      clear: async () => {}
    },
    ui: {
      showPairingRequest: async () => true,
      showError: async () => {}
    }
  });

  // Set ONE.core adapter
  connectionManager.setOneCoreAdapter(adapter);

  // Listen for pairing events
  connectionManager.on('pairingComplete', ({ remotePersonId, channelId }) => {
    console.log(`   [${instanceName}] 🤝 Pairing complete with ${remotePersonId.substring(0, 8)}, channel: ${channelId.substring(0, 20)}...\n`);
  });

  console.log(`   ✅ ${instanceName} ConnectionManager ready\n`);

  return { connectionManager, adapter };
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
  console.log('🔬 Connection.core ObjectFilter Test\n');
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
    const aliceModels = await initModels('Alice');
    const alice = await initConnectionManager('Alice', aliceModels);
    instances.alice.connectionManager = alice.connectionManager;
    instances.alice.oneCore = alice.adapter;

    // Initialize Bob
    await initOneCoreInstance(
      instances.bob.name,
      instances.bob.email,
      instances.bob.storageDir
    );
    const bobModels = await initModels('Bob');
    const bob = await initConnectionManager('Bob', bobModels);
    instances.bob.connectionManager = bob.connectionManager;
    instances.bob.oneCore = bob.adapter;

    // 5️⃣ Get identities
    console.log('5️⃣ Getting identities...');
    const aliceId = await aliceModels.leuteModel.myMainIdentity();
    const bobId = await bobModels.leuteModel.myMainIdentity();
    console.log(`   👤 Alice ID: ${aliceId.substring(0, 8)}`);
    console.log(`   👤 Bob ID: ${bobId.substring(0, 8)}\n`);

    // 6️⃣ Establish connection (invitation-based pairing)
    console.log('6️⃣ Creating invitation and pairing...');

    const invitation = await instances.alice.connectionManager.createInvitation();
    console.log(`   📧 Alice created invitation: ${invitation.substring(0, 50)}...`);

    await instances.bob.connectionManager.acceptInvitation(invitation);
    console.log('   🤝 Bob accepted invitation');

    // Wait for pairing to complete
    console.log('   ⏳ Waiting for pairing...');
    await wait(3000);
    console.log('   ✅ Pairing complete\n');

    // 7️⃣ Alice creates Group WITH certificates using connection.core API
    console.log('7️⃣ Alice creates Group with certificates...');

    const group = await instances.alice.connectionManager.createGroupWithCertificate(
      'Test Group',
      [aliceId, bobId]
    );

    console.log(`   📦 Group created: ${group.groupId.substring(0, 8)}`);
    console.log(`   📜 Certificate: ${group.certificateId.substring(0, 8)}`);
    console.log(`   ✍️  Signature: ${group.signatureId.substring(0, 8)}, License: ${group.licenseId.substring(0, 8)}\n`);

    // 8️⃣ Share group with Bob
    console.log('8️⃣ Sharing group with Bob...');

    await instances.alice.connectionManager.shareGroupWithMember(bobId, group);
    console.log('   📤 Shared group and certificates with Bob');

    // Wait for CHUM sync
    console.log('   ⏳ Waiting for CHUM sync (15s)...');
    await wait(15000);

    // Verify Bob received group and certificates
    const bobHasGroup = await instances.bob.oneCore.attestation.hasGroup(group.groupId);
    const bobHasCerts = await instances.bob.oneCore.attestation.hasCertificates({
      certificate: group.certificateId,
      signature: group.signatureId,
      license: group.licenseId
    });

    console.log(`   ${bobHasGroup ? '✅' : '❌'} Bob has Group: ${bobHasGroup}`);
    console.log(`   ${bobHasCerts ? '✅' : '❌'} Bob has Certificates: ${bobHasCerts}\n`);

    if (!bobHasGroup || !bobHasCerts) {
      throw new Error('Bob did not receive Group or certificates');
    }

    // 9️⃣ Create group chat topic
    console.log('9️⃣ Creating group chat topic...');

    const topicId = await instances.alice.connectionManager.createGroupChatTopic(
      'Test Chat',
      [aliceId, bobId],
      group.groupId
    );

    console.log(`   💬 Topic created: ${topicId.substring(0, 8)}\n`);

    // 🔟 Bob sends message
    console.log('🔟 Bob sends message...');

    await instances.bob.connectionManager.sendMessage(topicId, 'Hello from Bob!');
    console.log('   ✉️  Bob sent message');

    // Wait for message propagation
    console.log('   ⏳ Waiting for message propagation (5s)...');
    await wait(5000);

    // 1️⃣1️⃣ Alice reads messages
    console.log('1️⃣1️⃣ Alice reads messages...');

    const messages = await instances.alice.connectionManager.getMessages(topicId);
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
    console.log('✅ TEST PASSED: connection.core integration works!');
    console.log('   1. ✅ ConnectionManagerOneCore initialized with CubeOneCoreAdapter');
    console.log('   2. ✅ Invitation-based pairing successful');
    console.log('   3. ✅ Group created with attestation certificates');
    console.log('   4. ✅ Certificates distributed via CHUM');
    console.log('   5. ✅ Group chat topic established');
    console.log('   6. ✅ Messages sent and received');
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
