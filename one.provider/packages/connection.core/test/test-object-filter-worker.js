#!/usr/bin/env node
/**
 * Group Chat Test Worker (NEW Platform)
 *
 * Full ONE.core instance with support for:
 * - Pairing
 * - Group creation with Attestation Certificates
 * - Certificate distribution via CHUM
 * - Group chat with Topic/Message
 */

import fs from 'fs';
import http from 'http';
import { WebSocket } from 'ws';

// Polyfill WebSocket
global.WebSocket = WebSocket;

const INSTANCE_NAME = process.env.INSTANCE_NAME || 'test-instance';
const INSTANCE_EMAIL = process.env.INSTANCE_EMAIL || 'test@lama.one';
const INSTANCE_PORT = parseInt(process.env.INSTANCE_PORT || '9000');
const COMM_SERVER_URL = process.env.COMM_SERVER_URL || 'ws://localhost:8100';
const STORAGE_DIR = process.env.STORAGE_DIR;
const ONE_MODELS_PATH = '/Users/gecko/src/lama/packages/one.models';

if (!STORAGE_DIR) {
  console.error('ERROR: STORAGE_DIR environment variable required');
  process.exit(1);
}

// Models and managers
let leuteModel = null;
let channelManager = null;
let connectionsModel = null;
let topicModel = null;
let server = null;
let getInstanceOwnerIdHash = null;
const eventListeners = new Map();

function emitEvent(eventName, data) {
  const message = JSON.stringify({ event: eventName, data });
  console.log(`[${INSTANCE_NAME}] 📡 Event: ${eventName}`, data);

  for (const [id, res] of eventListeners.entries()) {
    try {
      res.write(`data: ${message}\n\n`);
    } catch (error) {
      console.error(`[${INSTANCE_NAME}] Error sending event to client ${id}:`, error);
      eventListeners.delete(id);
    }
  }
}

