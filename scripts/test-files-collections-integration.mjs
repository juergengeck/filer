import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filer-files-collections-'));
const workers = [];
const server = new CommunicationServer();
const traceOrigin = process.hrtime.bigint();
const workerNode = process.env.FILER_TEST_NODE ?? process.execPath;
const workerExecArgv = process.env.FILER_TEST_NODE_ARGS === undefined
  ? process.execArgv
  : JSON.parse(process.env.FILER_TEST_NODE_ARGS);
if (!Array.isArray(workerExecArgv) || !workerExecArgv.every(value => typeof value === 'string')) {
  throw new Error('FILER_TEST_NODE_ARGS must be a JSON array of Node arguments');
}

/** Timestamp one cross-process observation on the driver's monotonic clock. */
function tracePoint() {
  return {at: new Date().toISOString(), elapsedMs: Number(process.hrtime.bigint() - traceOrigin) / 1e6};
}

/** Compute a duration between two driver trace points. */
function traceDuration(start, end) { return end.elapsedMs - start.elapsedMs; }

/** Emit machine-readable evidence without coupling the test to a report writer. */
function trace(name, evidence) { console.log(`TRACE ${name} ${JSON.stringify(evidence)}`); }

/** Wait on an owning process event, with a deadline solely to fail a stuck test. */
function waitMessage(child, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Files/collections integration event deadline exceeded')), 90000);
    function finish(error, value) {
      clearTimeout(timer); child.off('message', receive); child.off('exit', exited);
      error ? reject(error) : resolve(value);
    }
    function receive(message) { if (predicate(message)) finish(null, message); }
    function exited(code) { finish(new Error(`Files/collections worker exited: ${code}`)); }
    child.on('message', receive); child.once('exit', exited);
  });
}

/** Allocate a disposable loopback port without touching any existing service. */
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

