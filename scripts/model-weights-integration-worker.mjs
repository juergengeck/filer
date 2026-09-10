import '@refinio/one.core/lib/system/load-nodejs.js';
import {FilerRuntime, FileProviderOperations} from '@refinio/api/filer';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObjectByIdHash, storeVersionedObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {exists} from '@refinio/one.core/lib/system/storage-base.js';
import {normalizeFilename} from '@refinio/one.core/lib/system/nodejs/storage-base.js';
import {writeFile} from 'node:fs/promises';

const config = JSON.parse(process.env.MODEL_WEIGHTS_TEST_CONFIG);
const runtime = new FilerRuntime(config);
const fs = await runtime.init();
const rpc = new FileProviderOperations(fs, new Map(), runtime.getModelWeightsPlan().getProjection());
const plan = runtime.getModelWeightsPlan();
plan.onRevision.addListener(hash => process.send({event: 'revision', hash}));
plan.onProjectionChanged.addListener(change => process.send({event: 'projection', ...change}));
runtime.getConnectionsModel().pairing.onPairingSuccessCommitted(
  (_initiated, _localPerson, _localInstance, person) => process.send({event: 'paired', person}));

process.on('message', async ({id, method, params = {}}) => {
  try {
    let result;
    switch (method) {
      case 'publish': result = await plan.publish(params); break;
      case 'list': result = await plan.list(); break;
      case 'pin': await plan.pin(params.hash); break;
      case 'share': await plan.share(params.hash, params.person); break;
      case 'seed': result = (await storeArrayBufferAsBlob(Buffer.from(params.bytes, 'base64'))).hash; break;
      case 'exists': result = await exists(params.hash); break;
      case 'corrupt': await writeFile(normalizeFilename(params.hash), Buffer.from(params.bytes, 'base64')); break;
      case 'chunks': {
        const revision = await getObject(params.hash);
        const content = (await getObjectByIdHash(revision.content)).obj;
        result = await Promise.all(content.files.map(async ref => (await getObject(ref)).chunks));
        break;
      }
      case 'content': {
        const revision = await getObject(params.hash);
        result = (await getObjectByIdHash(revision.content)).obj;
        break;
      }
      case 'setContent': result = await storeVersionedObject(params.content); break;
      case 'rpc': result = await rpc.handle({jsonrpc: '2.0', id: 1, ...params}); break;
      case 'invite': result = await runtime.getConnectionsModel().pairing.createInvitation(); break;
      case 'pair': await runtime.getConnectionsModel().pairing.connectUsingInvitation(params.invitation); break;
      case 'stop': await runtime.shutdown(); break;
      default: throw new Error(`Unknown model integration command: ${method}`);
    }
    process.send({id, result: result ?? null});
    if (method === 'stop') process.disconnect();
  } catch (error) { process.send({id, error: error.stack ?? String(error)}); }
});
process.send({event: 'ready', person: getInstanceOwnerIdHash()});
