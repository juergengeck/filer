import '@refinio/one.core/lib/system/load-nodejs.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {getChumSyncRootMetrics, onChumExactRootImported} from '@refinio/one.core/lib/chum-sync.js';
import {onChumSyncActivity} from '@refinio/one.core/lib/chum-sync-activity.js';
import {ensureSecretSignKey} from '@refinio/one.core/lib/crypto/sign.js';
import {getDefaultKeys, getDefaultSecretKeysAsBase64} from '@refinio/one.core/lib/keychain/keychain.js';
import {hasRecipe} from '@refinio/one.core/lib/object-recipes.js';
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {uint8arrayToHexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {OperationRegistry} from '@refinio/api/registry';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getExistingPath, getOneWorkspaceDir} from '../../../test-support/one-workspace-paths.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const one = getOneWorkspaceDir(directory);
const vger = fileURLToPath(new URL('../../../../vger/', import.meta.url));

/** Load the selected production modules from the canonical sibling workspaces. */
function built(root, relativePath) {
  return import(pathToFileURL(getExistingPath([join(root, relativePath)], `built ${relativePath}`)).href);
}

const [{NativeHeadlessCore}, {CoreModule}, {default: ConnectionsModel}, assembly, filer, settings, targets,
  {SettingsRecipes}, stable, experimental, coreSources, personSources, {ConnectionPhoneBookRecipes}] = await Promise.all([
  built(vger, 'packages/vger.headless/dist/core/native-headless-core.js'),
  built(one, 'packages/vger.core/dist/modules/CoreModule.js'),
  built(one, 'packages/one.models/lib/models/ConnectionsModel.js'),
  built(one, 'packages/assembly.core/dist/index.js'),
  built(one, 'packages/filer.core/dist/index.js'),
  built(one, 'packages/settings.core/dist/storage/TargetSettingsStorage.js'),
  built(one, 'packages/settings.core/dist/types/targets.js'),
  built(one, 'packages/settings.core/dist/recipes/index.js'),
  built(one, 'packages/one.models/lib/recipes/reversemaps-stable.js'),
  built(one, 'packages/one.models/lib/recipes/reversemaps-experimental.js'),
  built(one, 'packages/source.core/dist/recipes/index.js'),
  built(one, 'packages/source.person/dist/recipes/index.js'),
  built(one, 'packages/connection.core/dist/esm/recipes/index.js')
]);
const {AssemblyPlan, AssemblyReleasePlan, AssemblyVerifier} = assembly;
let headless;
let core;
let connections;
let plan;
let releases;
let owner;
let source;
const cleanup = [];

/** Preserve every property's reverse lookup when domain recipe inventories overlap. */
function mergeReverseMaps(...inventories) {
  const result = new Map();
  for (const inventory of inventories) {
    for (const [type, properties] of inventory) {
      const merged = result.get(type) ?? new Set();
      for (const property of properties) merged.add(property);
      result.set(type, merged);
    }
  }
  return result;
}

/** Boot VGER's native identity and models before binding the Files exchange under test. */
async function start(config) {
  filer.registerFilerFolderSettings();
  headless = new NativeHeadlessCore({storageDir: config.directory, commServerUrl: config.commServerUrl,
    instanceName: config.instanceName}, {
    async loadRecipeInventory() {
      return {
        recipes: [...assembly.AssemblyCoreRecipes, ...SettingsRecipes, ...filer.FilerRecipes, ...filer.FilesRecipes,
          ...coreSources.SourceCoreRecipes, ...personSources.SourcePersonRecipes, ...ConnectionPhoneBookRecipes],
        reverseMaps: mergeReverseMaps(stable.ReverseMapsStable, experimental.ReverseMapsExperimental,
          assembly.AssemblyCoreReverseMaps, filer.FilerReverseMaps,
          coreSources.SourceCoreReverseMaps, personSources.SourcePersonReverseMaps),
        reverseMapsForIdObjects: mergeReverseMaps(stable.ReverseMapsForIdObjectsStable,
          experimental.ReverseMapsForIdObjectsExperimental),
        historyDeclarations: assembly.AssemblyReleaseHistoryDeclarations
      };
    },
    async shutdownModules() {}
  });
  await headless.initialize();
  await headless.login(config.email, config.secret);
  const state = headless.getState();
  owner = state.ownerId;
  source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner});
  await new filer.FilesFileSystem(owner).init();
  core = new CoreModule(config.commServerUrl, undefined, {createAppDataChannel: false});
  core.setDependency('OperationRegistry', new OperationRegistry());
  core.setDependency('OneCore', headless);
  await core.init();

  const writerPolicy = (await storeUnversionedObject({$type$: 'WriterPolicy', writers: new Set([owner])})).hash;
  plan = new AssemblyPlan({
    verifier: new AssemblyVerifier({owner}),
    async assertCurrentSigner(params) {
      if (params.signer !== owner || params.signingKeys !== await getDefaultKeys(owner)) {
        throw new Error('VGER Files release must use the current identity signing key');
      }
    },
    async sign() {
      return ensureSecretSignKey(Buffer.from((await getDefaultSecretKeysAsBase64(owner)).secretSignKey, 'base64'));
    }
  });
  releases = new AssemblyReleasePlan({assemblyPlan: plan, async getAuthoringContext() {
    return {writerPolicy, signer: owner, signingKeys: await getDefaultKeys(owner), authoredAt: Date.now()};
  }});
  cleanup.push(releases.registerGraphReleaseRootConsumer(async root => {
    if ((await getObject(root)).$type$ !== 'FilerShareCut') throw new Error('Expected a Files cut');
  }));
  async function admit({object, assembly: descriptor, signingKeys}) {
    if (object.audience !== owner || object.publisher !== descriptor.signer) return false;
    const keys = await getObject(signingKeys);
    return keys.$type$ === 'Keys' && keys.owner === descriptor.signer &&
      (await core.leuteModel.trust.getTrustedKeysForPerson(descriptor.signer))
        .some(key => uint8arrayToHexString(key) === keys.publicSignKey);
  }
  for (const type of ['GraphReleaseState', 'GraphReleaseSelectionHead']) {
    cleanup.push(plan.registerGenesisAdmission(type, admit));
  }
  cleanup.push(plan.registerMandatoryHandler({
    id: 'vger.integration.files-exchange',
    async handle(verified, origin, context) {
      if (origin !== 'import') return;
      const type = verified.object.$type$;
      if (type !== 'GraphReleaseState' && type !== 'GraphReleaseSelectionHead') return;
      if (!await admit(verified)) throw new Error('VGER Files release is outside the trusted publisher or audience');
      if (type === 'GraphReleaseState') await releases.observeGraphRelease(verified.hash, verified.object, owner, context);
    }
  }));
  cleanup.push(onChumExactRootImported.addListener(async event => {
    if (event.localPersonId === owner && event.root.oneType === 'Assembly') await plan.accept(event.root.hash);
  }));
  cleanup.push(plan.onAssemblyAccepted.listen((verified, origin, observation) => {
    process.send({event: 'assemblyAccepted', hash: verified.hash, type: verified.object.$type$,
      status: verified.object.status, selection: verified.object.selection,
      origin, newlyAccepted: observation.newlyAccepted});
  }));

  connections = new ConnectionsModel(core.leuteModel, {
    commServerUrl: config.commServerUrl, acceptIncomingConnections: true, acceptUnknownInstances: false,
    acceptUnknownPersons: false, allowPairing: true, establishOutgoingConnections: true,
    pairingTokenExpirationDuration: 3_600_000,
    importFilter: async (_hash, type) => hasRecipe(type)
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
  return {owner, instance: state.instanceId};
}

/** Author exact shared Files entries as the logged-in VGER identity. */
async function publish({audience, selection, label, files}) {
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
    const blob = await storeArrayBufferAsBlob(bytes.buffer);
    entries.push((await storeUnversionedObject({$type$: 'FilerStoredEntry',
      path, kind: 'file', blob: blob.hash, size: bytes.length})).hash);
  }
  const {assemblyHash} = await filer.publishFilerShareCut({releases, source, audience, selection, label, entries});
  return {assemblyHash};
}