async function initializeInstance() {
  console.log(`[${INSTANCE_NAME}] Initializing...`);

  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }

  // Import ONE.core from packages/one.models (NEW platform)
  await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/load-nodejs.js`);
  const { initInstance, getInstanceOwnerIdHash: getOwnerIdHashFn } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/instance.js`);
  getInstanceOwnerIdHash = getOwnerIdHashFn;
  const { setBaseDirOrName } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/storage-base.js`);
  const { createRandomString } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/system/crypto-helpers.js`);

  // Import recipes
  const { CORE_RECIPES } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/recipes.js`);
  const { default: RecipesStable } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/recipes-stable.js`);
  const { default: RecipesExperimental } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/recipes-experimental.js`);
  const { ReverseMapsExperimental } = await import(`file://${ONE_MODELS_PATH}/lib/recipes/reversemaps-experimental.js`);

  // Subscribe to CHUM debug channels
  const { createMessageBus } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/message-bus.js`);
  const chumExporterBus = createMessageBus('chum-exporter');
  const chumImporterBus = createMessageBus('chum-importer');
  const channelManagerBus = createMessageBus('ChannelManager');
  const objectFilterBus = createMessageBus('ObjectFilter');

  chumExporterBus.on('log', (...args) => {
    console.log(`[${INSTANCE_NAME}] 📤 CHUM-EXPORTER:`, ...args);
  });

  chumImporterBus.on('log', (...args) => {
    console.log(`[${INSTANCE_NAME}] 📥 CHUM-IMPORTER:`, ...args);
  });

  channelManagerBus.on('log', (...args) => {
    console.log(`[${INSTANCE_NAME}] 📋 CHANNEL-MGR:`, ...args);
  });

  channelManagerBus.on('debug', (...args) => {
    const message = args.join(' ');
    if (message.includes('processNewVersion') || message.includes('addChannelIfNotExist') || message.includes('CHANNEL_CONTENT')) {
      console.log(`[${INSTANCE_NAME}] 🔍 CHANNEL-MGR-DEBUG:`, ...args);
    }
  });

  // Listen to ObjectFilter bus for filtering decisions
  objectFilterBus.on('log', (...args) => {
    console.log(`[${INSTANCE_NAME}] 🔒 OBJECT-FILTER:`, ...args);
  });

  objectFilterBus.on('debug', (...args) => {
    console.log(`[${INSTANCE_NAME}] 🔍 OBJECT-FILTER-DEBUG:`, ...args);
  });

  objectFilterBus.on('info', (...args) => {
    console.log(`[${INSTANCE_NAME}] ℹ️  OBJECT-FILTER-INFO:`, ...args);
  });

  objectFilterBus.on('warn', (...args) => {
    console.log(`[${INSTANCE_NAME}] ⚠️  OBJECT-FILTER-WARN:`, ...args);
  });

  objectFilterBus.on('error', (...args) => {
    console.log(`[${INSTANCE_NAME}] ❌ OBJECT-FILTER-ERROR:`, ...args);
  });

  setBaseDirOrName(STORAGE_DIR);

  const secret = await createRandomString(32);
  const reverseMapConfig = ReverseMapsExperimental ? [...ReverseMapsExperimental] : [];

  await initInstance({
    name: INSTANCE_NAME,
    email: INSTANCE_EMAIL,
    ownerName: INSTANCE_NAME,
    secret,
    directory: STORAGE_DIR,
    encryptStorage: false,
    initialRecipes: [...CORE_RECIPES, ...RecipesStable, ...RecipesExperimental],
    initiallyEnabledReverseMapTypes: new Map(reverseMapConfig)
  });

  const ownerId = getInstanceOwnerIdHash();
  console.log(`[${INSTANCE_NAME}] 🔍 DEBUG: Owner ID after initInstance:`, ownerId);

  // Import models
  const { default: LeuteModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/Leute/LeuteModel.js`);
  const { default: ChannelManager } = await import(`file://${ONE_MODELS_PATH}/lib/models/ChannelManager.js`);
  const { default: ConnectionsModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/ConnectionsModel.js`);
  const { default: TopicModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/Chat/TopicModel.js`);

  leuteModel = new LeuteModel();
  await leuteModel.init();
  console.log(`[${INSTANCE_NAME}] ✅ LeuteModel initialized`);

  channelManager = new ChannelManager(leuteModel);
  await channelManager.init();
  console.log(`[${INSTANCE_NAME}] ✅ ChannelManager initialized (ID: ${channelManager.instanceId.substring(0, 8)})`);

  connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl: COMM_SERVER_URL,
    acceptIncomingConnections: true,
    acceptUnknownInstances: true,
    acceptUnknownPersons: false,
    allowPairing: true
  });
  await connectionsModel.init();
  console.log(`[${INSTANCE_NAME}] ✅ ConnectionsModel initialized`);

  // Import ONE.core functions for access rights
  const { getAllEntries } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/reverse-map-query.js`);
  const { getObject } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/storage-unversioned-objects.js`);

  // Register pairing success handler - Create shared 1:1 channel (no owner) and grant access rights
  connectionsModel.pairing.onPairingSuccess(async (initiatedLocally, localPersonId, localInstanceId, remotePersonId, remoteInstanceId, token) => {
    try {
      console.log(`[${INSTANCE_NAME}] 📡 Pairing success! Remote: ${remotePersonId.substring(0, 8)}`);

      // CRITICAL: Grant access rights for contact sync
      console.log(`[${INSTANCE_NAME}] 🔑 Setting up access rights...`);

      try {
        // Get remote person's Keys object
        const keys = await getAllEntries(remotePersonId, 'Keys');

        if (keys.length > 0) {
          const key = await getObject(keys[0]);

          // Create Profile with remote person's sign key
          const { default: ProfileModel } = await import(`file://${ONE_MODELS_PATH}/lib/models/Leute/ProfileModel.js`);

          const signKey = {
            $type$: 'SignKey',
            key: key.publicSignKey
          };

          const profile = await ProfileModel.constructWithNewProfile(
            remotePersonId,
            localPersonId,
            'default',
            [],
            [signKey]
          );

          // Save the profile first
          await profile.saveAndLoad();

          if (profile.loadedVersion) {
            // Certify profile with TrustKeysCertificate
            await leuteModel.trust.certify('TrustKeysCertificate', {profile: profile.loadedVersion});
            await leuteModel.trust.refreshCaches();

            // Add profile directly via addProfileFromResult - creates Someone and adds to leute.other
            const { getObjectByIdHash } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/storage-versioned-objects.js`);
            const result = await getObjectByIdHash(profile.idHash);
            await leuteModel.addProfileFromResult(result);

            console.log(`[${INSTANCE_NAME}] ✅ Contact created for ${remotePersonId.substring(0, 8)}`);
          }
        }
      } catch (err) {
        console.error(`[${INSTANCE_NAME}] ⚠️  Failed to grant access rights:`, err);
      }

      // Create shared 1:1 channel with no owner (both can read/write)
      // Channel ID is lexicographically sorted person IDs
      const channelId = [localPersonId, remotePersonId].sort().join('<->');
      await channelManager.createChannel(channelId, null);
      console.log(`[${INSTANCE_NAME}] ✅ Created shared 1:1 channel: ${channelId.substring(0, 20)}...`);

      emitEvent('pairing-complete', { remotePersonId: remotePersonId.substring(0, 8) });
    } catch (error) {
      console.error(`[${INSTANCE_NAME}] Error in pairing handler:`, error);
    }
  });
  console.log(`[${INSTANCE_NAME}] ✅ Pairing handler registered`);

  topicModel = new TopicModel(channelManager, leuteModel);
  await topicModel.init();
  console.log(`[${INSTANCE_NAME}] ✅ TopicModel initialized`);

  console.log(`[${INSTANCE_NAME}] Ready`);
}

// Create HTTP server
async function startHttpServer() {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${INSTANCE_PORT}`);

    try {
      // GET /events - Server-Sent Events
      if (url.pathname === '/events') {
        const clientId = Date.now();
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        eventListeners.set(clientId, res);

        req.on('close', () => {
          eventListeners.delete(clientId);
          console.log(`[${INSTANCE_NAME}] Event client ${clientId} disconnected`);
        });

        return;
      }

      // GET /status
      if (url.pathname === '/status') {
        const myId = await leuteModel.myMainIdentity();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready', myId }));
        return;
      }

      // GET /contacts
      if (url.pathname === '/contacts') {
        try {
          const others = await leuteModel.others();
          const contacts = [];

          for (const someone of others) {
            const mainProfile = await someone.mainProfile();
            const personId = mainProfile.personId;
            contacts.push({
              personId,
              name: personId ? personId.substring(0, 8) : 'unknown'
            });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ contacts }));
        } catch (err) {
          console.error(`[${INSTANCE_NAME}] /contacts error:`, err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message, contacts: [] }));
        }
        return;
      }

      // POST /create-invitation
      if (req.method === 'POST' && url.pathname === '/create-invitation') {
        const invitation = await connectionsModel.pairing.createInvitation();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ invitation }));
        return;
      }

      // POST /accept-invitation
      if (req.method === 'POST' && url.pathname === '/accept-invitation') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { invitation } = JSON.parse(body);
          await connectionsModel.pairing.connectUsingInvitation(invitation);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
        return;
      }

      // POST /create-group-no-cert (for testing object filter)
      // Creates HashGroup WITHOUT AffirmationCertificate to test that ObjectFilter blocks it
      if (req.method === 'POST' && url.pathname === '/create-group-no-cert') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { person } = JSON.parse(body);

          const { storeUnversionedObject } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/storage-unversioned-objects.js`);

          // Create HashGroup with person (NO certificate)
          const hashGroup = {
            $type$: 'HashGroup',
            person: new Set(person)
          };

          const hashGroupResult = await storeUnversionedObject(hashGroup);
          console.log(`[${INSTANCE_NAME}] Created HashGroup (no cert): ${hashGroupResult.hash.substring(0, 8)}`);

          // Grant access to HashGroup for all members (except creator)
          const { createAccess } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/access.js`);
          const { SET_ACCESS_MODE } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/storage-base-common.js`);

          const otherMembers = person.filter(m => m !== person[0]);

          await createAccess([{
            object: hashGroupResult.hash,
            person: otherMembers,
            group: [],
            mode: SET_ACCESS_MODE.REPLACE
          }]);
          console.log(`[${INSTANCE_NAME}] ✅ Granted access to HashGroup for ${otherMembers.length} members`);
          console.log(`[${INSTANCE_NAME}] 📡 ObjectFilter should BLOCK this HashGroup (no certificate)`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            hashGroupHash: hashGroupResult.hash
          }));
        });
        return;
      }

      // POST /create-group
      if (req.method === 'POST' && url.pathname === '/create-group') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { person } = JSON.parse(body);

          // Import one.core functions from NEW platform
          const { storeVersionedObject } = await import(`file://${ONE_MODELS_PATH}/../one.core/lib/storage-versioned-objects.js`);
          const { storeUnversionedObject } = await import(`file://${ONE_MODELS_PATH}/../one.core/lib/storage-unversioned-objects.js`);
          const { sign } = await import(`file://${ONE_MODELS_PATH}/lib/misc/Signature.js`);

          // 1. Create HashGroup object (unversioned) with person set
          const hashGroup = {
            $type$: 'HashGroup',
            person: new Set(person)  // Convert array to Set
          };

          const hashGroupResult = await storeUnversionedObject(hashGroup);
          console.log(`[${INSTANCE_NAME}] Created HashGroup: ${hashGroupResult.hash.substring(0, 8)}`);

          // 2. Create Group object (versioned) with name and hashGroup reference
          const groupName = `test-group-${Date.now()}`;
          const group = {
            $type$: 'Group',
            name: groupName,
            hashGroup: hashGroupResult.hash  // Reference to HashGroup object
          };

          const groupResult = await storeVersionedObject(group);
          const groupIdHash = groupResult.idHash;
          console.log(`[${INSTANCE_NAME}] Created Group: ${groupIdHash.substring(0, 8)}`);

          // 3. Create AffirmationLicense
          const license = {
            $type$: 'License',
            name: 'GroupAffirmation',
            description: `Affirms that HashGroup ${hashGroupResult.hash.substring(0, 8)} exists with specified members`
          };
          const licenseResult = await storeUnversionedObject(license);
          console.log(`[${INSTANCE_NAME}] Created License: ${licenseResult.hash.substring(0, 8)}`);

          // 4. Create AffirmationCertificate pointing to the HashGroup (not Group!)
          const certificate = {
            $type$: 'AffirmationCertificate',
            data: hashGroupResult.hash,  // Hash of the HashGroup object (defines members)
            license: licenseResult.hash
          };

          const certResult = await storeUnversionedObject(certificate);
          const certHash = certResult.hash;
          console.log(`[${INSTANCE_NAME}] Created AffirmationCertificate: ${certHash.substring(0, 8)}`);

          // 5. Sign the certificate
          const signatureResult = await sign(certHash, person[0]);
          console.log(`[${INSTANCE_NAME}] Created Signature result:`, JSON.stringify(signatureResult).substring(0, 200));
          const signatureHash = signatureResult.hash || signatureResult;
          console.log(`[${INSTANCE_NAME}] Created Signature: ${signatureHash.substring(0, 8)}`);

          // 6. Grant access to all objects for all members (except creator)
          const { createAccess } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/access.js`);
          const { SET_ACCESS_MODE } = await import(`file://${ONE_MODELS_PATH}/node_modules/@refinio/one.core/lib/storage-base-common.js`);

          const otherMembers = person.filter(m => m !== person[0]);

          // Grant access to certificates AND Group/HashGroup objects
          for (const objectHash of [certHash, signatureHash, licenseResult.hash, groupResult.hash, hashGroupResult.hash]) {
            await createAccess([{
              object: objectHash,
              person: otherMembers,
              group: [],
              mode: SET_ACCESS_MODE.REPLACE
            }]);
          }
          console.log(`[${INSTANCE_NAME}] ✅ Granted access to all objects for ${otherMembers.length} members`);
          console.log(`[${INSTANCE_NAME}] 📡 CHUM will automatically distribute everything`)

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            groupId: groupIdHash,
            groupHash: groupResult.hash,
            hashGroupHash: hashGroupResult.hash,  // The hash that was affirmed
            certificateId: certHash,
            signatureId: signatureHash,
            licenseId: licenseResult.hash
          }));
        });
        return;
      }

      // POST /validate-group
      if (req.method === 'POST' && url.pathname === '/validate-group') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { groupId } = JSON.parse(body);

          // Check if the Group has an affirmation certificate signed by this instance
          // Note: isAffirmedBy checks for TRUSTED signatures, which requires proper key trust setup
          // For this test, we just check if ANY affirmation exists (regardless of trust)
          const affirmers = await leuteModel.trust.affirmedBy(groupId);
          const myId = getInstanceOwnerIdHash();
          const isValid = affirmers.some(affirmer => affirmer === myId);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: isValid }));
        });
        return;
      }

      // POST /check-certificate
      if (req.method === 'POST' && url.pathname === '/check-certificate') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { objectId } = JSON.parse(body);

          // Get who has affirmed this object
          const affirmers = await leuteModel.trust.affirmedBy(objectId);
          const myId = getInstanceOwnerIdHash();
          const isAffirmedByMe = await leuteModel.trust.isAffirmedBy(objectId, myId);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            affirmedBy: affirmers,
            isAffirmedByMe
          }));
        });
        return;
      }

      // POST /post-to-channel
      if (req.method === 'POST' && url.pathname === '/post-to-channel') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { recipientId, certificateIds, groupId } = JSON.parse(body);

          // Compute shared 1:1 channel ID (lexicographically sorted)
          const myId = getInstanceOwnerIdHash();
          const targetChannelId = [myId, recipientId].sort().join('<->');

          console.log(`[${INSTANCE_NAME}] Looking for shared 1:1 channel: ${targetChannelId.substring(0, 40)}...`);

          // Verify channel exists
          const allChannelInfos = await channelManager.getMatchingChannelInfos();
          const channelExists = allChannelInfos.some(ch => ch.id === targetChannelId);

          if (!channelExists) {
            console.log(`[${INSTANCE_NAME}] Channel not found. Available channels:`, allChannelInfos.map(ch => ch.id));
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Channel not found for recipient' }));
            return;
          }

          try {
            if (certificateIds) {
              // Post certificates
              for (const certId of certificateIds) {
                await channelManager.postToChannel(targetChannelId, certId);
                console.log(`[${INSTANCE_NAME}] Posted certificate ${certId.substring(0, 8)} to channel ${targetChannelId}`);
              }
            } else if (groupId) {
              // Post Group object
              await channelManager.postToChannel(targetChannelId, groupId);
              console.log(`[${INSTANCE_NAME}] Posted Group ${groupId.substring(0, 8)} to channel ${targetChannelId}`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (postError) {
            console.error(`[${INSTANCE_NAME}] Error posting to channel:`, postError.message);
            // Re-check channel state after error
            const recheckChannels = await channelManager.getMatchingChannelInfos();
            console.error(`[${INSTANCE_NAME}] Channels after error:`, recheckChannels.map(ch => ch.id));

            // Return error response instead of crashing
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: postError.message, success: false }));
          }
        });
        return;
      }

      // GET /list-channels
      if (req.method === 'GET' && url.pathname === '/list-channels') {
        const allChannelInfos = await channelManager.getMatchingChannelInfos();
        console.log(`[${INSTANCE_NAME}] Found ${allChannelInfos.length} channels`);
        allChannelInfos.forEach((ch, i) => {
          console.log(`[${INSTANCE_NAME}] Channel ${i}: id=${ch.id?.substring(0, 8)}, owner=${ch.owner?.substring(0, 8) || 'null'}`);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          count: allChannelInfos.length,
          channels: allChannelInfos.map(ch => ({ id: ch.id, owner: ch.owner }))
        }));
        return;
      }

      // POST /has-certificates
      if (req.method === 'POST' && url.pathname === '/has-certificates') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { certificateIds } = JSON.parse(body);
          const { getObject } = await import('file:///Users/gecko/src/lama/packages/one.models/node_modules/@refinio/one.core/lib/storage-unversioned-objects.js');

          const results = await Promise.all(
            certificateIds.map(async (id) => {
              try {
                const obj = await getObject(id);
                return { id, present: obj !== null && obj !== undefined };
              } catch (error) {
                return { id, present: false };
              }
            })
          );

          const allPresent = results.every(r => r.present);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allPresent, results }));
        });
        return;
      }

      // POST /has-group
      if (req.method === 'POST' && url.pathname === '/has-group') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { groupId } = JSON.parse(body);
          const { getObjectByIdHash } = await import('file:///Users/gecko/src/lama/packages/one.models/node_modules/@refinio/one.core/lib/storage-versioned-objects.js');

          try {
            const group = await getObjectByIdHash(groupId);
            const present = group && group.$type$ === 'Group';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ present, group: present ? group : null }));
          } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ present: false, error: error.message }));
          }
        });
        return;
      }

      // POST /has-hashgroup
      if (req.method === 'POST' && url.pathname === '/has-hashgroup') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { hashGroupHash } = JSON.parse(body);
          const { getObject } = await import('file:///Users/gecko/src/lama/packages/one.models/node_modules/@refinio/one.core/lib/storage-unversioned-objects.js');

          try {
            const hashGroup = await getObject(hashGroupHash);
            const present = hashGroup && hashGroup.$type$ === 'HashGroup';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ present, hashGroup: present ? hashGroup : null }));
          } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ present: false, error: error.message }));
          }
        });
        return;
      }

      // POST /create-topic
      if (req.method === 'POST' && url.pathname === '/create-topic') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { groupId, members } = JSON.parse(body);

          // Create Topic for group chat
          const topicName = `group-chat-${Date.now()}`;
          const topicId = await topicModel.createNewTopic(topicName, members, groupId);

          console.log(`[${INSTANCE_NAME}] Created Topic: ${topicId.substring(0, 8)}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ topicId }));
        });
        return;
      }

      // POST /send-message
      if (req.method === 'POST' && url.pathname === '/send-message') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { topicId, content } = JSON.parse(body);

          const myId = await leuteModel.myMainIdentity();
          await topicModel.addMessage(topicId, content, myId);

          console.log(`[${INSTANCE_NAME}] Sent message to topic ${topicId.substring(0, 8)}: "${content}"`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
        return;
      }

      // POST /get-messages
      if (req.method === 'POST' && url.pathname === '/get-messages') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
          const { topicId } = JSON.parse(body);

          const messages = await topicModel.getMessagesForTopic(topicId);

          console.log(`[${INSTANCE_NAME}] Retrieved ${messages.length} messages from topic ${topicId.substring(0, 8)}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ messages }));
        });
        return;
      }

      // 404 Not Found
      res.writeHead(404);
      res.end('Not found');
    } catch (error) {
      console.error(`[${INSTANCE_NAME}] HTTP error:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message, stack: error.stack }));
    }
  });

  server.listen(INSTANCE_PORT, () => {
    console.log(`[${INSTANCE_NAME}] HTTP server listening on port ${INSTANCE_PORT}`);
  });
}

// Main
(async () => {
  try {
    await initializeInstance();
    await startHttpServer();
  } catch (error) {
    console.error(`[${INSTANCE_NAME}] Initialization error:`, error);
    process.exit(1);
  }
})();
