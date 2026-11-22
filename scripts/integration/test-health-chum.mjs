import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getOneWorkspaceDir} from '../../test-support/one-workspace-paths.js';
import {enumerate, rpc} from './assertions.mjs';
import {withHarness} from './harness.mjs';

const {values: {report}} = parseArgs({options: {report: {type: 'string'}}});
const traces = [];
const started = performance.now();
const filerEntry = new URL('./filer-worker.mjs', import.meta.url);
const producerEntry = new URL('./workers/health-worker.mjs', import.meta.url);
const one = getOneWorkspaceDir(fileURLToPath(new URL('.', import.meta.url)));
const {styleNativeHtml} = await import(pathToFileURL(join(one,
  'packages/refinio.api/dist/src/filer/NativeHtmlDocument.js')).href);

/** Emit compact proof of each completed production transition. */
function trace(event, fields = {}) {
  const evidence = {event, elapsedMs: performance.now() - started, ...fields};
  traces.push(evidence);
  console.log(`TRACE ${event} ${JSON.stringify(evidence)}`);
}

/** Wait for a native health view produced by a real runtime invalidation. */
function healthState(worker, description, predicate) {
  return worker.event('healthState', predicate, description);
}

/** Hydrate a native published path using its current production content version. */
async function assertHealthHydration(worker, item, expected) {
  assert.deepEqual(await rpc(worker, 'getItem', {id: item.id}), item);
  assert.equal((await rpc(worker, 'stat', {path: item.path})).contentHash, item.contentVersion);
  const bytes = Buffer.from(expected, 'base64');
  const hydrated = await rpc(worker, 'readItemContent', {id: item.id, version: item.contentVersion,
    position: 0, length: bytes.length});
  assert.deepEqual(Buffer.from(hydrated.content, 'base64'), bytes);
}

/** Pair a foreign person and wait for the authenticated initial CHUM exchange. */
async function pair(source, recipient) {
  const invitation = await source.command('invite');
  await Promise.all([
    source.event('paired', event => event.person === recipient.identity.owner),
    recipient.event('paired', event => event.person === source.identity.owner),
    source.event('chumReady', event => event.person === recipient.identity.owner),
    recipient.event('chumReady', event => event.person === source.identity.owner),
    recipient.command('pair', {invitation})
  ]);
}

/** Confirm no health mount, no native published items, and no received private roots. */
async function assertForeignHidden(worker, publications) {
  assert.ok(!(await rpc(worker, 'readDir', {path: '/'})).children.includes('Gesundheit'));
  assert.ok(!(await enumerate(worker)).some(item => item.path.startsWith('/Gesundheit')));
  for (const {root, record} of publications) {
    assert.equal(await worker.command('stored', {hash: root}), false, 'foreign store received an owner-only root');
    assert.equal(await worker.command('stored', {hash: record}), false, 'foreign store received an undisclosed clinical record');
  }
}

/** Verify the full product view and all bytes through production native operations. */
async function assertPublished(worker, edda, binary) {
  assert.deepEqual((await rpc(worker, 'readDir', {path: '/Gesundheit'})).children.sort(), ['Edda', 'Flexibel']);
  const items = await enumerate(worker);
  const eddaItem = items.find(item => item.path.startsWith('/Gesundheit/Edda/') && item.type === 'file');
  const flexibelItem = items.find(item => item.path.startsWith('/Gesundheit/Flexibel/') && item.type === 'file');
  assert.ok(eddaItem && flexibelItem, 'both app-owned health subdirectories must reach the native working set');
  assert.equal(eddaItem.name, `DiaryEntry [${edda.record}].html`);
  assert.ok(eddaItem.path.includes(`[${edda.patient}]`), 'clinical patient folder must carry its canonical Person identity');
  const html = styleNativeHtml(edda.microdata, eddaItem.name, '../../../ONE/System/objects/');
  assert.ok(html.includes(edda.microdata), 'native HTML must preserve the exact original ONE microdata');
  await assertHealthHydration(worker, eddaItem, Buffer.from(html).toString('base64'));
  await assertHealthHydration(worker, flexibelItem, binary);
  assert.deepEqual(Buffer.from((await rpc(worker, 'readFile', {path: eddaItem.path})).content, 'base64'), Buffer.from(html));
  assert.deepEqual(Buffer.from((await rpc(worker, 'readFile', {path: flexibelItem.path})).content, 'base64'), Buffer.from(binary, 'base64'));
  await assert.rejects(rpc(worker, 'unlink', {path: eddaItem.path}), {code: -30});
  return {eddaItem, flexibelItem};
}

