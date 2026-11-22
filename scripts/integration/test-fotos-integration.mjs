import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {assertHydration, enumerate, rpc} from './assertions.mjs';
import {withHarness} from './harness.mjs';

const {values: {report}} = parseArgs({options: {report: {type: 'string'}}});
const fotosEntry = new URL('./workers/fotos-worker.mjs', import.meta.url);
const filerEntry = new URL('./filer-worker.mjs', import.meta.url);
const fixture = new URL('../../../fotos/fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-top-left.jpg',
  import.meta.url);
const selection = 'fotos-shared-collection';
const settingsDirectory = '/ONE/System/settings/Filer';
const axes = ['Geteilt', 'Zeit', 'Orte', 'Personen'];
const traces = [];
const started = performance.now();

/** Report the verified owner transitions. */
function trace(event, fields = {}) {
  const evidence = {event, elapsedMs: performance.now() - started, ...fields};
  traces.push(evidence);
  console.log(`TRACE ${event} ${JSON.stringify(evidence)}`);
}

/** Wait for genuine signed acceptance on the receiving CHUM lane. */
function accepted(worker, type, status) {
  return worker.event('assemblyAccepted', event => event.selection === selection &&
    event.type === type && event.status === status && event.origin === 'import' && event.newlyAccepted,
  `Fotos ${status ?? 'cut'} ${type}`);
}

/** Observe a published container after its owning transition. */
function changed(worker, container) {
  return worker.event('changed', event => event.containers.includes(container), `invalidation of ${container}`);
}

/** Pair the two authenticated instances through the local relay. */
async function pair(publisher, receiver) {
  const invitation = await publisher.command('invite');
  await Promise.all([
    publisher.event('paired', event => event.person === receiver.identity.owner),
    receiver.event('paired', event => event.person === publisher.identity.owner),
    receiver.command('pair', {invitation})
  ]);
}

/** Read the production category decision after a status invalidation. */
async function pictureReasons(worker) {
  const {content} = await rpc(worker, 'readFile', {path: settingsDirectory + '/status.json'});
  const status = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
  return status.folders.find(folder => folder.id === 'fotos').reasons;
}

/** Enumerate only the peer selection and metadata appearances. */
async function pictureItems(worker) {
  return (await enumerate(worker)).filter(item => axes.some(axis =>
    item.path === `/Fotos/${axis}` || item.path.startsWith(`/Fotos/${axis}/`)));
}

/** Prove the declared peer axes have no native publication. */
async function assertHidden(worker) {
  assert.deepEqual(await pictureItems(worker), []);
  const {children} = await rpc(worker, 'readDir', {path: '/Fotos'});
  assert.ok(axes.every(axis => !children.includes(axis)));
}

/** Read exactly one original appearance for the requested path. */
function originalAt(items, predicate) {
  const matches = items.filter(item => item.type === 'file' && predicate(item.path));
  assert.equal(matches.length, 1);
  return matches[0];
}

