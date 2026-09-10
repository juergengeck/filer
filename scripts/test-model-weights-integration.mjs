import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile, symlink} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filer-model-weights-'));
const workers = [];
const server = new CommunicationServer();
const chunkSize = 4 * 1024 * 1024;

/** Wait on an owning process event, with a deadline solely to fail a stuck test. */
function waitMessage(child, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Model integration event deadline exceeded')), 90000);
    function finish(error, value) {
      clearTimeout(timer); child.off('message', receive); child.off('exit', exited);
      error ? reject(error) : resolve(value);
    }
    function receive(message) { if (predicate(message)) finish(null, message); }
    function exited(code) { finish(new Error(`Model worker exited: ${code}`)); }
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
  const child = fork(path.join(root, 'scripts/model-weights-integration-worker.mjs'), [], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {...process.env, MODEL_WEIGHTS_TEST_CONFIG: JSON.stringify(config)}
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

try {
  const commServerUrl = `ws://127.0.0.1:${await freePort()}`;
  await server.start('127.0.0.1', Number(new URL(commServerUrl).port));
  const snapshot = path.join(temporary, 'snapshot');
  await mkdir(path.join(snapshot, 'sub'), {recursive: true});
  const weights = randomBytes(chunkSize * 2 + 257);
  await writeFile(path.join(snapshot, 'model.safetensors'), weights);
  await writeFile(path.join(snapshot, 'config.json'), '{"model_type":"fixture"}\n');
  await writeFile(path.join(snapshot, 'sub', 'empty'), Buffer.alloc(0));
  const source = await startWorker('source', commServerUrl);
  const publish = {directory: snapshot, model: 'test/Qwen-27B', revision: 'fixture-v1', format: 'safetensors', source: 'fixture://model'};
  const sourceBefore = (await rpc(source, 'getCurrentAnchor', {container: 'workingSet'})).anchor;
  const projectionChanged = waitMessage(source.child, message => message.event === 'projection');
  const hash = await source.command('publish', publish);
  assert.ok((await projectionChanged).containers.includes('workingSet'));
  const sourceAfter = (await rpc(source, 'getCurrentAnchor', {container: 'workingSet'})).anchor;
  assert.notEqual(sourceBefore, sourceAfter);
  assert.equal(await source.command('publish', publish), hash, 'Repeated publication must preserve the revision identity');
  assert.equal((await rpc(source, 'getCurrentAnchor', {container: 'workingSet'})).anchor, sourceAfter,
    'An idempotent publication must not fabricate a filesystem change');
  const outside = path.join(temporary, 'outside-snapshot');
  await writeFile(outside, 'must not be published');
  await symlink(outside, path.join(snapshot, 'escape'));
  await assert.rejects(source.command('publish', publish), /escapes its allowed root/);
  await rm(path.join(snapshot, 'escape'));
  const fileChunks = await source.command('chunks', {hash});
  const chunks = fileChunks.flat();
  const recipient = await startWorker('recipient', commServerUrl);
  assert.deepEqual(await recipient.command('list'), []);
  const recipientBefore = (await rpc(recipient, 'getCurrentAnchor', {container: 'workingSet'})).anchor;
  const invitation = await source.command('invite');
  const sourcePaired = waitMessage(source.child, message => message.event === 'paired');
  const recipientPaired = waitMessage(recipient.child, message => message.event === 'paired');
  await recipient.command('pair', {invitation});
  assert.equal((await sourcePaired).person, recipient.ready.person);
  assert.equal((await recipientPaired).person, source.ready.person);
  const received = waitMessage(recipient.child, message => message.event === 'revision' && message.hash === hash);
  await source.command('share', {hash, person: recipient.ready.person});
  await received;
  const library = await recipient.command('list');
  assert.equal(library.length, 1);
  assert.equal(library[0].pinned, false);
  for (const chunk of chunks) assert.equal(await recipient.command('exists', {hash: chunk}), false,
    'Browsing metadata must not replicate weight BLOBs');
  const modelDirectory = (await rpc(recipient, 'readDir', {path: '/models'})).children[0];
  const revisionDirectory = (await rpc(recipient, 'readDir', {path: `/models/${modelDirectory}`})).children[0];
  const filePath = `/models/${modelDirectory}/${revisionDirectory}/model.safetensors`;
  const stat = await rpc(recipient, 'stat', {path: filePath});
  assert.equal(stat.size, weights.length);
  assert.match(stat.item.id, /^filer:[a-f0-9]{64}$/);
  assert.equal(stat.item.contentVersion, createHash('sha256').update(weights).digest('hex'));
  assert.deepEqual(await rpc(recipient, 'getItem', {id: stat.item.id}), stat.item);
  const projected = [];
  let changedAnchor = recipientBefore;
  for (;;) {
    const changes = await rpc(recipient, 'getChanges', {container: 'workingSet', since: changedAnchor, limit: 2});
    projected.push(...changes.updated);
    changedAnchor = changes.newAnchor;
    if (!changes.moreComing) break;
  }
  assert.equal(projected.filter(item => item.id === stat.item.id).length, 1);
  await assert.rejects(rpc(recipient, 'getChanges', {container: 'workingSet', since: '0'}), /anchor/);
  await assert.rejects(rpc(recipient, 'getCurrentAnchor', {container: 'chats'}), /does not provide change tracking/);
  await assert.rejects(rpc(recipient, 'readItemContent', {id: stat.item.id, version: 'stale', position: 0, length: 1}), /version/);
  await assert.rejects(rpc(recipient, 'unlink', {path: filePath}), /read-only/);
  await assert.rejects(rpc(recipient, 'readFile', {path: filePath}), /chunked reads/);
  await assert.rejects(rpc(recipient, 'readFileInChunks', {path: filePath, length: chunkSize + 1, position: 0}), /range/);
  // Reading one range fetches only its chunk and must not silently pin the revision.
  assert.deepEqual(Buffer.from((await rpc(recipient, 'readFileInChunks', {path: filePath, length: 137,
    position: chunkSize + 29})).content, 'base64'), weights.subarray(chunkSize + 29, chunkSize + 166));
  const fetchedHash = createHash('sha256').update(weights.subarray(chunkSize, chunkSize * 2)).digest('hex');
  for (const chunk of chunks) assert.equal(await recipient.command('exists', {hash: chunk}), chunk === fetchedHash,
    'A range read must fetch only its intersecting chunks');
  assert.equal((await recipient.command('list'))[0].pinned, false);
  // Previously verified chunks are sufficient resume state; no transfer ledger is needed.
  await recipient.command('seed', {bytes: weights.subarray(0, chunkSize).toString('base64')});
  await recipient.command('pin', {hash});
  assert.equal((await recipient.command('list'))[0].pinned, true);
  const actual = [];
  for (let position = 0; position < weights.length; position += 1000000) {
    actual.push(Buffer.from((await rpc(recipient, 'readFileInChunks', {path: filePath, length: 1000000, position})).content, 'base64'));
  }
  assert.equal(createHash('sha256').update(Buffer.concat(actual)).digest('hex'), createHash('sha256').update(weights).digest('hex'));
  assert.equal((await rpc(recipient, 'readFileInChunks', {path: filePath, length: 10, position: weights.length})).content, '');
  await source.stop();
  await recipient.stop();
  const offline = await startWorker('recipient-offline', commServerUrl, recipient.config);
  assert.equal((await offline.command('list'))[0].pinned, true);
  assert.equal((await rpc(offline, 'getCurrentAnchor', {container: 'workingSet'})).anchor, changedAnchor);
  assert.deepEqual(await rpc(offline, 'getItem', {id: stat.item.id}), stat.item);
  assert.equal((await rpc(offline, 'getChanges', {container: 'workingSet', since: recipientBefore})).updated
    .filter(item => item.id === stat.item.id).length, 1);
  assert.deepEqual(Buffer.from((await rpc(offline, 'readFileInChunks', {path: filePath, length: 137, position: chunkSize - 70})).content, 'base64'),
    weights.subarray(chunkSize - 70, chunkSize + 67));
  const firstChunkHash = createHash('sha256').update(weights.subarray(0, chunkSize)).digest('hex');
  const corrupted = Buffer.from(weights.subarray(0, chunkSize));
  corrupted[0] ^= 1;
  await offline.command('corrupt', {hash: firstChunkHash, bytes: corrupted.toString('base64')});
  await assert.rejects(rpc(offline, 'readFileInChunks', {path: filePath, length: 137, position: 0}), /integrity failure/);
  await offline.command('corrupt', {hash: firstChunkHash, bytes: weights.subarray(0, chunkSize).toString('base64')});
  const third = await startWorker('third', commServerUrl);
  const onwardInvitation = await offline.command('invite');
  await third.command('pair', {invitation: onwardInvitation});
  const onward = waitMessage(third.child, message => message.event === 'revision' && message.hash === hash);
  await offline.command('share', {hash, person: third.ready.person});
  await onward;
  const originalContent = await offline.command('content', {hash});
  await offline.command('setContent', {content: {...originalContent, files: [...originalContent.files].reverse()}});
  await assert.rejects(rpc(third, 'readFileInChunks', {path: filePath, length: 257, position: chunkSize * 2}),
    /commitment mismatch/);
  assert.equal((await third.command('list'))[0].pinned, false);
  for (const chunk of chunks) assert.equal(await third.command('exists', {hash: chunk}), false);
  await offline.command('setContent', {content: originalContent});
  await third.command('pin', {hash});
  assert.deepEqual(Buffer.from((await rpc(third, 'readFileInChunks', {path: filePath, length: 257, position: chunkSize * 2})).content, 'base64'),
    weights.subarray(chunkSize * 2));
  console.log('PASS: immutable publish, metadata-only CHUM sharing, on-demand range reads, persistent item IDs and change cursors, resumed pin, checksum, bounded RPC reads, read-only paths, offline restart, corruption rejection, and onward sharing');
} catch (error) {
  for (const worker of workers) console.error(`${worker.logPath}\n${(await readFile(worker.logPath, 'utf8')).slice(-16000)}`);
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