try {
  await withHarness(async harness => {
    const owner = await harness.start(filerEntry, 'health-owner');
    const source = await harness.start(producerEntry, 'health-producer', {
      ...owner.config, directory: join(dirname(owner.config.directory), 'health-producer'),
      instanceName: 'health-producer'
    });
    const foreign = await harness.start(filerEntry, 'health-foreign');
    assert.equal(source.identity.owner, owner.identity.owner);
    assert.notEqual(source.identity.instance, owner.identity.instance);
    assert.notEqual(source.identity.owner, foreign.identity.owner);
    await pair(source, foreign);
    const invitation = await source.command('inviteDevice');
    await Promise.all([
      source.event('paired', event => event.person === owner.identity.owner),
      owner.event('paired', event => event.person === source.identity.owner),
      source.event('chumReady', event => event.person === owner.identity.owner),
      owner.event('chumReady', event => event.person === source.identity.owner),
      owner.command('enroll', {invitation, owner: source.identity.owner})
    ]);
    await Promise.all([
      healthState(owner, 'initial hidden health mount', event => !event.visible),
      owner.command('watchHealth')
    ]);
    await assertForeignHidden(foreign, []);
    trace('health-owner-iom-and-foreign-paired', {owner: owner.identity.owner,
      producerInstance: source.identity.instance, filerInstance: owner.identity.instance,
      foreign: foreign.identity.owner});

    const [, edda] = await Promise.all([
      healthState(owner, 'Edda publication native arrival', event => event.paths.some(path => path.endsWith('.html'))),
      source.command('publishEdda')
    ]).catch(async error => {
      console.error('Health CHUM diagnostics', JSON.stringify(await Promise.allSettled([
        source.command('diagnostics'), owner.command('diagnostics')
      ])));
      throw error;
    });
    assert.equal(await owner.command('stored', {hash: edda.root}), true);
    const binary = Buffer.from('Flexibel exact bytes\0ä\n', 'utf8').toString('base64');
    const [, flexibel] = await Promise.all([
      healthState(owner, 'both health products native arrival', event => event.paths.some(path => path.endsWith('/exact.bin')) &&
        event.paths.some(path => path.endsWith('.html'))),
      source.command('publishFlexibel', {content: binary})
    ]);
    assert.equal(await owner.command('stored', {hash: flexibel.root}), true);
    const {eddaItem, flexibelItem} = await assertPublished(owner, edda, binary);
    await assertForeignHidden(foreign, [edda, flexibel]);
    trace('health-exact-owner-iom-hydration', {eddaRoot: edda.root, flexibelRoot: flexibel.root,
      eddaPath: eddaItem.path, flexibelPath: flexibelItem.path});

    await owner.stop();
    const reopened = await harness.start(filerEntry, 'health-owner', owner.config);
    assert.deepEqual(reopened.identity, owner.identity);
    const persisted = await assertPublished(reopened, edda, binary);
    assert.equal(persisted.eddaItem.id, eddaItem.id);
    assert.equal(persisted.flexibelItem.id, flexibelItem.id);
    trace('health-active-view-reopened', {edda: eddaItem.id, flexibel: flexibelItem.id});
    await reopened.command('watchHealth');
    const [, withdrawnEdda] = await Promise.all([
      healthState(reopened, 'Edda current empty root removal', event => event.visible &&
        !event.paths.some(path => path.startsWith('/Gesundheit/Edda')) &&
        event.paths.some(path => path.endsWith('/exact.bin'))),
      source.command('withdrawEdda')
    ]);
    assert.notEqual(withdrawnEdda.root, edda.root);
    assert.equal(await reopened.command('stored', {hash: withdrawnEdda.root}), true);
    assert.deepEqual((await rpc(reopened, 'readDir', {path: '/Gesundheit'})).children, ['Flexibel']);
    await assert.rejects(rpc(reopened, 'getItem', {id: eddaItem.id}), {code: -2});
    const retainedFlexibel = (await enumerate(reopened)).find(item => item.id === flexibelItem.id);
    assert.ok(retainedFlexibel);
    await assertHealthHydration(reopened, retainedFlexibel, binary);
    trace('health-edda-role-withdrawal', {previous: edda.root, current: withdrawnEdda.root});

    const [, withdrawnFlexibel] = await Promise.all([
      healthState(reopened, 'all current health roots withdrawn', event => !event.visible),
      source.command('withdrawFlexibel')
    ]);
    assert.notEqual(withdrawnFlexibel.root, flexibel.root);
    assert.equal(await reopened.command('stored', {hash: withdrawnFlexibel.root}), true);
    assert.ok(!(await rpc(reopened, 'readDir', {path: '/'})).children.includes('Gesundheit'));
    assert.ok(!(await enumerate(reopened)).some(item => item.path.startsWith('/Gesundheit')));
    await assert.rejects(rpc(reopened, 'getItem', {id: flexibelItem.id}), {code: -2});
    await assertForeignHidden(foreign, [edda, flexibel, withdrawnEdda, withdrawnFlexibel]);
    trace('health-empty-current-root-withdrawal', {current: withdrawnFlexibel.root});

    await reopened.stop();
    const withdrawn = await harness.start(filerEntry, 'health-owner', owner.config);
    assert.deepEqual(withdrawn.identity, owner.identity);
    assert.ok(!(await rpc(withdrawn, 'readDir', {path: '/'})).children.includes('Gesundheit'));
    assert.ok(!(await enumerate(withdrawn)).some(item => item.path.startsWith('/Gesundheit')));
    await assert.rejects(rpc(withdrawn, 'getItem', {id: eddaItem.id}), {code: -2});
    await assert.rejects(rpc(withdrawn, 'getItem', {id: flexibelItem.id}), {code: -2});
    trace('health-withdrawal-reopened');
  });
} finally {
  if (report) await writeFile(report, JSON.stringify(traces, null, 2) + '\n');
}
