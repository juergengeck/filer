#!/usr/bin/env node
/**
 * Chat.Core Test Server - Multi-instance test harness for chat.core group chat
 *
 * Runs a single ONE.core instance with chat.core handlers.
 * Spawned as separate processes to test multi-participant group chat.
 *
 * Usage: INSTANCE_NAME=alice INSTANCE_EMAIL=alice@test.local COMM_SERVER_URL=ws://localhost:8000 node chat-core-test-server.js
 */

import '@refinio/one.core/lib/system/load-nodejs.js';
import { initInstance, getInstanceIdHash, closeInstance } from '@refinio/one.core/lib/instance.js';
import ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import ConnectionsModel from '@refinio/one.models/lib/models/ConnectionsModel.js';
import RecipesStable from '@refinio/one.models/lib/recipes/recipes-stable.js';
import RecipesExperimental from '@refinio/one.models/lib/recipes/recipes-experimental.js';
import http from 'http';

// Configuration from environment
const config = {
  instanceName: process.env.INSTANCE_NAME || 'chat-instance',
  instanceEmail: process.env.INSTANCE_EMAIL || 'test@chat.local',
  storageDir: process.env.STORAGE_DIR || `./test-storage/${process.env.INSTANCE_NAME || 'default'}`,
  commServerUrl: process.env.COMM_SERVER_URL || 'ws://localhost:8000',
  wipeStorage: process.env.WIPE_STORAGE !== 'false',
  httpPort: process.env.HTTP_PORT || 0 // 0 = random available port
};

let leuteModel = null;
let channelManager = null;
let connectionsModel = null;
let httpServer = null;
let getAllOfTypeFunc = null;
let getObjectFunc = null;

/**
 * Start HTTP API server for test control
 */
