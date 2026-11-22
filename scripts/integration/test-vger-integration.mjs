import assert from 'node:assert/strict';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {parseArgs} from 'node:util';
import {assertHydration, enumerate, rpc} from './assertions.mjs';
import {withHarness} from './harness.mjs';

const {values: {report}} = parseArgs({options: {report: {type: 'string'}}});
const traces = [];
const started = performance.now();
const filerEntry = new URL('./filer-worker.mjs', import.meta.url);
const vgerEntry = new URL('./workers/vger-worker.mjs', import.meta.url);
const sharePrefix = '/Files/Geteilt/';
const settingsPath = '/ONE/System/settings/Filer';

/** Capture acceptance of a signed selection through CHUM. */
function accepted(worker, selection, type, status) {
  return worker.event('assemblyAccepted', event => event.selection === selection &&
    event.type === type && event.status === status && event.origin === 'import' && event.newlyAccepted,
  `${selection} imported ${status ?? 'cut'} ${type}`);
}

/** Observe native invalidation from the owner of a changed container. */
function changed(worker, container) {
  return worker.event('changed', event => event.containers.includes(container), `invalidation of ${container}`);
}

/** Wait for the exact Files mode to reach the native status projection. */
function filesMode(worker, mode, visible) {
  return worker.event('filesMode', event => event.mode === mode && event.visible === visible,
    `Files status mode ${mode}`);
}

/** Pair the production model endpoints and await both committed results. */
async function pair(source, recipient) {
  const invitation = await source.command('invite');
  await Promise.all([
    source.event('paired', event => event.person === recipient.identity.owner),
    recipient.event('paired', event => event.person === source.identity.owner),
    recipient.command('pair', {invitation})
  ]);
}

/** Emit compact structured evidence for the suite's verified transitions. */
function trace(event, fields = {}) {
  const evidence = {event, elapsedMs: performance.now() - started, ...fields};
  traces.push(evidence);
  console.log(`TRACE ${event} ${JSON.stringify(evidence)}`);
}

