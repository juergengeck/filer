import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {withHarness} from './harness.mjs';
import {assertHydration, enumerate, rpc} from './assertions.mjs';

const {values: {report}} = parseArgs({options: {report: {type: 'string'}}});
const workerEntry = new URL('./filer-worker.mjs', import.meta.url);
const selection = 'files-chum-baseline';
const shareRoot = '/Files/Geteilt';
const statusDirectory = '/ONE/System/settings/Filer';
const traceEntries = [];
const started = performance.now();

/** Emit structured evidence as each owning transition is verified. */
function trace(event, fields = {}) {
  const evidence = {elapsedMs: performance.now() - started, ...fields};
  traceEntries.push({event, ...evidence});
  console.log(`TRACE ${event} ${JSON.stringify(evidence)}`);
}

/** Read the same share through the native working set and the path filesystem. */
async function sharedItems(worker) {
  return (await enumerate(worker)).filter(item =>
    item.path === shareRoot || item.path.startsWith(shareRoot + '/'));
}

/** Prove the share has no published folders or items. */
async function assertHidden(worker) {
  assert.ok(!(await rpc(worker, 'readDir', {path: '/Files'})).children.includes('Geteilt'));
  assert.deepEqual(await sharedItems(worker), []);
}

/** Find exactly one appearance of a named fixture, under the peer share. */
function itemNamed(items, pathSuffix) {
  const matches = items.filter(item => item.path.endsWith(pathSuffix));
  assert.equal(matches.length, 1, `expected one working-set appearance for ${pathSuffix}`);
  return matches[0];
}

/** Observe the verified recipient import without invoking acceptance from the test. */
function accepted(worker, type, status) {
  return worker.event('assemblyAccepted', message =>
    message.type === type && message.selection === selection && message.origin === 'import' &&
    message.newlyAccepted && message.status === status, `imported ${status ?? 'cut'} ${type}`);
}

/** Wait for the production invalidation of a working set or a specific tracked directory. */
function changed(worker, container = 'workingSet') {
  return worker.event('changed', message => message.containers.includes(container), `invalidation of ${container}`);
}

/** Pair both stores and wait for each side to commit the authenticated contact. */
async function pair(source, recipient) {
  const invitation = await source.command('invite');
  await Promise.all([
    source.event('paired', message => message.person === recipient.identity.owner),
    recipient.event('paired', message => message.person === source.identity.owner),
    recipient.command('pair', {invitation})
  ]);
}

/** Read the category decision published by the folder registry. */
async function filesReasons(worker) {
  const {content} = await rpc(worker, 'readFile', {path: statusDirectory + '/status.json'});
  const status = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
  return status.folders.find(folder => folder.id === 'files').reasons;
}

/** Commit and import the selection head while its cut Assembly stays with the publisher. */
async function publishHeadFirst(source, recipient, fixture) {
  const [head, , publication] = await Promise.all([
    accepted(recipient, 'GraphReleaseSelectionHead', 'active'),
    recipient.event('changed', message => message.pendingFiles, 'pending Files selection status'),
    source.command('publishHeadFirst', fixture)
  ]);
  assert.equal(head.currentCut, publication.assemblyHash);
  assert.equal(await recipient.command('stored', {hash: publication.assemblyHash}), false);
  assert.ok((await filesReasons(recipient)).includes('peer-file-shares-pending'));
  return {head: head.hash, ...publication};
}

/** Keep binary fixtures portable across the worker's JSON IPC channel. */
function content(text) {
  return Buffer.from(text).toString('base64');
}