async function startHttpApi() {
  return new Promise((resolve, reject) => {
    httpServer = http.createServer(async (req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      try {
        const url = new URL(req.url, `http://localhost`);
        const path = url.pathname;

        // Debug: log all requests
        console.log(`[${config.instanceName}] HTTP ${req.method} ${path}`);

        // GET /identity - Get instance identity info
        if (path === '/identity' && req.method === 'GET') {
          const personId = await leuteModel.myMainIdentity();
          res.writeHead(200);
          res.end(JSON.stringify({
            personId: personId,
            name: config.instanceName,
            email: config.instanceEmail
          }));
          return;
        }

        // POST /connect - Create invitation or accept invitation
        if (path === '/connect' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          const data = body ? JSON.parse(body) : {};

          if (data.invitation) {
            // Connect using invitation
            console.log(`[${config.instanceName}] Connecting via invitation...`);
            try {
              const myPersonId = await leuteModel.myMainIdentity();
              const pairingResult = await connectionsModel.pairing.connectUsingInvitation(data.invitation, myPersonId);
              console.log(`[${config.instanceName}] Pairing complete, transitioning to CHUM`);

              // Transition the connection to CHUM
              await connectionsModel.transitionPairedConnectionToChum(
                pairingResult.conn,
                pairingResult.localPersonId,
                pairingResult.localInstanceId,
                pairingResult.remotePersonId,
                pairingResult.remoteInstanceId,
                true // initiatedLocally
              );

              console.log(`[${config.instanceName}] CHUM transition complete`);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
            } catch (error) {
              console.error(`[${config.instanceName}] Pairing failed:`, error);
              res.writeHead(200);
              res.end(JSON.stringify({ success: false, error: error.message }));
            }
          } else{
            // Create an invitation
            console.log(`[${config.instanceName}] Creating invitation...`);
            const invitation = await connectionsModel.pairing.createInvitation();
            console.log(`[${config.instanceName}] Invitation created`);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, invitation }));
          }
          return;
        }

        // GET /connections - List connections
        if (path === '/connections' && req.method === 'GET') {
          const others = await leuteModel.others();
          res.writeHead(200);
          res.end(JSON.stringify({
            connections: others.map(p => ({
              personId: p.personId,
              name: p.name || 'Unknown'
            }))
          }));
          return;
        }

        // POST /sync-groups - Sync received groups and create channels
        if (path === '/sync-groups' && req.method === 'POST') {
          console.log(`[${config.instanceName}] Syncing groups...`);

          // Get all Group objects accessible to us
          if (!getAllOfTypeFunc || !getObjectFunc) {
            throw new Error('Storage functions not initialized - server not ready');
          }
          const allGroups = await getAllOfTypeFunc('Group');
          console.log(`[${config.instanceName}] Found ${allGroups.length} Group objects in storage`);

          // Process each Group
          for (const groupResult of allGroups) {
            try {
              const group = await getObjectFunc(groupResult.hash);
              console.log(`[${config.instanceName}] Processing Group: ${group.name}`);
              await global.topicGroupManager.handleReceivedGroup(groupResult.idHash, group);
            } catch (error) {
              console.error(`[${config.instanceName}] Error processing group:`, error.message);
            }
          }

          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
          return;
        }

        // POST /groups - Create a new group topic
        if (path === '/groups' && req.method === 'POST') {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          const data = JSON.parse(body);

          console.log(`[${config.instanceName}] Creating group: ${data.name}`);

          // Generate unique topic ID using one.core helper
          const { createRandomString } = await import('@refinio/one.core/lib/system/crypto-helpers.js');
          const topicId = `group-${data.name.replace(/\s+/g, '-')}-${await createRandomString()}`;

          // Create group topic with participants
          await global.topicGroupManager.createGroupTopic(
            data.name,
            topicId,
            data.memberPersonIds || [],
            false // Don't auto-add CHUM connections
          );

          console.log(`[${config.instanceName}] Group created with topic ID: ${topicId}`);

          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            groupId: topicId
          }));
          return;
        }

        // POST /groups/:groupId/messages - Send message to group
        if (path.startsWith('/groups/') && path.endsWith('/messages') && req.method === 'POST') {
          const groupId = path.split('/')[2];

          let body = '';
          for await (const chunk of req) {
            body += chunk;
          }
          const data = JSON.parse(body);

          console.log(`[${config.instanceName}] Sending message to group ${groupId}: ${data.text}`);

          // Send message via ChatHandler
          const result = await global.chatCoreHandlers.chat.sendMessage({
            conversationId: groupId,
            content: data.text
          });

          res.writeHead(200);
          res.end(JSON.stringify(result));
          return;
        }

        // GET /groups/:groupId/messages - Get messages from group
        if (path.startsWith('/groups/') && path.endsWith('/messages') && req.method === 'GET') {
          const groupId = path.split('/')[2];

          console.log(`[${config.instanceName}] Getting messages from group ${groupId}`);

          // Get messages via ChatHandler
          const result = await global.chatCoreHandlers.chat.getMessages({
            conversationId: groupId,
            limit: 100
          });

          res.writeHead(200);
          res.end(JSON.stringify(result));
          return;
        }

        // 404
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (error) {
        console.error(`[${config.instanceName}] HTTP API error:`, error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    });

    httpServer.listen(config.httpPort, () => {
      const addr = httpServer.address();
      console.log(`[${config.instanceName}] HTTP API: ${addr.port}`);
      resolve();
    });

    httpServer.on('error', reject);
  });
}

