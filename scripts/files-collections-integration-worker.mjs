import '@refinio/one.core/lib/system/load-nodejs.js';
import {FilerRuntime, FileProviderOperations} from '@refinio/api/filer';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {storeVersionedObject, getObjectByIdHash} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {createAccess} from '@refinio/one.core/lib/access.js';
import {SET_ACCESS_MODE} from '@refinio/one.core/lib/storage-base-common.js';
import {calculateIdHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {determineChildren} from '@refinio/one.core/lib/util/determine-children.js';
import {sign} from '../../one/packages/one.models/lib/misc/Signature.js';
import {objectEvents} from '../../one/packages/one.models/lib/misc/ObjectEventDispatcher.js';
import {FotosFileSystem} from '@refinio/fotos.core/filesystem';
import {createFotosShareManifest, createActiveFotosShareCertificate, createRevokedFotosShareCertificate,
  createFotosShareCertificateChain, buildFotosShareCertificateChainId, buildFotosShareManifestId} from '@refinio/fotos.core';
import {FilesFileSystem} from '../../one/packages/filer.core/dist/index.js';

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
const rpc = new FileProviderOperations(fs, new Map(), runtime.getModelWeightsPlan().getProjection());
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

process.on('message', async ({id, method, params = {}}) => {
  try {
    let result;
    switch (method) {
      case 'rpc': result = await rpc.handle({jsonrpc: '2.0', id: 1, ...params}); break;
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
      case 'stop': stop(); await runtime.shutdown(); break;
      default: throw new Error(`Unknown command ${method}`);
    }
    process.send({id, result: result ?? null});
    if (method === 'stop') process.disconnect();
  } catch (error) { process.send({id, error: error.stack ?? String(error)}); }
});
process.send({event: 'ready', person: owner});
