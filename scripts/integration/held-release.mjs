import {createAccess} from '@refinio/one.core/lib/access.js';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';
import {getStorageConsumerActionReceipt} from '@refinio/one.core/lib/storage-consumer-actions.js';
import {storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getOneWorkspaceDir} from '../../test-support/one-workspace-paths.js';

const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const {AssemblyReleasePlan} = await import(pathToFileURL(join(one, 'packages/assembly.core/dist/index.js')).href);

/** Wait for the peer to settle a specific durable exact access grant. */
export async function deliverGrant(request) {
  const access = await createAccess([request]);
  await getStorageConsumerActionReceipt(access);
}

/** Author signed cuts while holding their exact grants back from the transport. */
export function createHeldReleasePlan(runtime) {
  const signer = getInstanceOwnerIdHash();
  const held = new Map();
  const releases = new AssemblyReleasePlan({
    assemblyPlan: runtime.getAssemblyPlan(),
    async getAuthoringContext() {
      const {hash: writerPolicy} = await storeUnversionedObject({$type$: 'WriterPolicy', writers: new Set([signer])});
      return {signer, writerPolicy, signingKeys: await getDefaultKeys(signer), authoredAt: Date.now()};
    },
    async publishExactAccess(requests) {
      const withdrawals = [];
      for (const request of requests) {
        if (request.person.length) held.set(request.object, request);
        else withdrawals.push(request);
      }
      if (withdrawals.length) await createAccess(withdrawals);
    }
  });
  return {
    releases,
    async deliver(hash) {
      const request = held.get(hash);
      if (!request) throw new Error(`No held grant for cut ${hash}`);
      await deliverGrant(request);
      held.delete(hash);
    }
  };
}
