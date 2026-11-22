import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getBuiltOneWorkspacePackagePath} from '../../test-support/one-workspace-paths.js';

const {default: CommunicationServer} = await import(pathToFileURL(getBuiltOneWorkspacePackagePath(
  fileURLToPath(new URL('.', import.meta.url)),
  'one.models', 'misc/ConnectionEstablishment/communicationServer/CommunicationServer.js'
)).href);
const deadlineMs = 45_000;

/** Reserve an ephemeral loopback port for CommunicationServer's explicit port API. */
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const {port} = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Launch a fresh process and expose its request, event, and teardown channels. */
function launchWorker(entry, config) {
  const child = fork(entry, [], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let log = '';
  let requestId = 0;
  let failure;
  let closed = false;
  let ready = false;
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true;
    resolve({code, signal});
  }));
  function logChunk(chunk) {
    log = (log + chunk).slice(-12_000);
  }
  child.stdout.on('data', logChunk);
  child.stderr.on('data', logChunk);
  child.on('error', error => { failure = error; });

  /** Wait on one IPC event or reply, with a bounded failure deadline. */
  function wait(description, predicate) {
    return new Promise((resolve, reject) => {
      if (failure || closed) {
        reject(failure ?? new Error(`${config.instanceName} closed before ${description}`));
        return;
      }
      const timer = setTimeout(() => finish(new Error(
        `${config.instanceName} timed out waiting for ${description}`
      )), deadlineMs);
      function finish(error, value) {
        clearTimeout(timer);
        child.off('message', receive);
        child.off('error', fail);
        child.off('close', close);
        if (error) reject(error);
        else resolve(value);
      }
      function receive(message) {
        if (predicate(message)) finish(undefined, message);
      }
      function fail(error) { finish(error); }
      function close(code, signal) {
        finish(new Error(`${config.instanceName} exited (${code ?? signal}) before ${description}`));
      }
      child.on('message', receive);
      child.once('error', fail);
      child.once('close', close);
    });
  }

  return {
    config,
    get log() { return log; },
    async command(method, params) {
      const id = ++requestId;
      const reply = wait(method, message => message.id === id);
      const sent = new Promise((resolve, reject) =>
        child.send({id, method, params}, error => error ? reject(error) : resolve()));
      const [response] = await Promise.all([reply, sent]);
      if (response.error) throw Object.assign(new Error(response.error.message), {code: response.error.code});
      return response.result;
    },
    event(name, predicate, description = name) {
      return wait(description, message => message.event === name && predicate(message));
    },
    async start() {
      const identity = await this.command('start', config);
      ready = true;
      return identity;
    },
    async stop() {
      if (closed) return;
      // Reserve a short deadline for shutdown itself, including stuck model teardown.
      const kill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      const graceful = ready && child.connected;
      try {
        if (graceful) await this.command('stop');
        else child.kill('SIGTERM');
      } finally {
        const {code, signal} = await exited;
        clearTimeout(kill);
        if (graceful && code !== 0) {
          throw new Error(`${config.instanceName} shutdown exited with ${code ?? signal}`);
        }
      }
    }
  };
}

/** Run a scenario against independent stores and one disposable loopback relay. */
export async function withHarness(scenario) {
  const directory = await mkdtemp(join(tmpdir(), 'filer-chum-'));
  const workers = [];
  const server = new CommunicationServer();
  let scenarioFailed = false;
  try {
    const port = await freePort();
    await server.start('127.0.0.1', port);
    await scenario({
      async start(entry, name, previousConfig) {
        const worker = launchWorker(entry, previousConfig ?? {
          directory: join(directory, name), email: `${name}@filer.test.invalid`,
          secret: randomBytes(32).toString('hex'), instanceName: name,
          commServerUrl: `ws://127.0.0.1:${port}`, inviteUrlPrefix: 'https://filer.test.invalid/invite'
        });
        workers.push(worker);
        worker.identity = await worker.start();
        return worker;
      }
    });
  } catch (error) {
    scenarioFailed = true;
    for (const worker of workers) {
      if (worker.log) console.error(`--- ${worker.config.instanceName} ---\n${worker.log}`);
    }
    throw error;
  } finally {
    const cleanups = await Promise.allSettled(workers.map(worker => worker.stop()));
    try {
      await server.stop();
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
    const failures = cleanups.filter(cleanup => cleanup.status === 'rejected').map(cleanup => cleanup.reason);
    if (!scenarioFailed && failures.length > 0) throw new AggregateError(failures, 'Worker teardown failed');
    for (const failure of failures) console.error('Worker teardown failed', failure);
  }
}
