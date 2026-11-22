import '@refinio/one.core/lib/system/load-nodejs.js';
import {getChumSyncRootMetrics} from '@refinio/one.core/lib/chum-sync.js';
import {onChumSyncActivity} from '@refinio/one.core/lib/chum-sync-activity.js';
import {implode} from '@refinio/one.core/lib/microdata-imploder.js';
import {hasRecipe} from '@refinio/one.core/lib/object-recipes.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateHashOfObj, calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {OperationRegistry} from '@refinio/api/registry';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getExistingPath, getOneWorkspaceDir} from '../../../test-support/one-workspace-paths.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const one = getOneWorkspaceDir(directory);
const vger = fileURLToPath(new URL('../../../../vger/', import.meta.url));
const edda = fileURLToPath(new URL('../../../../one.edda/', import.meta.url));

/** Require each workspace's current production build without changing its dependencies. */
function built(root, relative) {
  return import(pathToFileURL(getExistingPath([join(root, relative)], `built ${relative}`)).href);
}

const [{NativeHeadlessCore}, {CoreModule}, {default: ConnectionsModel}, stable, experimental,
  {SourceCoreRecipes, SourceCoreReverseMaps}, {SourcePersonRecipes, SourcePersonReverseMaps},
  {ConnectionPhoneBookRecipes}, {EddaHealthFiles, canReadStudyHealthFiles},
  {EDDA_EXPORT_POLICY_RULES}, {FilterGate}, {createDeniedAccess}, {Order},
  {default: PersistentFileSystemRecipes}] = await Promise.all([
  built(vger, 'packages/vger.headless/dist/core/native-headless-core.js'),
  built(one, 'packages/vger.core/dist/modules/CoreModule.js'),
  built(one, 'packages/one.models/lib/models/ConnectionsModel.js'),
  built(one, 'packages/one.models/lib/recipes/reversemaps-stable.js'),
  built(one, 'packages/one.models/lib/recipes/reversemaps-experimental.js'),
  built(one, 'packages/source.core/dist/recipes/index.js'),
  built(one, 'packages/source.person/dist/recipes/index.js'),
  built(one, 'packages/connection.core/dist/esm/recipes/index.js'),
  built(edda, 'packages/edda.core/dist/services/EddaHealthFiles.js'),
  built(edda, 'packages/edda.core/dist/sync/EddaExportPolicies.js'),
  built(one, 'packages/trust.abac/dist/services/FilterGate.js'),
  built(one, 'packages/trust.abac/dist/recipes/EffectiveAccess.js'),
  built(one, 'packages/one.models/lib/models/ChannelManager.js'),
  built(one, 'packages/one.models/lib/recipes/PersistentFileSystemRecipes.js')
]);
let headless;
let core;
let connections;
let publication;
let owner;
let patient;
let record;
let authorized = true;
const cleanup = [];

/** Merge overlapping recipe indexes without losing individual reverse properties. */
function mergeMaps(...inventories) {
  const merged = new Map();
  for (const inventory of inventories) {
    for (const [type, properties] of inventory) {
      const values = merged.get(type) ?? new Set();
      for (const property of properties) values.add(property);
      merged.set(type, values);
    }
  }
  return merged;
}

/** Read the clinical record only while the real Edda study authorization permits it. */
async function readAuthorizedFiles() {
  const allowed = await canReadStudyHealthFiles({owner, patient,
    context: {ownerId: owner, roleSubjectPersonId: owner, role: 'doctor'},
    enrollment: {isActive: true, participantRole: 'patient', issuedBy: owner},
    async isCurrentlyAssigned() { return authorized; }
  });
  return allowed ? [{hash: record.hash, type: 'DiaryEntry'}] : [];
}