async function startServer() {
  try {
    console.log(`[${config.instanceName}] Starting chat.core test server...`);
    console.log(`[${config.instanceName}]   Email: ${config.instanceEmail}`);
    console.log(`[${config.instanceName}]   Storage: ${config.storageDir}`);
    console.log(`[${config.instanceName}]   CommServer: ${config.commServerUrl}`);

    // Initialize ONE.core with recipes
    await initInstance({
      name: config.instanceName,
      email: config.instanceEmail,
      secret: 'test-secret',
      wipeStorage: config.wipeStorage,
      directory: config.storageDir,
      initialRecipes: [...RecipesStable, ...RecipesExperimental]
    });

    const instanceId = getInstanceIdHash();
    console.log(`[${config.instanceName}] ✅ ONE.core initialized: ${instanceId}`);

    // Initialize LeuteModel
    const LeuteModel = (await import('@refinio/one.models/lib/models/Leute/LeuteModel.js')).default;
    leuteModel = new LeuteModel();
    await leuteModel.init();
    console.log(`[${config.instanceName}] ✅ LeuteModel initialized`);

    // Create ChannelManager
    channelManager = new ChannelManager(leuteModel);
    await channelManager.init();
    console.log(`[${config.instanceName}] ✅ ChannelManager initialized`);

    // Initialize ConnectionsModel
    connectionsModel = new ConnectionsModel(leuteModel, {
      commServerUrl: config.commServerUrl,
      acceptIncomingConnections: true,
      acceptUnknownInstances: true,       // Accept new instances
      acceptUnknownPersons: true,         // Allow Person sync, create certs after
      allowPairing: true,                 // Enable pairing protocol
      establishOutgoingConnections: true,  // Auto-connect to discovered endpoints
      allowDebugRequests: true,
      pairingTokenExpirationDuration: 60000 * 15  // 15 minutes
    });

    // Initialize with no blacklist group
    await connectionsModel.init(null);
    console.log(`[${config.instanceName}] ✅ ConnectionsModel initialized`);

    // Note: Certificate creation happens automatically in PairingManager for existing persons
    // For new persons, profiles are created but certs are not - they'll be created when
    // Person objects sync via CHUM and trigger onConnectionsChange below
    console.log(`[${config.instanceName}] Pairing will create profiles automatically`);

    // CRITICAL: Create TrustKeysCertificates for new CHUM connections
    // Without certificates, Group objects cannot sync via CHUM
    // Track which persons we've already processed
    const processedPersons = new Set();

    connectionsModel.onConnectionsChange(async () => {
      try {
        // Small delay to let connection info settle
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get current connections from leute
        const others = await leuteModel.others();

        for (const someone of others) {
          const personId = await someone.mainIdentity();
          if (!personId) continue;

          const personIdStr = String(personId);

          // Skip if we've already processed this person
          if (processedPersons.has(personIdStr)) continue;

          console.log(`[${config.instanceName}] New connection detected: person ${personIdStr.substring(0, 8)}`);

          try {
            // Get person's profile to find keys
            const profile = await someone.mainProfile();
            if (!profile) {
              console.log(`[${config.instanceName}] No profile for person ${personIdStr.substring(0, 8)}`);
              continue;
            }

            // Get Keys object from profile
            const keysHash = profile.keys;
            if (!keysHash) {
              console.log(`[${config.instanceName}] No keys hash in profile for ${personIdStr.substring(0, 8)}`);
              continue;
            }

            // Create TrustKeysCertificate - this is REQUIRED for Group sync
            const myId = await leuteModel.myMainIdentity();
            await leuteModel.trust.certify(
              'TrustKeysCertificate',
              { data: profile.idHash, keys: keysHash },
              myId
            );

            processedPersons.add(personIdStr);
            console.log(`[${config.instanceName}] ✅ Created TrustKeysCertificate for ${personIdStr.substring(0, 8)}`);
            console.log(`[${config.instanceName}] Group objects can now sync with this person`);
          } catch (personError) {
            console.error(`[${config.instanceName}] Failed to create certificate for person ${personIdStr.substring(0, 8)}:`, personError);
          }
        }
      } catch (error) {
        console.error(`[${config.instanceName}] Failed in onConnectionsChange handler:`, error);
      }
    });
    console.log(`[${config.instanceName}] ✅ Connection certificate handler registered`);

    // Import TopicModel
    const TopicModel = (await import('@refinio/one.models/lib/models/Chat/TopicModel.js')).default;
    const topicModel = new TopicModel(channelManager, leuteModel);
    await topicModel.init();
    console.log(`[${config.instanceName}] ✅ TopicModel initialized`);

    // Import storage functions for TopicGroupManager
    const {
      storeVersionedObject,
      getObjectByIdHash,
      getAllOfType
    } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
    const {
      storeUnversionedObject,
      getObject
    } = await import('@refinio/one.core/lib/storage-unversioned-objects.js');

    // Store for HTTP handlers
    getAllOfTypeFunc = getAllOfType;
    getObjectFunc = getObject;
    const { createAccess } = await import('@refinio/one.core/lib/access.js');
    const {
      calculateIdHashOfObj,
      calculateHashOfObj
    } = await import('@refinio/one.core/lib/util/object.js');

    // Create storage dependencies for TopicGroupManager
    const storageDeps = {
      storeVersionedObject,
      storeUnversionedObject,
      getObjectByIdHash,
      getObject,
      getAllOfType,
      createAccess,
      calculateIdHashOfObj,
      calculateHashOfObj
    };

    // Get owner ID
    const { getInstanceOwnerIdHash } = await import('@refinio/one.core/lib/instance.js');
    const ownerIdHash = getInstanceOwnerIdHash();

    // Create nodeOneCore-like object for ChatHandler and TopicGroupManager
    const nodeOneCore = {
      initialized: true,
      topicModel: topicModel,
      channelManager: channelManager,
      leuteModel: leuteModel,
      ownerId: ownerIdHash,
      aiAssistantModel: null // Not needed for tests
    };

    // Initialize TopicGroupManager for dynamic group access rights
    const { TopicGroupManager } = await import('@chat/core/models/TopicGroupManager.js');
    const topicGroupManager = new TopicGroupManager(nodeOneCore, storageDeps);
    console.log(`[${config.instanceName}] ✅ TopicGroupManager initialized`);

    // Initialize group sync listener to automatically handle received Groups
    topicGroupManager.initializeGroupSyncListener();
    console.log(`[${config.instanceName}] ✅ Group sync listener initialized`);

    // Add topicGroupManager to nodeOneCore
    nodeOneCore.topicGroupManager = topicGroupManager;

    // Store globally for HTTP route access
    global.topicGroupManager = topicGroupManager;

    // Initialize chat.core handlers
    const { ChatHandler } = await import('@chat/core/handlers/ChatHandler.js');
    const chatHandler = new ChatHandler(nodeOneCore, null, null);
    console.log(`[${config.instanceName}] ✅ chat.core initialized`);

    // NOTE: Pairing event handling not needed for this test
    // ConnectionsModel uses OEvent not EventEmitter, would need .subscribe() pattern

    // Store handlers on global for test access
    global.chatCoreHandlers = {
      chat: chatHandler,
      connectionsModel,
      models: { leuteModel, channelManager }
    };

    // Start HTTP API server
    await startHttpApi();

    console.log(`[${config.instanceName}] 🚀 chat.core test server ready!`);
    console.log(`[${config.instanceName}] READY`);

    // Keep process alive
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error(`[${config.instanceName}] ❌ Failed to start:`, error);
    process.exit(1);
  }
}

async function shutdown() {
  console.log(`[${config.instanceName}] Shutting down...`);

  if (httpServer) {
    httpServer.close();
  }

  if (connectionsModel) {
    await connectionsModel.shutdown();
  }

  if (leuteModel) {
    await leuteModel.shutdown();
  }

  if (channelManager) {
    await channelManager.shutdown();
  }

  closeInstance();
  console.log(`[${config.instanceName}] ✅ Shutdown complete`);
  process.exit(0);
}

startServer().catch(error => {
  console.error(`[${config.instanceName}] Fatal error:`, error);
  process.exit(1);
});