try {
  await withHarness(async harness => {
    const source = await harness.start(workerEntry, 'source');
    const recipient = await harness.start(workerEntry, 'recipient');
    const audience = recipient.identity.owner;
    assert.notEqual(source.identity.owner, audience);
    assert.notEqual(source.identity.instance, recipient.identity.instance);
    trace('workers-ready');

    await pair(source, recipient);
    await assertHidden(recipient);
    assert.equal(await recipient.command('demanded'), false);
    trace('paired-without-visibility');

    const label = 'Published Files';
    const firstBytes = content('first version\0\u00e4\n');
    const [cut, head, , firstPublication] = await Promise.all([
      accepted(recipient, 'GraphReleaseState'),
      accepted(recipient, 'GraphReleaseSelectionHead', 'active'),
      changed(recipient, statusDirectory),
      source.command('publish', {audience, selection, label,
        files: {'/shared/a.txt': firstBytes, '/shared/b.txt': content('remove this')}})
    ]).catch(async error => {
      console.error('Recipient CHUM diagnostics', JSON.stringify(await recipient.command('diagnostics')));
      throw error;
    });
    assert.equal(cut.hash, firstPublication.assemblyHash);
    await assertHidden(recipient);
    assert.ok((await filesReasons(recipient)).includes('peer-file-shares-awaiting-demand'));
    trace('imported-before-demand', {cut: cut.hash, head: head.hash, origin: cut.origin});

    await Promise.all([changed(recipient, statusDirectory), recipient.command('demand')]);
    const visible = await sharedItems(recipient);
    const first = itemNamed(visible, '/shared/a.txt');
    const removed = itemNamed(visible, '/shared/b.txt');
    assert.ok(first.path.endsWith(`/${label}/shared/a.txt`));
    const firstSha = await assertHydration(recipient, first, firstBytes);
    assert.deepEqual((await rpc(recipient, 'readDir', {path: first.path.slice(0, -'/a.txt'.length)})).children.sort(),
      ['a.txt', 'b.txt']);
    await assert.rejects(rpc(recipient, 'unlink', {path: first.path}), {code: -30});
    await assert.rejects(rpc(recipient, 'createFile', {
      path: '/Files', fileHash: firstSha, fileName: 'Geteilt', mode: 0o100666
    }), {code: -30});
    trace('demand-hydrated', {id: first.id, sha256: firstSha});

    const container = first.parentId;
    const {anchor} = await rpc(recipient, 'getCurrentAnchor', {container});
    const firstSnapshot = await recipient.command('snapshot');
    const editedBytes = content('second version\0\u00f6\n');
    const addedBytes = content('added');
    const publication = await publishHeadFirst(source, recipient, {audience, selection, label,
      files: {'/shared/a.txt': editedBytes, '/shared/c.txt': addedBytes}});
    assert.equal(await recipient.command('snapshot'), firstSnapshot);
    await assertHydration(recipient, first, firstBytes);
    await source.command('deliverUnacceptedCut', {audience, hash: publication.cutHash});
    assert.equal(await recipient.command('stored', {hash: publication.cutHash}), true);
    assert.equal(await recipient.command('stored', {hash: publication.assemblyHash}), false);
    assert.equal(await recipient.command('snapshot'), firstSnapshot);
    assert.equal((await rpc(recipient, 'getCurrentAnchor', {container})).anchor, anchor);
    assert.deepEqual((await enumerate(recipient, container)).map(item => item.id).sort(), [first.id, removed.id].sort());
    trace('head-before-cut', {head: publication.head, heldCut: publication.assemblyHash,
      unacceptedPayload: publication.cutHash, retainedSnapshot: firstSnapshot});

    const [replacement] = await Promise.all([
      accepted(recipient, 'GraphReleaseState'),
      changed(recipient, container),
      source.command('deliverHeldCut', {hash: publication.assemblyHash})
    ]);
    assert.equal(replacement.hash, publication.assemblyHash);
    const delta = await rpc(recipient, 'getChanges', {container, since: anchor});
    assert.equal(delta.moreComing, false);
    assert.notEqual(delta.newAnchor, anchor);
    assert.deepEqual(delta.deleted, [removed.id]);
    const edited = itemNamed(delta.updated, '/shared/a.txt');
    const added = itemNamed(delta.updated, '/shared/c.txt');
    assert.equal(edited.id, first.id);
    assert.notEqual(edited.contentVersion, firstSha);
    await assert.rejects(rpc(recipient, 'readItemContent', {
      id: first.id, version: firstSha, position: 0, length: 1
    }), {code: -32022});
    await assertHydration(recipient, edited, editedBytes);
    await assertHydration(recipient, added, addedBytes);
    const activeSnapshot = await recipient.command('snapshot');
    assert.match(activeSnapshot, /^[a-f0-9]{64}$/);
    trace('replacement-delta', {cut: replacement.hash, stableId: edited.id, deleted: delta.deleted});

    await recipient.stop();
    const reopened = await harness.start(workerEntry, 'recipient', recipient.config);
    assert.deepEqual(reopened.identity, recipient.identity);
    assert.equal(await reopened.command('demanded'), true);
    assert.equal(await reopened.command('snapshot'), activeSnapshot);
    const reopenedItems = await sharedItems(reopened);
    assert.deepEqual(reopenedItems.filter(item => item.type === 'file').map(item => item.id).sort(),
      [edited.id, added.id].sort());
    await assertHydration(reopened, itemNamed(reopenedItems, '/shared/a.txt'), editedBytes);
    trace('active-snapshot-reopened', {snapshot: activeSnapshot});

    await pair(source, reopened);
    const stale = await publishHeadFirst(source, reopened, {audience, selection, label,
      files: {'/shared/withdrawn.txt': content('late cut')}});
    assert.equal(await reopened.command('snapshot'), activeSnapshot);
    const retiredAnchor = (await rpc(reopened, 'getCurrentAnchor', {container: 'workingSet'})).anchor;
    const [retired] = await Promise.all([
      accepted(reopened, 'GraphReleaseSelectionHead', 'retired'),
      changed(reopened, statusDirectory),
      source.command('retire', {audience, selection})
    ]);
    await assertHidden(reopened);
    await assert.rejects(rpc(reopened, 'getItem', {id: first.id}), {code: -2});
    await assert.rejects(rpc(reopened, 'getChanges', {container: 'workingSet', since: retiredAnchor}), {code: -32020});
    trace('signed-retirement', {head: retired.hash, origin: retired.origin});

    const [lateCut] = await Promise.all([
      accepted(reopened, 'GraphReleaseState'),
      source.command('deliverHeldCut', {hash: stale.assemblyHash})
    ]);
    assert.equal(lateCut.hash, stale.assemblyHash);
    await assertHidden(reopened);
    assert.equal(await reopened.command('snapshot'), undefined);
    trace('late-cut-after-retirement', {cut: lateCut.hash, retiredHead: retired.hash, origin: lateCut.origin});

    const blocked = await source.command('probeProjectionImportFilter', {audience});
    for (const [type, hash] of Object.entries(blocked)) {
      assert.equal(await reopened.command('stored', {hash}), false, `receiver stored declined ${type}`);
    }
    await assertHidden(reopened);
    trace('receiver-declined-projection-objects', {types: Object.keys(blocked)});

    await reopened.stop();
    const afterRetirement = await harness.start(workerEntry, 'recipient', recipient.config);
    assert.deepEqual(afterRetirement.identity, recipient.identity);
    assert.equal(await afterRetirement.command('demanded'), true);
    await assertHidden(afterRetirement);
    trace('retirement-reopened');
  });
} finally {
  if (report) await writeFile(report, JSON.stringify(traceEntries, null, 2) + '\n');
}
