import '@refinio/one.core/lib/system/load-nodejs.js';
import {createFileProviderOperations, FILER_SETTINGS_MOUNT, FilerRuntime} from '@refinio/api/filer';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {isChumRootDeclined} from '@refinio/one.core/lib/chum-base.js';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getChumSyncDiagnostics, getChumSyncRootMetrics} from '@refinio/one.core/lib/chum-sync.js';
import {getDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {getStorageConsumerActionReceipt} from '@refinio/one.core/lib/storage-consumer-actions.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {exists} from '@refinio/one.core/lib/system/storage-base.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {getExistingPath, getOneWorkspaceDir} from '../../test-support/one-workspace-paths.js';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const [filerCore, {AssemblyReleasePlan}] = await Promise.all(
  ['filer.core', 'assembly.core'].map(name => import(pathToFileURL(getExistingPath(
    [join(one, 'packages', name, 'dist/index.js')], `built ${name} module`
  )).href))
);
const {FilerSnapshotStore, publishFilerShareCut, SHARES_PROJECTION_NAMESPACE} = filerCore;
const filesCategory = 'tag:category:files';
const statusDirectory = `${FILER_SETTINGS_MOUNT}/Filer`;
const heldGrants = new Map();
let runtime;
let operations;
let source;
let deferredReleases;
let cleanup = [];

/** Attach read-only evidence listeners to the actual runtime owners. */
async function start(config) {
  runtime = new FilerRuntime(config);
  await runtime.init();
  operations = createFileProviderOperations(runtime);
  const owner = getInstanceOwnerIdHash();
  const shares = runtime.getAcceptedSharesProjection();
  source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner});
  cleanup = [
    runtime.onPublishedFilesChanged(containers => {
      const settingsChanged = containers.includes(statusDirectory);
      process.send({event: 'changed', containers, pendingFiles: settingsChanged && shares.hasPendingArrivals()});
      if (settingsChanged) void reportFilesMode();
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
  return {owner, instance: getInstanceIdHash()};
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

/** Author normal signed releases while withholding only grants for the cut under test. */
function deferredReleasePlan() {
  const signer = getInstanceOwnerIdHash();
  return new AssemblyReleasePlan({
    assemblyPlan: runtime.getAssemblyPlan(),
    async getAuthoringContext() {
      const {hash: writerPolicy} = await storeUnversionedObject({$type$: 'WriterPolicy', writers: new Set([signer])});
      return {signer, writerPolicy, signingKeys: await getDefaultKeys(signer), authoredAt: Date.now()};
    },
    async publishExactAccess(requests) {
      const withdrawals = [];
      for (const request of requests) {
        if (request.person.length > 0) heldGrants.set(request.object, request);
        else withdrawals.push(request);
      }
      if (withdrawals.length > 0) await createAccess(withdrawals);
    }
  });
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
    ? (deferredReleases ??= deferredReleasePlan())
    : runtime.getAssemblyReleasePlan();
  const {assemblyHash, cutHash} = await publishFilerShareCut({
    releases, source, audience, selection, label, entries
  });
  return {assemblyHash, cutHash};
}

/** Await the peer's settlement of one exact access grant on its live CHUM lane. */
async function deliver(request) {
  const access = await createAccess([request]);
  await getStorageConsumerActionReceipt(access);
}

/** Deliver the original exact grant at the point chosen by the driver. */
async function deliverHeldCut(hash) {
  const request = heldGrants.get(hash);
  if (!request) throw new Error(`No held grant for cut ${hash}`);
  await deliver(request);
  heldGrants.delete(hash);
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
      await deliver({object, person: [audience], mode: SET_ACCESS_MODE.ADD});
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
    case 'deliverHeldCut': return await deliverHeldCut(params.hash);
    case 'deliverUnacceptedCut': return await deliver({
      object: params.hash, person: [params.audience], mode: SET_ACCESS_MODE.ADD
    });
    case 'probeProjectionImportFilter': return await probeProjectionImportFilter(params.audience);
    case 'stored': return await exists(params.hash);
    case 'demand': return await runtime.getCategoryDemandPlan().setCategoryDemand(filesCategory, true);
    case 'demanded': return await runtime.isFilesCategoryDemanded();
    case 'snapshot': return runtime.getAcceptedSharesProjection().committedSnapshot();
    case 'diagnostics': {
      const {traceEvents} = getChumSyncDiagnostics({traceLimit: 300});
      return {trace: traceEvents.filter(event => /failed|failure|error|exact-root/.test(event.event)).slice(-12),
        failures: getChumSyncRootMetrics({sinceEpochMs: 0}).serviceFailures.slice(-3)};
    }
    case 'retire': return await (deferredReleases ?? runtime.getAssemblyReleasePlan()).retireGraphReleaseSelection({
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
