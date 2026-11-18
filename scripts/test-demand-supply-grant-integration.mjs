import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/communicationServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filer-demand-supply-grant-'));
const workers = [];
const server = new CommunicationServer();
const workerNode = process.env.FILER_TEST_NODE ?? process.execPath;
const workerExecArgv = process.env.FILER_TEST_NODE_ARGS === undefined
  ? process.execArgv
  : JSON.parse(process.env.FILER_TEST_NODE_ARGS);
if (!Array.isArray(workerExecArgv) || !workerExecArgv.every(value => typeof value === 'string')) {
  throw new Error('FILER_TEST_NODE_ARGS must be a JSON array of Node arguments');
}

/** Wait on an owning process event, with a deadline solely to fail a stuck test. */
function waitMessage(child, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Demand/supply/grant event deadline exceeded')), 90000);
    function finish(error, value) {
      clearTimeout(timer); child.off('message', receive); child.off('exit', exited);
      error ? reject(error) : resolve(value);
    }
    function receive(message) { if (predicate(message)) finish(null, message); }
    function exited(code) { finish(new Error(`Demand/supply/grant worker exited: ${code}`)); }
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
async function startWorker(name, commServerUrl) {
  const config = {directory: path.join(temporary, name), email: `${name}@demand-supply.test`,
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
  // Every message since fork, so steps can assert what did NOT arrive.
  const messages = [];
  child.on('message', message => messages.push(message));
  let requestId = 0;
  const worker = {child, logPath, log, config, messages, stopped: false,
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

const PICTURES = 'tag:category:pictures';

try {
  const port = await freePort();
  await server.start('127.0.0.1', port);
  const commServerUrl = `ws://127.0.0.1:${port}`;
  const owner = await startWorker('demand-owner', commServerUrl);
  const supplier = await startWorker('demand-supplier', commServerUrl);
  const stranger = await startWorker('demand-stranger', commServerUrl);

  console.log('1. Pair all instances over the local relay');
  for (const [first, second] of [[owner, supplier], [supplier, stranger]]) {
    const paired = waitMessage(second.child, message => message.event === 'paired');
    await second.command('pair', {invitation: await first.command('invite')});
    await paired;
  }

  console.log('2. Owner demand for pictures reaches the supplier over CHUM');
  const demand = await owner.command('demandCategory', {tagId: PICTURES, active: true});
  assert.equal(demand.demand.status, 'active');
  assert.deepEqual(demand.demand.requiredTagIds, [PICTURES]);
  // Each listener is attached before its trigger: CHUM can deliver before
  // the triggering command's reply reaches this process.
  const demandArrived = waitMessage(supplier.child,
    message => message.event === 'RuntimeDemand' && message.idHash === demand.idHash);
  await owner.command('grantAccess', {idHash: demand.idHash, person: supplier.ready.person});
  assert.equal((await demandArrived).hash, demand.hash);

  console.log('3. Supplier supply matches, and the grant reaches the owner like content');
  const supply = await supplier.command('publishSupply', {governedTagIds: [PICTURES]});
  const supplyArrived = waitMessage(owner.child,
    message => message.event === 'RuntimeSupply' && message.idHash === supply.idHash);
  await supplier.command('grantAccess', {idHash: supply.idHash, person: owner.ready.person});
  assert.equal((await supplyArrived).hash, supply.hash);
  // The certificate's id is only known after matchAndGrant returns; it is the
  // only AccessCertificate the owner receives in this run.
  const certArrived = waitMessage(owner.child, message => message.event === 'AccessCertificate');
  const grant = await supplier.command('matchAndGrant', {demandIdHash: demand.idHash,
    supplyIdHash: supply.idHash, subject: owner.ready.person, tagId: PICTURES});
  assert.equal(grant.matched, true);
  const certMessage = await certArrived;
  assert.equal(certMessage.idHash, grant.certIdHash);
  assert.equal(certMessage.hash, grant.certHash);
  const cert = (await owner.command('objectByIdHash', {idHash: grant.certIdHash})).obj;
  assert.equal(cert.$type$, 'AccessCertificate');
  assert.equal(cert.subject, owner.ready.person);
  assert.deepEqual(JSON.parse(cert.grantedTagIds), [PICTURES]);

  console.log('4. Another person demand makes nothing visible until the owner supplies');
  const strangerDemand = await stranger.command('demandCategory', {tagId: PICTURES, active: true});
  const strangerDemandArrived = waitMessage(supplier.child,
    message => message.event === 'RuntimeDemand' && message.idHash === strangerDemand.idHash);
  await stranger.command('grantAccess', {idHash: strangerDemand.idHash, person: supplier.ready.person});
  await strangerDemandArrived;
  // The supplier holds the certificate and its access grants: a demand alone
  // must not grant the stranger anything there.
  const supplierView = await supplier.command('idAccessEvidence',
    {person: stranger.ready.person, idHash: grant.certIdHash});
  assert.equal(supplierView.idGranted, false);
  assert.equal(supplierView.idAccessible, false);
  // The supplier-stranger channel just carried the stranger's demand, so a
  // leaked certificate would have had the same path to arrive.
  assert.equal(stranger.messages.some(message =>
    message.event === 'AccessCertificate' && message.idHash === grant.certIdHash), false);
  const strangerAccess = await stranger.command('idAccessEvidence',
    {person: stranger.ready.person, idHash: grant.certIdHash});
  assert.equal(strangerAccess.idGranted, false);
  assert.equal(strangerAccess.idAccessible, false);
  await assert.rejects(stranger.command('objectByIdHash', {idHash: grant.certIdHash}));

  console.log('5. Unchecking withdraws the demand, ends matching, keeps received objects');
  const withdrawnArrived = waitMessage(supplier.child,
    message => message.event === 'RuntimeDemand' && message.idHash === demand.idHash
      && message.hash !== demand.hash);
  const withdrawn = await owner.command('demandCategory', {tagId: PICTURES, active: false});
  assert.equal(withdrawn.demand.status, 'withdrawn');
  assert.equal(withdrawn.idHash, demand.idHash);
  assert.equal((await withdrawnArrived).hash, withdrawn.hash);
  const remarried = await supplier.command('matchAndGrant', {demandIdHash: demand.idHash,
    supplyIdHash: supply.idHash, subject: owner.ready.person, tagId: PICTURES});
  assert.equal(remarried.matched, false);
  const kept = await owner.command('objectByIdHash', {idHash: supply.idHash});
  assert.equal(kept.hash, supply.hash);
  const keptCert = await owner.command('objectByIdHash', {idHash: grant.certIdHash});
  assert.equal(keptCert.hash, grant.certHash);

  console.log('PASS: demand reaches supplier, supply matches, tag grant arrives over CHUM, stranger sees nothing, withdrawn demand stops matching');
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
