import '@refinio/one.core/lib/system/load-nodejs.js';
import {createFileProviderOperations, FilerRuntime} from '@refinio/api/filer';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getChumSyncDiagnostics} from '@refinio/one.core/lib/chum-sync.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {getExistingPath, getOneWorkspaceDir} from '../../test-support/one-workspace-paths.js';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const {publishFilerShareCut} = await import(pathToFileURL(getExistingPath(
  [join(one, 'packages/filer.core/dist/index.js')], 'built filer.core module'
)).href);
const filesCategory = 'tag:category:files';
let runtime;
let operations;
let source;
let cleanup = [];

/** Attach read-only evidence listeners to the actual runtime owners. */
async function start(config) {
  runtime = new FilerRuntime(config);
  await runtime.init();
  operations = createFileProviderOperations(runtime);
  const owner = getInstanceOwnerIdHash();
  source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner});
  cleanup = [
    runtime.onPublishedFilesChanged(containers => process.send({event: 'changed', containers})),
    runtime.getConnectionsModel().pairing.onPairingSuccessCommitted.listen(
      (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person})),
    runtime.getAssemblyPlan().onAssemblyAccepted.listen((assembly, origin, observation) => {
      const type = assembly.object.$type$;
      if (type === 'GraphReleaseState' || type === 'GraphReleaseSelectionHead') {
        process.send({event: 'assemblyAccepted', hash: assembly.hash, type, origin,
          selection: assembly.object.selection, status: assembly.object.status,
          newlyAccepted: observation.newlyAccepted});
      }
    })
  ];
  return {owner, instance: getInstanceIdHash()};
}

/** Publish real immutable entry versions and their signed Person-audience selection. */
async function publish({audience, selection, label, files}) {
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = Uint8Array.from(Buffer.from(content, 'base64'));
    const blob = await storeArrayBufferAsBlob(bytes.buffer);
    const entry = await storeUnversionedObject({$type$: 'FilerStoredEntry',
      path, kind: 'file', size: bytes.length, blob: blob.hash});
    entries.push(entry.hash);
  }
  const {assemblyHash, headStateHash} = await publishFilerShareCut({
    releases: runtime.getAssemblyReleasePlan(), source, audience, selection, label, entries
  });
  return {assemblyHash, headStateHash};
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
    case 'publish': return await publish(params);
    case 'demand': return await runtime.getCategoryDemandPlan().setCategoryDemand(filesCategory, true);
    case 'demanded': return await runtime.isFilesCategoryDemanded();
    case 'snapshot': return runtime.getAcceptedSharesProjection().committedSnapshot();
    case 'diagnostics': {
      const {traceEvents} = getChumSyncDiagnostics({traceLimit: 300});
      return traceEvents.filter(event => /failed|failure|error|exact-root/.test(event.event)).slice(-12);
    }
    case 'retire': return await runtime.getAssemblyReleasePlan().retireGraphReleaseSelection({
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