/** Boot independent native ONE models and Edda's real export gate and health writer. */
async function start(config) {
  headless = new NativeHeadlessCore({storageDir: config.directory, commServerUrl: config.commServerUrl,
    instanceName: config.instanceName}, {
    async loadRecipeInventory() {
      return {
        recipes: [...PersistentFileSystemRecipes, ...SourceCoreRecipes, ...SourcePersonRecipes,
          ...ConnectionPhoneBookRecipes],
        reverseMaps: mergeMaps(stable.ReverseMapsStable, experimental.ReverseMapsExperimental,
          SourceCoreReverseMaps, SourcePersonReverseMaps),
        reverseMapsForIdObjects: mergeMaps(stable.ReverseMapsForIdObjectsStable,
          experimental.ReverseMapsForIdObjectsExperimental)
      };
    },
    async shutdownModules() {}
  });
  await headless.initialize();
  await headless.login(config.email, config.secret);
  const state = headless.getState();
  owner = state.ownerId;
  core = new CoreModule(config.commServerUrl, undefined, {createAppDataChannel: false});
  core.setDependency('OperationRegistry', new OperationRegistry());
  core.setDependency('OneCore', headless);
  await core.init();
  patient = await calculateIdHashOfObj({$type$: 'Person', email: 'health-patient@filer.test.invalid'});
  record = await storeUnversionedObject({$type$: 'DiaryEntry', entry: 'Bounded loopback health fixture',
    text: 'Exact native microdata: ä & < >\n', patientId: patient});
  publication = new EddaHealthFiles({owner, channels: core.channelManager,
    patientIds() { return [patient]; },
    async getPatientLabel() { return 'Loopback Patient'; },
    readAuthorizedFiles
  });
  const gate = new FilterGate({async getEffectiveAccess(peer) {
    return {...createDeniedAccess(peer), trustLevel: peer === owner ? 'me' : 'trusted', contexts: '["*"]'};
  }});
  gate.setCustomPolicies(EDDA_EXPORT_POLICY_RULES);
  connections = new ConnectionsModel(core.leuteModel, {
    commServerUrl: config.commServerUrl, acceptIncomingConnections: true,
    acceptUnknownInstances: false, acceptUnknownPersons: false, allowPairing: true,
    establishOutgoingConnections: true, pairingTokenExpirationDuration: 3_600_000,
    importFilter: async (_hash, type) => hasRecipe(type),
    objectFilterFactory: peer => async (_hash, type) => {
      const decision = await gate.canExportType(type, peer);
      if (!decision) throw new Error(`Health regression requires a type-only export decision for ${type}`);
      return decision.allowed;
    }
  });
  cleanup.push(connections.pairing.onPairingSuccessCommitted.listen(
    (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person})));
  const synced = new Set();
  cleanup.push(onChumSyncActivity.addListener(lanes => {
    for (const lane of lanes) {
      if (!lane.initialSyncComplete || synced.has(lane.connectionId)) continue;
      synced.add(lane.connectionId);
      process.send({event: 'chumReady', person: lane.remotePersonId});
    }
  }));
  await connections.init();
  return {owner, instance: state.instanceId, patient};
}

/** Post the Flexibel channel contract with exact binary content, or an empty current top root. */
async function publishFlexibel(content) {
  const discriminator = `flexibel:health-files:${patient}`;
  const children = [];
  if (content !== undefined) {
    const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
    const blob = await storeArrayBufferAsBlob(bytes.buffer);
    const file = await storeUnversionedObject({$type$: 'PersistentFileSystemFile', content: blob.hash});
    const folder = await storeUnversionedObject({$type$: 'PersistentFileSystemDirectory', children: [
      {path: 'exact.bin', mode: 0o100444, content: file.hash}
    ]});
    children.push({path: `Loopback Patient [${patient}]`, mode: 0o40555, content: folder.hash});
  }
  const directory = await storeUnversionedObject({$type$: 'PersistentFileSystemDirectory', children});
  const root = {$type$: 'PersistentFileSystemRoot', root: {mode: 0o40555, entry: directory.hash}};
  const channel = await core.channelManager.createChannel([owner], owner, undefined, discriminator);
  await core.channelManager.postToChannel(channel.participantsHash, root, owner, undefined, undefined, discriminator);
  return await current('flexibel');
}

/** Return exact durable producer evidence, without reading through the receiver's data browser. */
async function current(product) {
  const participants = await calculateHashOfObj({$type$: 'HashGroup', person: new Set([owner])});
  const [latest] = await core.channelManager.getObjectsWithType('PersistentFileSystemRoot', {
    owner, participants, discriminator: `${product}:health-files:${patient}`, orderBy: Order.Descending, count: 1
  });
  if (!latest) throw new Error(`No current ${product} health publication`);
  return {root: latest.dataHash, record: record.hash, patient,
    microdata: await implode(record.hash, undefined, {retainIdReferences: true})};
}

/** Drain domain publication before shutting down transport, models, and storage. */
async function stop() {
  await publication?.shutdown();
  await connections?.shutdown();
  for (const unsubscribe of cleanup.splice(0)) unsubscribe();
  await core?.shutdown();
  await headless?.shutdown();
}

/** Dispatch test fixture actions through the real owner models. */
async function command(method, params) {
  switch (method) {
    case 'start': return start(params);
    case 'stop': return stop();
    case 'invite': return connections.pairing.createInvitation();
    case 'inviteDevice': return connections.pairing.createInvitation(undefined, undefined,
      {mode: 'IoM', identityRelation: 'same-person'});
    case 'publishEdda': await publication.refresh(); return current('edda');
    case 'withdrawEdda': authorized = false; await publication.refresh(); return current('edda');
    case 'publishFlexibel': return publishFlexibel(params.content);
    case 'withdrawFlexibel': return publishFlexibel();
    case 'diagnostics': return getChumSyncRootMetrics({sinceEpochMs: 0}).serviceFailures.slice(-3);
    default: throw new Error(`Unknown health worker command: ${method}`);
  }
}

process.on('message', async ({id, method, params}) => {
  try {
    const result = await command(method, params);
    process.send({id, result}, error => { if (method === 'stop') process.exit(error ? 1 : 0); });
  } catch (error) {
    console.error(error);
    process.send({id, error: {message: error.message, code: error.code}});
  }
});
process.once('disconnect', () => {
  void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
});
