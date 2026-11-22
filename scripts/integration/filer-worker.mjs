import '@refinio/one.core/lib/system/load-nodejs.js';
import {createFileProviderOperations, FILER_SETTINGS_MOUNT, FilerRuntime} from '@refinio/api/filer';
import {isChumRootDeclined} from '@refinio/one.core/lib/chum-base.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getChumSyncDiagnostics, getChumSyncRootMetrics} from '@refinio/one.core/lib/chum-sync.js';
import {onChumSyncActivity} from '@refinio/one.core/lib/chum-sync-activity.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {exists} from '@refinio/one.core/lib/system/storage-base.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {getExistingPath, getOneWorkspaceDir} from '../../test-support/one-workspace-paths.js';
import {createHeldReleasePlan, deliverGrant} from './held-release.mjs';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const {FilerSnapshotStore, publishFilerShareCut, SHARES_PROJECTION_NAMESPACE} =
  await import(pathToFileURL(getExistingPath([join(one, 'packages/filer.core/dist/index.js')],
    'built filer.core module')).href);
const filesCategory = 'tag:category:files';
const statusDirectory = `${FILER_SETTINGS_MOUNT}/Filer`;
let runtime;
let operations;
let source;
let deferred;
let cleanup = [];
let watchingHealth = false;
let healthReports = Promise.resolve();

/** Attach read-only evidence listeners to the actual runtime owners. */
async function start(config) {
  runtime = new FilerRuntime(config);
  await runtime.init();
  operations = createFileProviderOperations(runtime);
  const owner = getInstanceOwnerIdHash();
  const shares = runtime.getAcceptedSharesProjection();
  const pictures = runtime.getAcceptedPictureSharesProjection();
  source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner});
  cleanup = [
    runtime.onPublishedFilesChanged(containers => {
      const settingsChanged = containers.includes(statusDirectory);
      process.send({event: 'changed', containers, pendingFiles: settingsChanged && shares.hasPendingArrivals(),
        pendingPictures: settingsChanged && pictures.hasPendingArrivals()});
      if (settingsChanged) void reportFilesMode();
      if (watchingHealth) queueHealthState();
    }),
    runtime.getConnectionsModel().pairing.onPairingSuccessCommitted.listen(
      (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person})),
    runtime.getAssemblyPlan().onAssemblyAccepted.listen((assembly, origin, observation) => {
      const type = assembly.object.$type$;
      if (type === 'GraphReleaseState' || type === 'GraphReleaseSelectionHead') {
        process.send({event: 'assemblyAccepted', hash: assembly.hash, type, origin,
          selection: assembly.object.selection, status: assembly.object.status,
          currentCut: assembly.object.currentCut,
          newlyAccepted: observation.newlyAccepted});
      }
    })
  ];
  const synced = new Set();
  cleanup.push(onChumSyncActivity.addListener(lanes => {
    for (const lane of lanes) {
      if (!lane.initialSyncComplete || synced.has(lane.connectionId)) continue;
      synced.add(lane.connectionId);
      process.send({event: 'chumReady', person: lane.remotePersonId});
    }
  }));
  return {owner, instance: getInstanceIdHash()};
}

/** Serialize native health observations in response to production invalidations only. */
function queueHealthState() {
  healthReports = healthReports.then(reportHealthState).catch(error => {
    console.error('Native health observation failed', error);
    throw error;
  });
  return healthReports;
}

/** Observe health visibility through the same readDir operations served to Finder. */
async function reportHealthState() {
  async function readDir(path) {
    const reply = await operations.handle({jsonrpc: '2.0', id: null, method: 'readDir', params: {path}});
    if (reply.error) throw new Error(reply.error.message);
    return reply.result.children;
  }
  const visible = (await readDir('/')).includes('Gesundheit');
  const paths = [];
  if (visible) {
    for (const product of await readDir('/Gesundheit')) {
      const productPath = `/Gesundheit/${product}`;
      paths.push(productPath);
      for (const patient of await readDir(productPath)) {
        const patientPath = `${productPath}/${patient}`;
        paths.push(patientPath);
        for (const file of await readDir(patientPath)) paths.push(`${patientPath}/${file}`);
      }
    }
  }
  process.send({event: 'healthState', visible, paths});
}

/** Report the mode from the same status file exposed to the native provider. */
async function reportFilesMode() {
  const response = await operations.handle({jsonrpc: '2.0', id: null, method: 'readFile',
    params: {path: `${statusDirectory}/status.json`}});
  if (response.error) throw new Error(response.error.message);
  const status = JSON.parse(Buffer.from(response.result.content, 'base64').toString('utf8'));
  const files = status.folders.find(folder => folder.id === 'files');
  process.send({event: 'filesMode', mode: files.mode, visible: files.visible});
}