try {
  await withHarness(async harness => {
    const fotos = await harness.start(fotosEntry, 'fotos');
    const filer = await harness.start(filerEntry, 'filer-pictures');
    const audience = filer.identity.owner;
    assert.notEqual(fotos.identity.owner, audience);
    await pair(fotos, filer);
    await assertHidden(filer);

    const content = (await readFile(fixture)).toString('base64');
    const filename = 'rose.jpg';
    const photo = {name: filename, content, time: '2026-03', place: 'Wien',
      person: {id: audience, name: 'Anna', approved: false}};
    const [cut, head, , first] = await Promise.all([
      accepted(filer, 'GraphReleaseState'),
      accepted(filer, 'GraphReleaseSelectionHead', 'active'),
      changed(filer, settingsDirectory),
      fotos.command('publish', {audience, selection, label: 'Sommer 2026', photos: [photo]})
    ]);
    assert.equal(cut.hash, first.assemblyHash);
    assert.equal(head.currentCut, first.assemblyHash);
    assert.ok((await pictureReasons(filer)).includes('peer-picture-shares-awaiting-demand'));
    await assertHidden(filer);
    trace('fotos-imported-before-demand', {assembly: cut.hash, cut: first.cutHash});

    await Promise.all([changed(filer, settingsDirectory), filer.command('demandPictures')]);
    const initial = await pictureItems(filer);
    assert.equal(initial.filter(item => item.type === 'file').length, 3);
    const collection = originalAt(initial, value => value.startsWith('/Fotos/Geteilt/') &&
      value.endsWith(`/Sommer 2026/${filename}`));
    const dated = originalAt(initial, value => value === `/Fotos/Zeit/2026/03/${filename}`);
    const located = originalAt(initial, value => value === `/Fotos/Orte/Wien/${filename}`);
    assert.equal(new Set([collection.id, dated.id, located.id]).size, 3);
    assert.equal(new Set([collection.contentVersion, dated.contentVersion, located.contentVersion]).size, 1);
    for (const item of [collection, dated, located]) await assertHydration(filer, item, content);
    assert.equal(collection.contentVersion, first.entries[0].blobHash);
    assert.ok(!initial.some(item => item.path.startsWith('/Fotos/Personen')));
    await assert.rejects(rpc(filer, 'unlink', {path: dated.path}), {code: -30});
    const {anchor} = await rpc(filer, 'getCurrentAnchor', {container: collection.parentId});
    trace('fotos-original-across-views', {sha256: collection.contentVersion,
      items: [collection.id, dated.id, located.id]});

    const [updatedCut, , , second] = await Promise.all([
      accepted(filer, 'GraphReleaseState'),
      accepted(filer, 'GraphReleaseSelectionHead', 'active'),
      changed(filer, collection.parentId),
      fotos.command('publish', {audience, selection, label: 'Sommer in Wien',
        photos: [{...photo, person: {...photo.person, approved: true}}]})
    ]);
    assert.equal(updatedCut.hash, second.assemblyHash);
    assert.equal(second.entries[0].hash, first.entries[0].hash);
    const delta = await rpc(filer, 'getChanges', {container: collection.parentId, since: anchor});
    assert.ok(delta.updated.some(item => item.id === collection.id && item.path.endsWith(`/Sommer in Wien/${filename}`)));
    const updated = await pictureItems(filer);
    const recognized = originalAt(updated, value => value === `/Fotos/Personen/Anna/${filename}`);
    assert.equal(updated.filter(item => item.type === 'file').length, 4);
    assert.equal(new Set(updated.filter(item => item.type === 'file').map(item => item.id)).size, 4);
    await assertHydration(filer, recognized, content);
    assert.equal((await rpc(filer, 'getItem', {id: dated.id})).contentVersion, recognized.contentVersion);
    trace('fotos-approved-person-and-renamed-collection', {assembly: updatedCut.hash, personView: recognized.id});

    const localName = 'adopted-rose.jpg';
    await rpc(filer, 'createFile', {path: '/Files', fileHash: collection.contentVersion,
      fileName: localName, mode: 0o100644});
    assert.equal((await rpc(filer, 'stat', {path: `/Files/${localName}`})).contentHash, collection.contentVersion);

    const [pendingHead, , pending] = await Promise.all([
      accepted(filer, 'GraphReleaseSelectionHead', 'active'),
      filer.event('changed', event => event.pendingPictures, 'pending picture selection status'),
      fotos.command('publishHeadFirst', {audience, selection, label: 'Superseded Fotos Collection', photos: [photo]})
    ]);
    assert.equal(pendingHead.currentCut, pending.assemblyHash);
    assert.equal(await filer.command('stored', {hash: pending.assemblyHash}), false);
    assert.ok((await pictureReasons(filer)).includes('peer-picture-shares-pending'));
    assert.deepEqual(await pictureItems(filer), updated);
    trace('fotos-head-before-cut', {heldCut: pending.assemblyHash, previousViews: 4});

    const [retired] = await Promise.all([
      accepted(filer, 'GraphReleaseSelectionHead', 'retired'),
      changed(filer, settingsDirectory),
      fotos.command('retire', {audience, selection})
    ]);
    await assertHidden(filer);
    await assert.rejects(rpc(filer, 'getItem', {id: recognized.id}), {code: -2});
    trace('fotos-retired', {head: retired.hash});

    const [late] = await Promise.all([
      accepted(filer, 'GraphReleaseState'),
      fotos.command('deliverHeldCut', {hash: pending.assemblyHash})
    ]);
    assert.equal(late.hash, pending.assemblyHash);
    await assertHidden(filer);
    trace('fotos-late-cut-after-retirement', {assembly: late.hash, retiredHead: retired.hash});

    await filer.stop();
    const reopened = await harness.start(filerEntry, 'filer-pictures', filer.config);
    assert.deepEqual(reopened.identity, filer.identity);
    await assertHidden(reopened);
    const localPath = `/Files/${localName}`;
    assert.equal((await rpc(reopened, 'readFile', {path: localPath})).content, content);
    trace('fotos-retired-views-reopened', {adoptedPath: localPath, blob: collection.contentVersion});
  });
} finally {
  if (report) await writeFile(report, JSON.stringify(traces, null, 2) + '\n');
}