/** Resolve the selection through VGER's accepted Frontier and read only its pinned BLOBs. */
async function readShare({publisher, selection}) {
  const source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner: publisher});
  const tip = await releases.resolveGraphReleaseSelection({source, audience: owner, publisher, selection});
  if (tip.state !== 'active') throw new Error(`Files selection is ${tip.state}`);
  const {state} = await releases.readAcceptedGraphReleaseCut(tip.currentCut);
  const files = {};
  for (const hash of state.roots) {
    const cut = await getObject(hash);
    for (const entryHash of cut.entries) {
      const entry = await getObject(entryHash);
      files[entry.path] = Buffer.from(await readBlobAsArrayBuffer(entry.blob)).toString('base64');
    }
  }
  return files;
}

/** Stop the transport before closing the model owners and instance. */
async function stop() {
  await connections?.shutdown();
  for (const unsubscribe of cleanup.splice(0)) unsubscribe();
  plan?.shutdown();
  await core?.shutdown();
  await headless?.shutdown();
}

/** Write a shared folder setting for an enrolled sibling's instance target. */
async function setFolderMode({instance, mode}) {
  const storage = new settings.TargetSettingsStorage({targetRef: targets.createInstanceTargetRef(instance),
    targetKind: 'instance', ownerPersonIdHash: owner,
    async beforeSharedModuleWrite({idHash}) {
      await createAccess([{id: idHash, person: [owner], mode: SET_ACCESS_MODE.ADD}]);
    }
  });
  const current = await storage.getSharedModule(filer.FILER_FOLDER_SETTINGS_MODULE);
  const updated = await storage.updateSharedModule(filer.FILER_FOLDER_SETTINGS_MODULE, {files: mode}, current.hash);
  return {hash: updated.hash, values: updated.values};
}

/** Dispatch worker controls through the harness IPC. */
async function run(method, params) {
  switch (method) {
    case 'start': return await start(params);
    case 'stop': return await stop();
    case 'invite': return await connections.pairing.createInvitation();
    case 'inviteDevice': return await connections.pairing.createInvitation(undefined, undefined, {
      mode: 'IoM', identityRelation: 'same-person'
    });
    case 'pair': return await connections.pairing.connectUsingInvitation(params.invitation);
    case 'publish': return await publish(params);
    case 'readShare': return await readShare(params);
    case 'setFolderMode': return await setFolderMode(params);
    case 'diagnostics': return getChumSyncRootMetrics({sinceEpochMs: 0}).serviceFailures.slice(-3);
    case 'retire': return await releases.retireGraphReleaseSelection({
      source, audience: {type: 'person', id: params.audience}, selection: params.selection
    });
    default: throw new Error(`Unknown VGER worker command: ${method}`);
  }
}

process.on('message', async ({id, method, params}) => {
  try {
    const result = await run(method, params);
    process.send({id, result}, error => { if (method === 'stop') process.exit(error ? 1 : 0); });
  } catch (error) {
    console.error(error);
    process.send({id, error: {message: error.message, code: error.code}});
  }
});

process.once('disconnect', () => {
  void stop().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
});