/** Publish real immutable entry versions and their signed Person-audience selection. */
async function publish({audience, selection, label, files}, deferCut = false) {
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
    const blob = await storeArrayBufferAsBlob(bytes.buffer);
    const entry = await storeUnversionedObject({$type$: 'FilerStoredEntry',
      path, kind: 'file', size: bytes.length, blob: blob.hash});
    entries.push(entry.hash);
  }
  const releases = deferCut
    ? (deferred ??= createHeldReleasePlan(runtime)).releases
    : runtime.getAssemblyReleasePlan();
  const {assemblyHash, cutHash} = await publishFilerShareCut({
    releases, source, audience, selection, label, entries
  });
  return {assemblyHash, cutHash};
}

/** Offer separately authorized, valid projection fixtures claiming the recipient's ownership. */
async function probeProjectionImportFilter(audience) {
  const namespace = SHARES_PROJECTION_NAMESPACE;
  const store = new FilerSnapshotStore(audience, namespace, async () => {
    throw new Error('The projection fixture only prepares a snapshot');
  });
  const snapshot = await store.prepare([{
    key: 'peer-projection-fixture', name: 'Geteilt', path: '/Files/Geteilt', kind: 'directory', size: 0
  }]);
  const {items: [item], delta} = await getObject(snapshot);
  const {hash: head} = await storeVersionedObject({$type$: 'FilerProjectionHead', owner: audience, namespace, snapshot});
  const fixtures = {FilerProjectionHead: head, FilerSnapshot: snapshot, FilerDelta: delta, FilerItem: item};
  for (const [type, object] of Object.entries(fixtures)) {
    try {
      await deliverGrant({object, person: [audience], mode: SET_ACCESS_MODE.ADD});
    } catch (error) {
      if (isChumRootDeclined(error)) continue;
      throw error;
    }
    throw new Error(`CHUM did not decline ${type} ${object}`);
  }
  return fixtures;
}

/** Release network and storage before closing the worker's IPC channel. */
async function stop() {
  for (const unsubscribe of cleanup) unsubscribe();
  cleanup = [];
  await healthReports;
  await runtime?.shutdown();
  runtime = undefined;
}

/** Dispatch either a native File Provider request or an explicit test fixture action. */
async function command(method, params, id) {
  switch (method) {
    case 'start': return await start(params);
    case 'stop': return await stop();
    case 'invite': return await runtime.getConnectionsModel().pairing.createInvitation();
    case 'pair': return await runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation);
    case 'enroll': return await runtime.getConnectionsModel().pairing.acceptDeviceEnrollment(params.invitation, params.owner);
    case 'publishWeights': return await runtime.getModelWeightsPlan().publish(params);
    case 'publish': return await publish(params);
    case 'publishHeadFirst': return await publish(params, true);
    case 'deliverHeldCut': return await deferred.deliver(params.hash);
    case 'deliverUnacceptedCut': return await deliverGrant({
      object: params.hash, person: [params.audience], mode: SET_ACCESS_MODE.ADD
    });
    case 'probeProjectionImportFilter': return await probeProjectionImportFilter(params.audience);
    case 'stored': return await exists(params.hash);
    case 'watchHealth': watchingHealth = true; return await queueHealthState();
    case 'demand': return await runtime.getCategoryDemandPlan().setCategoryDemand(filesCategory, true);
    case 'demandPictures': return await runtime.getCategoryDemandPlan().setCategoryDemand('tag:category:pictures', true);
    case 'demanded': return await runtime.isFilesCategoryDemanded();
    case 'snapshot': return runtime.getAcceptedSharesProjection().committedSnapshot();
    case 'diagnostics': {
      const {traceEvents} = getChumSyncDiagnostics({traceLimit: 300});
      return {trace: traceEvents.filter(event => /failed|failure|error|exact-root/.test(event.event)).slice(-12),
        failures: getChumSyncRootMetrics({sinceEpochMs: 0}).serviceFailures.slice(-3)};
    }
    case 'retire': return await (deferred?.releases ?? runtime.getAssemblyReleasePlan()).retireGraphReleaseSelection({
      source, audience: {type: 'person', id: params.audience}, selection: params.selection
    });
    case 'rpc': {
      const response = await operations.handle({jsonrpc: '2.0', id, ...params});
      if (response.error) throw Object.assign(new Error(response.error.message), {code: response.error.code});
      return response.result;
    }
    default: throw new Error(`Unknown Filer worker command: ${method}`);
  }
}

process.on('message', async ({id, method, params}) => {
  try {
    const result = await command(method, params, id);
    process.send({id, result}, error => {
      if (method === 'stop') process.exit(error ? 1 : 0);
    });
  } catch (error) {
    if (method !== 'rpc') console.error(error);
    process.send({id, error: {message: error.message, code: error.code}});
  }
});

process.once('disconnect', () => {
  void stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
});
