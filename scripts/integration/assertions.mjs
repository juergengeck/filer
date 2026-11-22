import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** Invoke a native File Provider operation through the runtime's handler. */
export function rpc(worker, method, params) {
  return worker.command('rpc', {method, params});
}

/** Enumerate all pages, including the persistent projections and published roots. */
export async function enumerate(worker, container = 'workingSet') {
  const items = [];
  const seen = new Set();
  let page;
  do {
    const result = await rpc(worker, 'enumerateItems', {container, page});
    items.push(...result.items);
    page = result.nextPage;
    if (page !== undefined) {
      assert.ok(!seen.has(page), 'enumeration must advance its continuation');
      seen.add(page);
    }
  } while (page !== undefined);
  return items;
}

/** Resolve an enumerated item by stable ID and verify its exact hydrated BLOB. */
export async function assertHydration(worker, item, expectedContent) {
  assert.match(item.id, /^filer:[a-f0-9]{64}$/);
  assert.deepEqual(await rpc(worker, 'getItem', {id: item.id}), item);
  const bytes = Buffer.from(expectedContent, 'base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(item.contentVersion, sha256);
  assert.equal((await rpc(worker, 'stat', {path: item.path})).contentHash, sha256);
  const hydrated = await rpc(worker, 'readItemContent', {
    id: item.id, version: sha256, position: 0, length: bytes.length
  });
  assert.deepEqual(Buffer.from(hydrated.content, 'base64'), bytes);
  return sha256;
}
