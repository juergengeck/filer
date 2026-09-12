import '@refinio/one.core/lib/system/load-nodejs.js';
import {FilerRuntime, FileProviderOperations} from '@refinio/api/filer';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {storeVersionedObject, getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {readBlobAsArrayBuffer} from '@refinio/one.core/lib/storage-blob.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {isAccessibleBy, isIdAccessibleBy, isIdGrantedBy} from '@refinio/one.core/lib/accessManager.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {determineChildren} from '@refinio/one.core/lib/util/determine-children.js';
import {sign} from '../../one/packages/one.models/lib/misc/Signature.js';
import {objectEvents} from '../../one/packages/one.models/lib/misc/ObjectEventDispatcher.js';
import {FotosFileSystem} from '@refinio/fotos.core/filesystem';
import {createFotosShareManifest, createActiveFotosShareCertificate, createRevokedFotosShareCertificate,
  createFotosShareCertificateChain, buildFotosShareCertificateChainId, buildFotosShareManifestId} from '@refinio/fotos.core';
import {FilesFileSystem, FilesObjectPlan} from '../../one/packages/filer.core/dist/index.js';

const config = JSON.parse(process.env.FILER_COLLECTIONS_CONFIG);
const runtime = new FilerRuntime(config);
for (const [field, method] of [['multiUser', 'loginOrRegister'], ['leuteModel', 'init'], ['iomManager', 'init'],
  ['channelManager', 'init'], ['topicModel', 'init'], ['connectionsModel', 'init']]) {
  const target = runtime[field];
  const original = target[method].bind(target);
  target[method] = async function (...args) {
    console.log(`BOOT ${field}.${method} start`);
    const result = await original(...args);
    console.log(`BOOT ${field}.${method} complete`);
    return result;
  };
}
const fs = await runtime.init();
console.log('BOOT runtime complete');
const rpc = new FileProviderOperations(fs, new Map(), runtime.getModelWeightsPlan().getProjection(), runtime.resolveImportPath.bind(runtime));
const owner = getInstanceOwnerIdHash();
const originals = new FotosFileSystem('fotos', true);
await originals.init();
const stop = runtime.onPublishedFilesChanged(containers => process.send({event: 'changed', containers}));
runtime.getConnectionsModel().pairing.onPairingSuccessCommitted(
  (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person}));
objectEvents.onNewVersion(async result => {
  const certificate = await getObject(result.obj.certificate);
  process.send({event: result.obj.$type$, idHash: result.idHash, hash: result.hash,
    status: certificate.status, collection: certificate.scopeId});
}, 'Collection integration evidence', 'FotosShareCertificateChain');
objectEvents.onNewVersion(result => process.send({event: result.obj.$type$, idHash: result.idHash}),
  'Collection integration evidence', 'FotosShareManifest');
objectEvents.onNewVersion(result => process.send({event: result.obj.$type$, idHash: result.idHash,
  hash: result.hash, observedAt: new Date().toISOString()}),
  'Object sharing integration evidence', 'FilerObjectRoot');
objectEvents.onNewVersion(result => process.send({event: result.obj.$type$, idHash: result.idHash, hash: result.hash,
  accessId: result.obj.id, recipients: [...result.obj.person], hashGroups: [...result.obj.hashGroup],
  observedAt: new Date().toISOString()}), 'Object access integration evidence', 'IdAccess');
objectEvents.onNewVersion(result => process.send({event: result.obj.$type$, idHash: result.idHash,
  hash: result.hash, observedAt: new Date().toISOString()}),
  'Received object receipt integration evidence', 'FilerReceivedObjectsRoot');