try {
  await withHarness(async harness => {
    const vger = await harness.start(vgerEntry, 'vger');
    const filer = await harness.start(filerEntry, 'filer');
    assert.notEqual(vger.identity.owner, filer.identity.owner);
    await pair(vger, filer);
    const files = path => path.startsWith(sharePrefix);
    assert.ok(!(await enumerate(filer)).some(item => files(item.path)));

    const selection = 'vger-project';
    const audience = filer.identity.owner;
    const original = Buffer.from('VGER project\n').toString('base64');
    const note = Buffer.from('VGER notes\n').toString('base64');
    const [cut, , , publication] = await Promise.all([
      accepted(filer, selection, 'GraphReleaseState'),
      accepted(filer, selection, 'GraphReleaseSelectionHead', 'active'),
      changed(filer, settingsPath),
      vger.command('publish', {audience, selection, label: 'VGER Project',
        files: {'/Project/overview.txt': original, '/Notes/readme.txt': note}})
    ]);
    assert.equal(cut.hash, publication.assemblyHash);
    assert.ok(!(await enumerate(filer)).some(item => files(item.path)));
    await Promise.all([changed(filer, settingsPath), filer.command('demand')]);

    const worktree = await mkdtemp(join(dirname(filer.config.directory), 'model-weights-'));
    const weights = Buffer.from('fixture model weights');
    await writeFile(join(worktree, 'model.safetensors'), weights);
    await filer.command('publishWeights', {directory: worktree, model: 'fixture/Phase1',
      revision: 'v1', format: 'safetensors', source: 'fixture://phase1'});
    const items = await enumerate(filer);
    const overview = items.find(item => files(item.path) && item.path.endsWith('/Project/overview.txt'));
    const readme = items.find(item => files(item.path) && item.path.endsWith('/Notes/readme.txt'));
    const model = items.find(item => item.path.startsWith('/ONE/System/models/') && item.name === 'model.safetensors');
    assert.ok(overview && readme && model, 'working set must contain both models and all released peer directories');
    assert.equal(new Set([overview.id, readme.id, model.id]).size, 3);
    await assertHydration(filer, overview, original);
    await assertHydration(filer, readme, note);
    await assert.rejects(rpc(filer, 'unlink', {path: overview.path}), {code: -30});
    const downloaded = await rpc(filer, 'readItemContent', {id: model.id, version: model.contentVersion,
      position: 0, length: weights.length});
    assert.deepEqual(Buffer.from(downloaded.content, 'base64'), weights);
    trace('vger-files-and-model-weights', {cut: cut.hash, file: overview.id, model: model.id});

    const {anchor} = await rpc(filer, 'getCurrentAnchor', {container: 'workingSet'});
    const weightsV2 = Buffer.from('updated fixture model weights');
    await writeFile(join(worktree, 'model.safetensors'), weightsV2);
    await filer.command('publishWeights', {directory: worktree, model: 'fixture/Phase1',
      revision: 'v2', format: 'safetensors', source: 'fixture://phase1'});
    const edited = Buffer.from('VGER project revised\n').toString('base64');
    await Promise.all([
      accepted(filer, selection, 'GraphReleaseState'),
      accepted(filer, selection, 'GraphReleaseSelectionHead', 'active'),
      changed(filer, overview.parentId),
      vger.command('publish', {audience, selection, label: 'VGER Project',
        files: {'/Project/overview.txt': edited}})
    ]);
    const delta = await rpc(filer, 'getChanges', {container: 'workingSet', since: anchor});
    assert.ok(delta.deleted.includes(readme.id));
    const updated = delta.updated.find(item => item.id === overview.id);
    assert.ok(updated, 'working-set delta must carry the updated stable Files identity');
    await assertHydration(filer, updated, edited);
    assert.deepEqual(await rpc(filer, 'getItem', {id: model.id}), model);
    const updatedModel = delta.updated.find(item => item.name === 'model.safetensors' && item.id !== model.id);
    assert.ok(updatedModel, 'working-set delta must also carry the second model revision');
    assert.deepEqual(Buffer.from((await rpc(filer, 'readItemContent', {id: updatedModel.id,
      version: updatedModel.contentVersion, position: 0, length: weightsV2.length})).content, 'base64'), weightsV2);
    trace('vger-replacement-delta', {stableId: overview.id, model: updatedModel.id});

    const reverse = 'filer-to-vger';
    const outbound = {'/handoff.txt': Buffer.from('Filer to VGER\n').toString('base64')};
    const [received, , sent] = await Promise.all([
      accepted(vger, reverse, 'GraphReleaseState'),
      accepted(vger, reverse, 'GraphReleaseSelectionHead', 'active'),
      filer.command('publish', {audience: vger.identity.owner, selection: reverse, label: 'Filer Export', files: outbound})
    ]);
    assert.equal(received.hash, sent.assemblyHash);
    assert.deepEqual(await vger.command('readShare', {publisher: filer.identity.owner, selection: reverse}), outbound);
    trace('filer-return-cut-in-vger-frontier', {assembly: received.hash});

    await Promise.all([
      accepted(filer, selection, 'GraphReleaseSelectionHead', 'retired'),
      changed(filer, settingsPath),
      vger.command('retire', {audience, selection})
    ]);
    assert.ok(!(await enumerate(filer)).some(item => files(item.path)));
    assert.deepEqual(await rpc(filer, 'getItem', {id: model.id}), model);
    await filer.stop();
    const reopened = await harness.start(filerEntry, 'filer', filer.config);
    assert.deepEqual(reopened.identity, filer.identity);
    assert.equal(await reopened.command('demanded'), true);
    assert.ok(!(await enumerate(reopened)).some(item => files(item.path)));
    trace('vger-retirement-reopened');
    await Promise.all([vger.stop(), reopened.stop()]);

    const managed = await harness.start(filerEntry, 'filer-iom');
    const iom = await harness.start(vgerEntry, 'vger-iom', {
      ...managed.config, directory: join(dirname(managed.config.directory), 'vger-iom'),
      instanceName: 'vger-iom'
    });
    assert.equal(iom.identity.owner, managed.identity.owner);
    assert.notEqual(iom.identity.instance, managed.identity.instance);
    const invitation = await iom.command('inviteDevice');
    await Promise.all([
      iom.event('paired', event => event.person === managed.identity.owner),
      managed.event('paired', event => event.person === iom.identity.owner),
      iom.event('chumReady', event => event.person === managed.identity.owner, 'same-owner CHUM startup'),
      managed.command('enroll', {invitation, owner: iom.identity.owner})
    ]);
    const iomSelection = 'vger-iom-active-files';
    const iomContent = Buffer.from('IoM Files demand survives hiding\n').toString('base64');
    await Promise.all([
      accepted(managed, iomSelection, 'GraphReleaseState'),
      accepted(managed, iomSelection, 'GraphReleaseSelectionHead', 'active'),
      changed(managed, settingsPath),
      iom.command('publish', {audience: managed.identity.owner, selection: iomSelection,
        label: 'IoM Files', files: {'/active.txt': iomContent}})
    ]);
    await Promise.all([changed(managed, settingsPath), managed.command('demand')]);
    const activeItems = (await enumerate(managed)).filter(item => files(item.path));
    const activeFile = activeItems.find(item => item.path.endsWith('/active.txt'));
    assert.ok(activeFile, 'IoM folder settings must be tested with an active Files share');
    await assertHydration(managed, activeFile, iomContent);
    const instance = managed.identity.instance;
    let authored;
    const [, hidden] = await Promise.all([
      filesMode(managed, 'hidden', false),
      iom.command('setFolderMode', {instance, mode: 'hidden'}).then(version => {
        authored = version.hash;
        return version;
      })
    ]).catch(async error => {
      const diagnostics = await Promise.allSettled([managed.command('diagnostics'), iom.command('diagnostics'),
        authored && managed.command('stored', {hash: authored})]);
      console.error('IoM CHUM diagnostics', JSON.stringify({authored, diagnostics}));
      throw error;
    });
    assert.equal(hidden.values.files, 'hidden');
    assert.equal(await managed.command('stored', {hash: hidden.hash}), true);
    assert.ok(!(await rpc(managed, 'readDir', {path: '/'})).children.includes('Files'));
    assert.ok(!(await enumerate(managed)).some(item => files(item.path)),
      'hidden Files must remove accepted share items from the native working set');
    await assert.rejects(rpc(managed, 'getItem', {id: activeFile.id}), {code: -2});
    const [, visible] = await Promise.all([
      filesMode(managed, 'visible', true),
      iom.command('setFolderMode', {instance, mode: 'visible'})
    ]);
    assert.equal(visible.values.files, 'visible');
    assert.equal(await managed.command('stored', {hash: visible.hash}), true);
    assert.ok((await rpc(managed, 'readDir', {path: '/'})).children.includes('Files'));
    assert.deepEqual((await enumerate(managed)).filter(item => files(item.path)), activeItems);
    await assertHydration(managed, activeFile, iomContent);
    trace('vger-iom-changed-filer-folders', {hidden: hidden.hash, visible: visible.hash, activeFile: activeFile.id});
  });
} finally {
  if (report) await writeFile(report, JSON.stringify(traces, null, 2) + '\n');
}
