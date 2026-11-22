import '@refinio/one.core/lib/system/load-nodejs.js';
import {FilerRuntime} from '@refinio/api/filer';
import {getInstanceIdHash, getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {readFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {getOneWorkspaceDir} from '../../../test-support/one-workspace-paths.js';
import {createHeldReleasePlan} from '../held-release.mjs';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const manifest = new URL('../../../../akte/packages/akte.app/package.json', import.meta.url);
const akte = JSON.parse(await readFile(manifest, 'utf8'));
const [intake, {publishAkteCaseShare}, {AkteDokumentRecipes}, {SourceCoreRecipes, SourceCoreReverseMaps}] = await Promise.all([
  import(new URL(akte.exports['./document-intake'].import, manifest).href),
  import(new URL(akte.exports['./document-case-share'].import, manifest).href),
  import(new URL('../akte.dokument/dist/recipes.js', manifest).href),
  import(pathToFileURL(join(one, 'packages/source.core/dist/index.js')).href)
]);
let runtime;
let source;
let deferred;
let cleanup = [];

/** Use shared production CHUM hosting; Akte owns intake and case publication. */
async function start(config) {
  runtime = new FilerRuntime({...config, recipes: [...AkteDokumentRecipes, ...SourceCoreRecipes],
    reverseMaps: SourceCoreReverseMaps});
  await runtime.init();
  source = await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner: getInstanceOwnerIdHash()});
  cleanup = [
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
  return {owner: getInstanceOwnerIdHash(), instance: getInstanceIdHash()};
}

/** Store through the public intake producer, preserving its exact decision. */
async function admit({content, ...metadata}) {
  const result = await intake.intakeAkteDocument({
    storage: {storeUnversionedObject, storeVersionedObject},
    owner: getInstanceOwnerIdHash(), producer: getInstanceIdHash(),
    async storeBlob(bytes) { return (await storeArrayBufferAsBlob(bytes.slice().buffer)).hash; }
  }, {...metadata, bytes: Uint8Array.from(Buffer.from(content, 'base64'))});
  return {...result, record: await getObject(result.documentRef)};
}

/** Read only the verified, currently active, exact inbound release into intake. */
async function consume({publisher, selection}) {
  const releases = runtime.getAssemblyReleasePlan();
  const query = {source: await calculateIdHashOfObj({$type$: 'FilerFilesRoot', owner: publisher}),
    publisher, audience: getInstanceOwnerIdHash(), selection};
  const resolved = await releases.resolveGraphReleaseSelection(query);
  if (resolved.state !== 'active') throw new Error(`Inbound selection is ${resolved.state}`);
  const accepted = await releases.readAcceptedGraphReleaseCut(resolved.currentCut);
  if (!accepted) throw new Error('Inbound cut has not been accepted');
  const {assembly, state} = accepted;
  if (assembly.signer !== publisher || state.source !== query.source || state.publisher !== publisher ||
    state.audience !== query.audience || state.selection !== selection) throw new Error('Inbound cut identity mismatch');
  const results = [];
  for (const root of state.roots) {
    const cut = await getObject(root);
    if (cut.$type$ !== 'FilerShareCut') throw new Error('Inbound root is not a FilerShareCut');
    for (const ref of cut.entries) {
      const entry = await getObject(ref);
      if (entry.$type$ !== 'FilerStoredEntry' || entry.kind !== 'file' || !entry.blob) throw new Error('Inbound entry is not a file');
      const bytes = Buffer.from(await readBlobAsArrayBuffer(entry.blob));
      if (bytes.length !== entry.size) throw new Error('Inbound entry size mismatch');
      const sourcePath = entry.path.slice(1);
      const result = await admit({filename: sourcePath.split('/').at(-1), sourcePath,
        mimeType: /\.pdf$/i.test(sourcePath) ? 'application/pdf' : 'application/octet-stream',
        content: bytes.toString('base64')});
      results.push({...result, entry: ref, originalBlob: entry.blob, content: bytes.toString('base64')});
    }
  }
  return {assemblyHash: resolved.currentCut, results};
}

/** Close the production owners before ending IPC. */
async function stop() {
  for (const unsubscribe of cleanup) unsubscribe();
  cleanup = [];
  await runtime?.shutdown();
  runtime = undefined;
}

/** Dispatch only domain fixture actions and shared connection lifecycle. */
async function command(method, params) {
  switch (method) {
    case 'start': return start(params);
    case 'stop': return stop();
    case 'invite': return runtime.getConnectionsModel().pairing.createInvitation();
    case 'pair': return runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation);
    case 'intake': return admit(params);
    case 'consume': return consume(params);
    case 'probeCaseIdentity': return publishAkteCaseShare({...params,
      releases: runtime.getAssemblyReleasePlan(), source: params.source ?? source,
      owner: params.owner ?? getInstanceOwnerIdHash()});
    case 'publishCase':
    case 'publishHeadFirst': {
      const releases = method === 'publishHeadFirst' ? (deferred ??= createHeldReleasePlan(runtime)).releases : runtime.getAssemblyReleasePlan();
      const {assemblyHash, cutHash} = await publishAkteCaseShare({...params, releases, source,
        owner: getInstanceOwnerIdHash()});
      return {assemblyHash, cutHash};
    }
    case 'deliverHeldCut': return deferred.deliver(params.hash);
    case 'retire': return (deferred?.releases ?? runtime.getAssemblyReleasePlan()).retireGraphReleaseSelection({
      source, audience: {type: 'person', id: params.audience}, selection: params.selection});
    default: throw new Error(`Unknown Akte worker command: ${method}`);
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