process.on('message', async ({id, method, params = {}}) => {
  try {
    let result;
    switch (method) {
      case 'rpc': result = await rpc.handle({jsonrpc: '2.0', id: 1, ...params}); break;
      case 'objectBytes': {
        const root = (await getObjectByIdHash(params.idHash)).obj;
        const entry = await getObject(root.entry);
        result = Buffer.from(await readBlobAsArrayBuffer(entry.blob)).toString('base64');
        break;
      }
      case 'objectReadEvidence': {
        const startedAt = new Date().toISOString();
        const started = process.hrtime.bigint();
        const rootResult = await getObjectByIdHash(params.idHash);
        const rootRead = process.hrtime.bigint();
        const entry = await getObject(rootResult.obj.entry);
        const entryRead = process.hrtime.bigint();
        const bytes = Buffer.from(await readBlobAsArrayBuffer(entry.blob));
        const completed = process.hrtime.bigint();
        const milliseconds = value => Number(value) / 1e6;
        result = {content: bytes.toString('base64'), rootHash: rootResult.hash,
          entryHash: rootResult.obj.entry, blobHash: entry.blob, byteLength: bytes.length,
          timing: {startedAt, rootReadMs: milliseconds(rootRead - started),
            entryReadMs: milliseconds(entryRead - rootRead), blobReadMs: milliseconds(completed - entryRead),
            totalMs: milliseconds(completed - started)}};
        break;
      }
      case 'objectAccessEvidence': {
        const started = process.hrtime.bigint();
        const rootResult = await getObjectByIdHash(params.idHash);
        const entry = await getObject(rootResult.obj.entry);
        const [idGranted, idAccessible, rootAccessible, entryAccessible, blobAccessible] = await Promise.all([
          isIdGrantedBy(params.person, params.idHash),
          isIdAccessibleBy(params.person, params.idHash),
          isAccessibleBy(params.person, rootResult.hash),
          isAccessibleBy(params.person, rootResult.obj.entry),
          isAccessibleBy(params.person, entry.blob)
        ]);
        result = {person: params.person, idHash: params.idHash, rootHash: rootResult.hash,
          entryHash: rootResult.obj.entry, blobHash: entry.blob,
          idGranted, idAccessible, rootAccessible, entryAccessible, blobAccessible,
          observedAt: new Date().toISOString(), durationMs: Number(process.hrtime.bigint() - started) / 1e6};
        break;
      }
      case 'invite': result = await runtime.getConnectionsModel().pairing.createInvitation(); break;
      case 'pair': await runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation); break;
      case 'original': {
        await originals.importFile(params.name, Uint8Array.from(Buffer.from(params.bytes, 'base64')).buffer);
        result = [...(await getObjectByIdHash(await originals.getRootId())).obj.entries];
        break;
      }
      case 'share': {
        const scope = {kind: params.kind ?? 'collection', id: params.collection};
        const manifestId = await calculateIdHashOfObj({$type$: 'FotosShareManifest', id: buildFotosShareManifestId(owner, scope)});
        const chainId = await calculateIdHashOfObj({$type$: 'FotosShareCertificateChain', id: buildFotosShareCertificateChainId(owner, params.person, scope)});
        await createAccess([{id: manifestId, person: [params.person], mode: SET_ACCESS_MODE.ADD},
          {id: chainId, person: [params.person], mode: SET_ACCESS_MODE.ADD}]);
        const children = (await Promise.all(params.entries.map(hash => determineChildren(hash)))).flat();
        const manifest = await storeVersionedObject(createFotosShareManifest({issuer: owner, scope, entries: params.entries, snapshotChildren: children}));
        const certificate = await storeVersionedObject(createActiveFotosShareCertificate({issuer: owner, subject: params.person, scope}));
        const signature = await sign(certificate.hash, owner);
        const chain = await storeVersionedObject(createFotosShareCertificateChain({issuer: owner, subject: params.person,
          scope, certificate: certificate.hash, signature: signature.hash}));
        result = {manifest: manifest.idHash, chain: chain.idHash};
        break;
      }
      case 'revoke': {
        const scope = {kind: 'collection', id: params.collection};
        const certificate = await storeVersionedObject(createRevokedFotosShareCertificate({issuer: owner, subject: params.person,
          scope, reason: 'Collection sharing stopped'}));
        const signature = await sign(certificate.hash, owner);
        result = (await storeVersionedObject(createFotosShareCertificateChain({issuer: owner, subject: params.person,
          scope, certificate: certificate.hash, signature: signature.hash}))).idHash;
        break;
      }
      case 'filesRoot': {
        const root = await getObjectByIdHash(await new FilesFileSystem(owner).getRootId());
        result = {hash: root.hash, entries: await Promise.all([...root.obj.entries].map(hash => getObject(hash)))};
        break;
      }
      case 'receivedObjectRecords': {
        result = await new FilesObjectPlan(new FilesFileSystem(owner), owner).getReceivedRecords();
        break;
      }
      case 'stop': stop(); await runtime.shutdown(); break;
      default: throw new Error(`Unknown command ${method}`);
    }
    process.send({id, result: result ?? null});
    if (method === 'stop') process.disconnect();
  } catch (error) { process.send({id, error: error.stack ?? String(error)}); }
});
process.send({event: 'ready', person: owner, runtime: {execPath: process.execPath,
  nodeVersion: process.version, execArgv: process.execArgv, jitless: process.execArgv.includes('--jitless')}});