/** Run each real ONE instance in an independent process and storage directory. */
async function startWorker(name, commServerUrl, previous) {
  const config = previous ?? {directory: path.join(temporary, name), email: `${name}@model-weights.test`,
    secret: randomBytes(32).toString('hex'), instanceName: name, commServerUrl,
    inviteUrlPrefix: 'https://refinio.one/invite'};
  const logPath = path.join(temporary, `${name}-${workers.length}.log`);
  const log = createWriteStream(logPath);
  const child = fork(path.join(root, 'scripts/files-collections-integration-worker.mjs'), [], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {...process.env, FILER_COLLECTIONS_CONFIG: JSON.stringify(config)},
    execPath: workerNode, execArgv: workerExecArgv
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let requestId = 0;
  const worker = {child, logPath, log, config, stopped: false,
    async command(method, params = {}) {
      const id = ++requestId;
      const response = waitMessage(child, message => message.id === id);
      child.send({id, method, params});
      const result = await response;
      if (result.error) throw new Error(result.error);
      return result.result;
    },
    async stop() {
      await this.command('stop'); this.stopped = true;
      child.kill('SIGTERM');
    }
  };
  workers.push(worker);
  worker.ready = await waitMessage(child, message => message.event === 'ready');
  return worker;
}

/** Read filesystem responses through the same RPC handler the native provider uses. */
async function rpc(worker, method, params) {
  const result = await worker.command('rpc', {method, params});
  if (result.error) throw new Error(result.error.message);
  return result.result;
}

/** Capture a filesystem probe as evidence without making today's projection gap an expected contract. */
async function rpcOutcome(worker, method, params) {
  try { return {ok: true, result: await rpc(worker, method, params)}; }
  catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
}

try {
  const port = await freePort();
  await server.start('127.0.0.1', port);
  const commServerUrl = `ws://127.0.0.1:${port}`;
  const source = await startWorker('collection-source', commServerUrl);
  const recipient = await startWorker('collection-recipient', commServerUrl);
  console.log('1. Files drops retain BLOB references, exact bytes, nested folders, and durable roots');
  const bytes = randomBytes(220000);
  const beforeDrop = (await rpc(recipient, 'getCurrentAnchor', {container: '/Files'})).anchor;
  const notified = waitMessage(recipient.child, event => event.event === 'changed' && event.containers.includes('/Files'));
  await rpc(recipient, 'writeFile', {path: '/Files/document.bin', content: bytes.toString('base64')});
  await notified;
  assert.deepEqual(Buffer.from((await rpc(recipient, 'readFile', {path: '/Files/document.bin'})).content, 'base64'), bytes);
  let stored = await recipient.command('filesRoot');
  assert.equal(stored.entries[0].blob, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(stored.entries[0].size, bytes.length);
  await rpc(recipient, 'writeFile', {path: '/Files/document.bin', content: bytes.toString('base64')});
  assert.equal((await recipient.command('filesRoot')).hash, stored.hash);
  await assert.rejects(rpc(recipient, 'writeFile', {path: '/Files/document.bin', content: 'ZGlmZmVyZW50'}), /different Files item/);
  await assert.rejects(rpc(recipient, 'getChanges', {container: '/Files', since: beforeDrop}), /changed/);
  await rpc(recipient, 'createDir', {path: '/Files/Folder', mode: 0o40755});
  await Promise.all(['a.txt', 'b.txt'].map(name => rpc(recipient, 'writeFile', {path: `/Files/Folder/${name}`, content: 'aGVsbG8='})));
  assert.deepEqual((await rpc(recipient, 'readDir', {path: '/Files/Folder'})).children, ['a.txt', 'b.txt']);
  assert.equal((await rpc(recipient, 'stat', {path: '/Files'})).canAddChildren, true);
  assert.deepEqual((await rpc(recipient, 'readDir', {path: '/Fotos'})).children, []);

  console.log('2. ONE pairing delivers a signed collection, separate from the sender library');
  const fixture = path.resolve(root, '../fotos/fotos.browser/browser-ui/src/lib/__fixtures__/photos/rose-detail.png');
  const photo = await readFile(fixture);
  const entries = await source.command('original', {name: 'rose.png', bytes: photo.toString('base64')});
  const paired = waitMessage(recipient.child, message => message.event === 'paired');
  await recipient.command('pair', {invitation: await source.command('invite')});
  await paired;
  console.log('2a. Contact HTML grants an individual object and removal revokes the relationship');
  const contactNames = (await rpc(recipient, 'readDir', {path: '/contacts'})).children;
  assert.equal(contactNames.length, 1);
  const contactHtml = (await rpc(recipient, 'readFile', {path: `/contacts/${contactNames[0]}/index.html`})).content;
  const objectPath = '/objects/document.bin';
  assert.equal((await rpc(recipient, 'stat', {path: objectPath})).mode & 0o170000, 0o40000);
  const grantStarted = tracePoint();
  const receiptStored = waitMessage(source.child, message => message.event === 'FilerReceivedObjectsRoot')
    .then(message => ({message, observed: tracePoint()}));
  const accessGranted = waitMessage(recipient.child, message =>
    message.event === 'IdAccess' && message.recipients?.includes(source.ready.person))
    .then(message => ({message, observed: tracePoint()}));
  const objectReceived = waitMessage(source.child, message => message.event === 'FilerObjectRoot')
    .then(message => ({message, observed: tracePoint()}));
  const imported = await rpc(recipient, 'writeFile', {path: `${objectPath}/Shared with/index.html`, content: contactHtml});
  const grantReturned = tracePoint();
  assert.equal(imported.path, `${objectPath}/Shared with/${contactNames[0]}`);
  const sharedObject = await objectReceived;
  const storedGrant = await accessGranted;
  const storedReceipt = await receiptStored;
  assert.equal(storedGrant.message.accessId, sharedObject.message.idHash);
  const blobReadStarted = tracePoint();
  const receiverRead = await source.command('objectReadEvidence', {idHash: sharedObject.message.idHash});
  const blobReadCompleted = tracePoint();
  assert.deepEqual(Buffer.from(receiverRead.content, 'base64'), bytes);
  assert.equal(receiverRead.byteLength, bytes.length);
  assert.equal(receiverRead.blobHash, createHash('sha256').update(bytes).digest('hex'));
  const receivedFiles = await rpc(source, 'readDir', {path: '/Files'});
  const receivedObjects = await rpc(source, 'readDir', {path: '/objects'});
  const projectedRead = await rpcOutcome(source, 'readFile', {path: `${objectPath}/document.bin`});
  const receivedRecords = await source.command('receivedObjectRecords');
  const journalPath = '/ONE/System/journal';
  const journalEntries = (await rpc(source, 'readDir', {path: journalPath})).children;
  assert.equal(journalEntries.length, 1);
  const journalRecord = JSON.parse(Buffer.from((await rpc(source, 'readFile', {
    path: `${journalPath}/${journalEntries[0]}`})).content, 'base64').toString('utf8'));
  await assert.rejects(rpc(source, 'unlink', {path: `${journalPath}/${journalEntries[0]}`}), /read-only/);
  assert.deepEqual(receivedFiles.children, []);
  assert.deepEqual(receivedObjects.children, ['document.bin']);
  assert.equal(projectedRead.ok, true);
  assert.deepEqual(Buffer.from(projectedRead.result.content, 'base64'), bytes);
  assert.deepEqual(receivedRecords.map(record => ({source: record.source, rootIdHash: record.rootIdHash,
    rootHash: record.rootHash, path: record.path, size: record.size})), [{source: recipient.ready.person,
    rootIdHash: sharedObject.message.idHash, rootHash: sharedObject.message.hash,
    path: '/document.bin', size: bytes.length}]);
  assert.deepEqual({source: journalRecord.source, rootIdHash: journalRecord.rootIdHash,
    rootHash: journalRecord.rootHash, path: journalRecord.path, size: journalRecord.size},
  {source: recipient.ready.person, rootIdHash: sharedObject.message.idHash,
    rootHash: sharedObject.message.hash, path: '/document.bin', size: bytes.length});
  const accessBeforeRevoke = await recipient.command('objectAccessEvidence', {
    idHash: sharedObject.message.idHash, person: source.ready.person
  });
  assert.equal(accessBeforeRevoke.idGranted, true);
  assert.equal(accessBeforeRevoke.idAccessible, true);
  trace('generic-object-transfer', {surface: 'FileProviderOperations.handle over test child-process IPC',
    nativeFinderExercised: false, grantor: recipient.config.instanceName, grantee: source.config.instanceName,
    workerRuntime: {grantor: recipient.ready.runtime, grantee: source.ready.runtime},
    grantRpc: {started: grantStarted, returned: grantReturned,
      durationMs: traceDuration(grantStarted, grantReturned)},
    authoritativeIdAccessStored: {workerObservedAt: storedGrant.message.observedAt,
      driverObserved: storedGrant.observed, afterGrantStartMs: traceDuration(grantStarted, storedGrant.observed)},
    chumRootArrival: {idHash: sharedObject.message.idHash, hash: sharedObject.message.hash,
      workerObservedAt: sharedObject.message.observedAt, driverObserved: sharedObject.observed,
      afterGrantStartMs: traceDuration(grantStarted, sharedObject.observed),
      afterGrantRpcReturnMs: traceDuration(grantReturned, sharedObject.observed)},
    receiverReceiptStored: {workerObservedAt: storedReceipt.message.observedAt,
      driverObserved: storedReceipt.observed,
      afterGrantStartMs: traceDuration(grantStarted, storedReceipt.observed)},
    receiverStorageRead: {started: blobReadStarted, completed: blobReadCompleted,
      roundTripMs: traceDuration(blobReadStarted, blobReadCompleted), ...receiverRead.timing,
      rootHash: receiverRead.rootHash, entryHash: receiverRead.entryHash,
      blobHash: receiverRead.blobHash, byteLength: receiverRead.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')},
    receiverFilesystemProjection: {files: receivedFiles.children, objects: receivedObjects.children,
      projectedObjectReadable: projectedRead.ok,
      ...(projectedRead.ok ? {} : {readError: projectedRead.error})},
    receiverJournal: {path: journalPath, entries: journalEntries, record: journalRecord}, accessBeforeRevoke});
  const revokeStarted = tracePoint();
  const accessRevoked = waitMessage(recipient.child, message => message.event === 'IdAccess' &&
    message.accessId === sharedObject.message.idHash && !message.recipients?.includes(source.ready.person))
    .then(message => ({message, observed: tracePoint()}));
  await rpc(recipient, 'rmdir', {path: imported.path});
  const revokeReturned = tracePoint();
  const storedRevocation = await accessRevoked;
  const accessCheckStarted = tracePoint();
  const accessAfterRevoke = await recipient.command('objectAccessEvidence', {
    idHash: sharedObject.message.idHash, person: source.ready.person
  });
  const accessCheckCompleted = tracePoint();
  assert.equal(accessAfterRevoke.idGranted, false);
  assert.equal(accessAfterRevoke.idAccessible, false);
  assert.equal(accessAfterRevoke.rootAccessible, false);
  assert.equal(accessAfterRevoke.entryAccessible, false);
  assert.equal(accessAfterRevoke.blobAccessible, false);
  assert.deepEqual((await rpc(recipient, 'readDir', {path: `${objectPath}/Shared with`})).children, []);
  assert.deepEqual((await rpc(source, 'readDir', {path: '/objects'})).children, ['document.bin']);
  assert.deepEqual(Buffer.from((await rpc(source, 'readFile', {path: `${objectPath}/document.bin`})).content, 'base64'), bytes);
  trace('generic-object-revocation', {surface: 'FileProviderOperations.handle over test child-process IPC',
    nativeFinderExercised: false, revokeRpc: {started: revokeStarted, returned: revokeReturned,
      durationMs: traceDuration(revokeStarted, revokeReturned)},
    authoritativeIdAccessStored: {workerObservedAt: storedRevocation.message.observedAt,
      driverObserved: storedRevocation.observed,
      afterRevokeStartMs: traceDuration(revokeStarted, storedRevocation.observed),
      recipients: storedRevocation.message.recipients},
    effectiveAccessCheck: {started: accessCheckStarted, completed: accessCheckCompleted,
      roundTripMs: traceDuration(accessCheckStarted, accessCheckCompleted), ...accessAfterRevoke},
    retainedCopyGuarantee: 'Previously received immutable objects remain in receiver storage; future root versions are no longer id-accessible'});
  await rpc(recipient, 'writeFile', {path: `${objectPath}/People in photo/index.html`, content: contactHtml});
  assert.deepEqual((await rpc(recipient, 'readDir', {path: `${objectPath}/Shared with`})).children, []);
  assert.deepEqual((await rpc(recipient, 'readDir', {path: `${objectPath}/People in photo`})).children, contactNames);
  const received = waitMessage(recipient.child, message => message.event === 'FotosShareCertificateChain');
  await source.command('share', {person: recipient.ready.person, collection: 'Summer', entries});
  await received;
  const folders = (await rpc(recipient, 'readDir', {path: '/Fotos'})).children;
  assert.equal(folders.length, 1);
  assert.ok(folders[0].startsWith('Summer '));
  const collection = `/Fotos/${folders[0]}`;
  const photoPath = `${collection}/rose.png`;
  await rpc(recipient, 'readDir', {path: collection});
  assert.deepEqual(Buffer.from((await rpc(recipient, 'readFile', {path: photoPath})).content, 'base64'), photo);
  await assert.rejects(rpc(recipient, 'writeFile', {path: '/Fotos/import.png', content: photo.toString('base64')}), /read-only/);
  const galleryReceived = waitMessage(recipient.child, message => message.event === 'FotosShareCertificateChain');
  await source.command('share', {person: recipient.ready.person, collection: 'Entire library', kind: 'gallery', entries});
  await galleryReceived;
  assert.deepEqual((await rpc(recipient, 'readDir', {path: '/Fotos'})).children, folders);

  console.log('3. Live collection membership, offline restart, and revocation');
  const removed = waitMessage(recipient.child, message => message.event === 'FotosShareManifest');
  await source.command('share', {person: recipient.ready.person, collection: 'Summer', entries: []});
  await removed;
  assert.deepEqual((await rpc(recipient, 'readDir', {path: collection})).children, []);
  await assert.rejects(rpc(recipient, 'readFile', {path: photoPath}), /does not exist/);
  const restored = waitMessage(recipient.child, message => message.event === 'FotosShareManifest');
  await source.command('share', {person: recipient.ready.person, collection: 'Summer', entries});
  await restored;
  console.log('Collection membership updates passed; restarting recipient');
  await recipient.stop();
  const reopened = await startWorker('recipient-reopened', commServerUrl, recipient.config);
  assert.deepEqual(Buffer.from((await rpc(reopened, 'readFile', {path: '/Files/document.bin'})).content, 'base64'), bytes);
  assert.deepEqual((await rpc(reopened, 'readDir', {path: `${objectPath}/Shared with`})).children, []);
  assert.deepEqual((await rpc(reopened, 'readDir', {path: `${objectPath}/People in photo`})).children, contactNames);
  assert.deepEqual(Buffer.from((await rpc(reopened, 'readFile', {path: photoPath})).content, 'base64'), photo);
  console.log('Restart restored Files and the received collection; reconnecting for revocation');
  const reconnected = waitMessage(reopened.child, message => message.event === 'paired');
  await reopened.command('pair', {invitation: await source.command('invite')});
  await reconnected;
  const revoked = waitMessage(reopened.child, message => message.event === 'FotosShareCertificateChain' && message.status === 'revoked' && message.collection === 'Summer');
  await source.command('revoke', {person: reopened.ready.person, collection: 'Summer'});
  await revoked;
  assert.deepEqual((await rpc(reopened, 'readDir', {path: '/Fotos'})).children, []);
  await assert.rejects(rpc(reopened, 'readFile', {path: photoPath}), /does not exist/);
  console.log('Generic received object remains projected after recipient restart');
  await source.stop();
  const sourceReopened = await startWorker('source-reopened', commServerUrl, source.config);
  assert.deepEqual((await rpc(sourceReopened, 'readDir', {path: '/objects'})).children, ['document.bin']);
  assert.deepEqual(Buffer.from((await rpc(sourceReopened, 'readFile', {path: `${objectPath}/document.bin`})).content, 'base64'), bytes);
  assert.equal((await sourceReopened.command('receivedObjectRecords')).length, 1);
  assert.deepEqual((await rpc(sourceReopened, 'readDir', {path: journalPath})).children, journalEntries);
  console.log('PASS: Files imports; projected received generic objects; contact HTML object sharing and revocation; independent persisted photo associations; signed collection sharing, updates, and restart');
} catch (error) {
  for (const worker of workers) console.error(`${worker.logPath}\n${(await readFile(worker.logPath, 'utf8')).slice(-12000)}`);
  throw error;
} finally {
  for (const worker of workers) {
    if (!worker.stopped && worker.child.exitCode === null && worker.child.connected) {
      try { await worker.stop(); } catch { worker.child.kill('SIGTERM'); }
    }
    worker.log.end();
  }
  await server.stop();
  await rm(temporary, {recursive: true, force: true});
}
