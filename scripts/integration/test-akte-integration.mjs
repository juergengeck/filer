import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {withHarness} from './harness.mjs';
import {assertHydration, enumerate, rpc} from './assertions.mjs';

const {values: {report}} = parseArgs({options: {report: {type: 'string'}}});
const akteEntry = new URL('./workers/akte-worker.mjs', import.meta.url);
const filerEntry = new URL('./filer-worker.mjs', import.meta.url);
const selection = 'akte-synthetic-case';
const uploadSelection = 'synthetic-client-upload';
const shareRoot = '/Files/Geteilt';
const statusDirectory = '/ONE/System/settings/Filer';
const traces = [];
const started = performance.now();

/** Emit bounded evidence at each verified production transition. */
function trace(event, fields = {}) {
  const evidence = {event, elapsedMs: performance.now() - started, ...fields};
  traces.push(evidence);
  console.log(`TRACE ${event} ${JSON.stringify(evidence)}`);
}

/** Build a complete synthetic PDF; white text exercises the presentation policy. */
function pdf(text, concealed = false) {
  const stream = `${concealed ? '1 1 1' : '0 0 0'} rg BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result).toString('base64');
}

/** Await an actual imported Assembly acceptance, without invoking acceptance. */
function accepted(worker, type, status, selected = selection) {
  return worker.event('assemblyAccepted', message => message.type === type &&
    message.selection === selected && message.origin === 'import' && message.newlyAccepted &&
    message.status === status, `imported ${status ?? 'cut'} ${type}`);
}

/** Await the production working-set invalidation. */
function changed(worker, container = 'workingSet') {
  return worker.event('changed', message => message.containers.includes(container), `invalidation of ${container}`);
}

/** Pair independent native identities over the disposable loopback relay. */
async function pair(source, recipient) {
  const invitation = await source.command('invite');
  await Promise.all([
    source.event('paired', message => message.person === recipient.identity.owner),
    recipient.event('paired', message => message.person === source.identity.owner),
    recipient.command('pair', {invitation})
  ]);
}

/** Read only peer paths from the real native File Provider working set. */
async function items(worker) {
  return (await enumerate(worker)).filter(item => item.path === shareRoot || item.path.startsWith(shareRoot + '/'));
}

/** Resolve exactly one named document appearance. */
function named(entries, name) {
  const matches = entries.filter(item => item.path.endsWith('/' + name));
  assert.equal(matches.length, 1, `expected one ${name}`);
  return matches[0];
}

/** Verify neither the path filesystem nor working set exposes a peer share. */
async function hidden(worker) {
  assert.deepEqual(await items(worker), []);
  assert.ok(!(await rpc(worker, 'readDir', {path: '/Files'})).children.includes('Geteilt'));
}

/** Call Akte's real producer with portable original bytes. */
function intake(worker, filename, content, mimeType = 'application/pdf') {
  return worker.command('intake', {filename, sourcePath: filename, content, mimeType});
}

try {
  await withHarness(async harness => {
    const akte = await harness.start(akteEntry, 'akte');
    const filer = await harness.start(filerEntry, 'akte-client');
    const audience = filer.identity.owner;
    assert.notEqual(akte.identity.owner, audience);
    assert.notEqual(akte.identity.instance, filer.identity.instance);
    trace('akte-workers-ready', {transport: 'FilerRuntime', domain: '@akte/app/document-intake + document-case-share'});

    const original = pdf('Synthetic case document, version one.');
    const officeBytes = Buffer.from('{\\rtf1\\ansi Synthetic Office contract.\\par No personal data.}').toString('base64');
    const blockedBytes = pdf('Synthetic concealed content.', true);
    const document = await intake(akte, 'schriftsatz.pdf', original);
    const office = await intake(akte, 'vertrag.rtf', officeBytes, 'application/rtf');
    const rejected = await intake(akte, 'rejected.pdf', blockedBytes);
    assert.equal(document.status, 'admitted');
    assert.ok(document.record.sourceEntry);
    assert.ok(document.record.pages.some(page => page.text.includes('Synthetic case document')));
    assert.match(document.record.importPolicyRef, /^[a-f0-9]{64}$/);
    assert.equal(office.status, 'admitted');
    assert.ok(office.record.sourceEntry);
    assert.equal(office.record.projectorKey, 'akte:original-only:v1');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.record.sourceEntry, undefined);
    assert.deepEqual(rejected.record.pages, []);
    assert.match(rejected.record.importPolicyRef, /^[a-f0-9]{64}$/);
    assert.ok(rejected.warnings.some(warning => /low-contrast-text/.test(warning)), rejected.warnings.join('\n'));
    trace('akte-real-admission', {pdf: document.documentRef, office: office.documentRef,
      rejected: rejected.documentRef, policy: rejected.record.importPolicyRef});

    await pair(akte, filer);
    const label = 'Mandat Müller 2026';
    const request = {audience, selection, label};
    await assert.rejects(akte.command('probeCaseIdentity', {...request, owner: audience,
      documents: [document.documentRef]}), /Case owner does not match authenticated owner/);
    await assert.rejects(akte.command('probeCaseIdentity', {...request, source: '0'.repeat(64),
      documents: [document.documentRef]}), /Case source must be the authenticated owner Files root/);
    await assert.rejects(akte.command('publishCase', {...request,
      documents: [document.documentRef, rejected.documentRef]}), /Only admitted documents may be shared/);
    await hidden(filer);
    assert.equal(await filer.command('stored', {hash: rejected.record.sourceBlob}), false);
    trace('akte-rejected-boundary', {rejectedBlob: rejected.record.sourceBlob});

    // Keep Cut 1's Assembly off the wire until after the signed retirement.
    const [, , delayed] = await Promise.all([
      accepted(filer, 'GraphReleaseSelectionHead', 'active'),
      changed(filer, statusDirectory),
      akte.command('publishHeadFirst', {...request, documents: [document.documentRef]})
    ]);
    assert.equal(await filer.command('stored', {hash: delayed.assemblyHash}), false);
    await hidden(filer);
    trace('akte-delayed-cut-one', {assembly: delayed.assemblyHash});
    const [cut, head, publication] = await Promise.all([
      accepted(filer, 'GraphReleaseState'), accepted(filer, 'GraphReleaseSelectionHead', 'active'),
      akte.command('publishCase', {...request, documents: [document.documentRef, office.documentRef]})
    ]);
    assert.equal(cut.hash, publication.assemblyHash);
    await hidden(filer);
    await Promise.all([changed(filer, statusDirectory), filer.command('demand')]);
    const first = await items(filer);
    const firstPdf = named(first, 'schriftsatz.pdf');
    const firstOffice = named(first, 'vertrag.rtf');
    assert.ok(firstPdf.path.startsWith(shareRoot + '/'));
    assert.ok(firstPdf.path.endsWith(`/${label}/schriftsatz.pdf`));
    await assertHydration(filer, firstPdf, original);
    await assertHydration(filer, firstOffice, officeBytes);
    await assert.rejects(rpc(filer, 'unlink', {path: firstPdf.path}), {code: -30});
    assert.ok(!first.some(item => item.path.endsWith('/rejected.pdf')));
    trace('akte-case-hydrated', {cut: cut.hash, head: head.hash, pdfId: firstPdf.id, officeId: firstOffice.id});

    const updatedBytes = pdf('Synthetic case document, version two.');
    const addedBytes = pdf('Synthetic additional evidence.');
    const updated = await intake(akte, 'schriftsatz.pdf', updatedBytes);
    const added = await intake(akte, 'beleg.pdf', addedBytes);
    assert.equal(updated.status, 'admitted');
    assert.equal(added.status, 'admitted');
    const container = firstPdf.parentId;
    const {anchor} = await rpc(filer, 'getCurrentAnchor', {container});
    const renamedLabel = label + ' — Berufung';
    await Promise.all([
      accepted(filer, 'GraphReleaseState'), accepted(filer, 'GraphReleaseSelectionHead', 'active'), changed(filer, container),
      akte.command('publishCase', {...request, label: renamedLabel,
        documents: [updated.documentRef, office.documentRef, added.documentRef]})
    ]);
    const delta = await rpc(filer, 'getChanges', {container, since: anchor});
    assert.equal(delta.moreComing, false);
    assert.notEqual(delta.newAnchor, anchor);
    const latest = await items(filer);
    const latestPdf = named(latest, 'schriftsatz.pdf');
    assert.equal(latestPdf.id, firstPdf.id);
    assert.equal(named(latest, 'vertrag.rtf').id, firstOffice.id);
    assert.ok(latestPdf.path.includes('/' + renamedLabel + '/'));
    assert.equal(named(delta.updated, 'beleg.pdf').id, named(latest, 'beleg.pdf').id);
    assert.equal(named(delta.updated, 'schriftsatz.pdf').id, firstPdf.id);
    assert.ok(!latest.some(item => item.path.includes('/' + label + '/')));
    await assert.rejects(rpc(filer, 'readItemContent', {id: firstPdf.id,
      version: firstPdf.contentVersion, position: 0, length: 1}), {code: -32022});
    await assertHydration(filer, latestPdf, updatedBytes);
    await assertHydration(filer, named(latest, 'beleg.pdf'), addedBytes);
    await assertHydration(filer, named(latest, 'vertrag.rtf'), officeBytes);
    trace('akte-renamed-replacement-delta', {stablePdfId: latestPdf.id, stableOfficeId: firstOffice.id,
      addedId: named(latest, 'beleg.pdf').id, updated: delta.updated.length});

    const uploadBytes = pdf('Synthetic client upload.');
    const rejectedUploadBytes = pdf('Synthetic concealed client upload.', true);
    const [, , upload] = await Promise.all([
      accepted(akte, 'GraphReleaseState', undefined, uploadSelection),
      accepted(akte, 'GraphReleaseSelectionHead', 'active', uploadSelection),
      filer.command('publish', {audience: akte.identity.owner, selection: uploadSelection,
        label: 'Synthetic client upload', files: {'/upload.pdf': uploadBytes, '/rejected-upload.pdf': rejectedUploadBytes}})
    ]);
    const received = await akte.command('consume', {publisher: audience, selection: uploadSelection});
    assert.equal(received.assemblyHash, upload.assemblyHash);
    const incoming = received.results.find(result => result.record.filename === 'upload.pdf');
    const deniedIncoming = received.results.find(result => result.record.filename === 'rejected-upload.pdf');
    assert.equal(received.results.length, 2);
    assert.equal(incoming.status, 'admitted');
    assert.equal(incoming.content, uploadBytes);
    assert.equal(incoming.record.sourceBlob, incoming.originalBlob);
    assert.ok(incoming.record.sourceEntry);
    assert.equal(deniedIncoming.status, 'rejected');
    assert.equal(deniedIncoming.record.sourceEntry, undefined);
    await assert.rejects(akte.command('publishCase', {...request,
      documents: [deniedIncoming.documentRef]}), /Only admitted documents may be shared/);
    trace('akte-inbound-verified-intake', {assembly: received.assemblyHash,
      admitted: incoming.documentRef, rejected: deniedIncoming.documentRef});

    const [retired] = await Promise.all([
      accepted(filer, 'GraphReleaseSelectionHead', 'retired'), changed(filer, statusDirectory),
      akte.command('retire', {audience, selection})
    ]);
    await hidden(filer);
    await assert.rejects(rpc(filer, 'getItem', {id: firstPdf.id}), {code: -2});
    const [late] = await Promise.all([
      accepted(filer, 'GraphReleaseState'), akte.command('deliverHeldCut', {hash: delayed.assemblyHash})
    ]);
    assert.equal(late.hash, delayed.assemblyHash);
    await hidden(filer);
    assert.equal(await filer.command('stored', {hash: rejected.record.sourceBlob}), false);
    trace('akte-retired-late-cut-one', {retiredHead: retired.hash, delayedCut: late.hash});

    await filer.stop();
    const reopened = await harness.start(filerEntry, 'akte-client', filer.config);
    assert.deepEqual(reopened.identity, filer.identity);
    assert.equal(await reopened.command('demanded'), true);
    await hidden(reopened);
    trace('akte-retirement-reopened');
  });
} finally {
  if (report) await writeFile(report, JSON.stringify(traces, null, 2) + '\n');
}
