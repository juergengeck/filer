#!/usr/bin/env node

import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {access, mkdtemp, readFile, realpath, rename, stat, writeFile} from 'node:fs/promises';
import {createServer, createConnection} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oneWorkspace = path.resolve(repository, '../one');
const fotosWorkspace = path.resolve(repository, '../fotos');
const vgerWorkspace = path.resolve(repository, '../vger');
const provider = path.join(repository, 'one.provider');
const browserUi = path.join(fotosWorkspace, 'fotos.browser/browser-ui');
const registrarPackage = path.join(vgerWorkspace, 'packages/vger.headless');
const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), 'filer-glue-fotos-'));
const launcherReportPath = path.join(evidenceDirectory, 'launcher-report.json');
const configurationPath = path.join(evidenceDirectory, 'configuration.json');
const protocolReportPath = path.join(evidenceDirectory, 'filer-protocol-report.json');
const runId = randomUUID();
const runLabel = runId.slice(0, 8);
const ownedProcesses = [];
const browserActors = [];
const openLogs = [];
const startedAt = new Date().toISOString();
const overallDeadlineMs = 30 * 60 * 1000;
const buildDeadlineMs = 15 * 60 * 1000;
const startupDeadlineMs = 2 * 60 * 1000;
const nativeTestDeadlineMs = 12 * 60 * 1000;
let stopping = false;
let fatalError;
let resolveFatal;
const fatal = new Promise(function createFatalPromise(resolve) {
  resolveFatal = resolve;
});
const report = {
  runId,
  status: 'starting',
  startedAt,
  evidenceDirectory,
  configurationPath,
  protocolReportPath,
  browserProfiles: {},
  ports: {},
  actors: {},
  builds: [],
  cleanup: {completed: false, errors: []},
};

/** Convert an unknown thrown value to an Error. */
function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

/** Record the first fatal actor or process failure and wake active waits. */
function signalFailure(value) {
  if (fatalError || stopping) return;
  fatalError = asError(value);
  resolveFatal(fatalError);
}

/** Fail immediately if an owned actor already disconnected. */
function throwIfFailed() {
  if (fatalError) throw fatalError;
}

/** Persist launcher state atomically in the retained evidence directory. */
async function writeLauncherReport() {
  const temporaryPath = `${launcherReportPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporaryPath, launcherReportPath);
}

/** Allocate an unused loopback TCP port for one disposable service. */
async function getFreePort() {
  const server = createServer();
  await new Promise(function listen(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a loopback port');
  await new Promise(function close(resolve, reject) {
    server.close(function closed(error) {
      if (error) reject(error);
      else resolve();
    });
  });
  return address.port;
}

/** Wait for a promise while also observing the launcher and operation deadlines. */
async function waitBounded(label, operation, timeoutMs) {
  let timer;
  const timeout = new Promise(function createTimeout(resolve) {
    timer = setTimeout(function expire() {
      resolve({error: new Error(`${label} exceeded its ${timeoutMs} ms deadline`)});
    }, timeoutMs);
  });
  const outcome = await Promise.race([
    operation.then(
      function succeeded(value) { return {value}; },
      function failed(error) { return {error: asError(error)}; },
    ),
    fatal.then(function actorFailed(error) { return {error}; }),
    timeout,
  ]);
  clearTimeout(timer);
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

/** Sleep between bounded service probes, waking immediately for actor failure. */
async function waitProbeInterval() {
  const outcome = await Promise.race([
    new Promise(function delay(resolve) { setTimeout(function finishDelay() { resolve(null); }, 250); }),
    fatal,
  ]);
  if (outcome instanceof Error) throw outcome;
}

/** Poll a short local readiness probe until it returns a useful value. */
async function waitFor(label, probe, timeoutMs = startupDeadlineMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    throwIfFailed();
    try {
      const value = await probe();
      if (value !== undefined && value !== false && value !== null) return value;
    } catch (error) {
      lastError = asError(error);
    }
    await waitProbeInterval();
  }
  const detail = lastError ? `: ${lastError.message}` : '';
  throw new Error(`${label} did not become ready within ${timeoutMs} ms${detail}`);
}

/** Fetch JSON from a local QA service with a short per-request deadline. */
async function fetchJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(3000)});
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

/** Check whether a loopback TCP listener is accepting connections. */
async function isListening(port) {
  return new Promise(function connect(resolve) {
    const socket = createConnection({host: '127.0.0.1', port});
    socket.once('connect', function connected() {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', function unavailable() { resolve(false); });
    socket.setTimeout(1000, function timedOut() {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Start one child in its own process group so cleanup cannot affect unrelated processes. */
function startOwnedProcess(name, command, args, options = {}) {
  const logPath = options.logPath;
  const log = logPath ? createWriteStream(logPath) : undefined;
  if (log) openLogs.push(log);
  const child = spawn(command, args, {
    cwd: options.cwd ?? repository,
    env: options.env ?? process.env,
    detached: true,
    stdio: log ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  const record = {name, child, logPath, mustStayRunning: options.mustStayRunning === true};
  ownedProcesses.push(record);
  if (log) {
    child.stdout.pipe(log, {end: false});
    child.stderr.pipe(log, {end: false});
    if (options.onStdout) child.stdout.on('data', options.onStdout);
    if (options.onStderr) child.stderr.on('data', options.onStderr);
  }
  record.exit = new Promise(function observeExit(resolve, reject) {
    child.once('error', function processError(error) {
      const wrapped = new Error(`${name} failed to start: ${error.message}`);
      if (record.mustStayRunning) signalFailure(wrapped);
      reject(wrapped);
    });
    child.once('exit', function processExit(code, signal) {
      const outcome = {code, signal};
      if (record.mustStayRunning && !stopping) {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        signalFailure(new Error(`${name} exited unexpectedly with ${reason}; log: ${logPath}`));
      }
      resolve(outcome);
    });
  });
  record.closed = new Promise(function observeClose(resolve) {
    child.once('close', function processClosed() {
      if (log) log.end(resolve);
      else resolve();
    });
  });
  return record;
}

/** Run a finite build or inspection command with a bounded deadline. */
async function runCommand(label, command, args, options = {}) {
  console.log(`BUILD: ${label}`);
  const started = Date.now();
  const child = startOwnedProcess(label, command, args, options);
  const outcome = await waitBounded(label, child.exit, options.timeoutMs ?? buildDeadlineMs);
  const result = {label, durationMs: Date.now() - started, code: outcome.code, signal: outcome.signal};
  report.builds.push(result);
  await writeLauncherReport();
  if (outcome.code !== 0) {
    const reason = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
    throw new Error(`${label} failed with ${reason}`);
  }
  return result;
}

/** Capture stdout from a short finite tool invocation. */
async function captureCommand(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repository,
    env: options.env ?? process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = {name: label, child, mustStayRunning: false};
  ownedProcesses.push(record);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', function readStdout(bytes) { stdout += bytes.toString(); });
  child.stderr.on('data', function readStderr(bytes) { stderr += bytes.toString(); });
  record.exit = new Promise(function observeExit(resolve, reject) {
    child.once('error', function processError(error) { reject(new Error(`${label} failed to start: ${error.message}`)); });
    child.once('exit', function processExit(code, signal) { resolve({code, signal}); });
  });
  record.closed = new Promise(function observeClose(resolve) { child.once('close', resolve); });
  const outcome = await waitBounded(label, record.exit, options.timeoutMs ?? 30000);
  if (outcome.code !== 0) throw new Error(`${label} failed: ${stderr.trim() || `exit code ${outcome.code}`}`);
  return stdout.trim();
}

/** Resolve and validate the Node 24 binary embedded into the native runtime. */
async function resolveNodeBinary() {
  const configured = process.env.NODE_BINARY;
  if (configured && !path.isAbsolute(configured)) throw new Error('NODE_BINARY must be an absolute path');
  const candidate = configured ?? path.join(provider, 'build/toolchain/node');
  await access(candidate);
  const binary = await realpath(candidate);
  const version = await captureCommand('Node version check', binary, ['--version']);
  if (!/^v24\./.test(version)) throw new Error(`Glue/Fotos/Filer QA requires Node 24, received ${version} from ${binary}`);
  report.node = {binary, version};
  return binary;
}

/** Build every artifact consumed by the live integration run. */
async function buildPrerequisites(nodeBinary) {
  report.status = 'building';
  await writeLauncherReport();
  await runCommand('shared platform packages', 'pnpm', ['run', 'build:models']);
  await runCommand('canonical one.models', 'pnpm', ['--dir', path.join(oneWorkspace, 'packages/one.models'), 'run', 'build:src']);
  await runCommand('Glue registrar', 'pnpm', ['--dir', registrarPackage, 'run', 'build']);
  await runCommand('packaged Filer runtime', process.execPath, [path.join(provider, 'scripts/bundle-runtime.mjs')], {
    env: {...process.env, NODE_BINARY: nodeBinary},
  });
  await runCommand('native Filer tests', 'xcrun', ['swift', 'build', '--package-path', provider, '--build-tests']);
}

/** Load the current registrar authority key used by both Fotos actors. */
async function waitForRegistrarAuthority(apiBase) {
  return waitFor('Glue registrar authority', async function probeAuthority() {
    const payload = await fetchJson(`${apiBase}/api/registration/authority/publicKey`);
    const publicKey = payload?.data?.publicKey ?? payload?.publicKey;
    return typeof publicKey === 'string' && publicKey.length > 0 ? publicKey : undefined;
  });
}

/** Start the production relay, registrar, and stable Vite QA actor servers. */
async function startServices(nodeBinary, ports) {
  const commServerUrl = `ws://127.0.0.1:${ports.relay}`;
  const glueApiBase = `http://127.0.0.1:${ports.registrar}`;
  startOwnedProcess('relay', nodeBinary, [
    path.join(oneWorkspace, 'packages/one.models/comm_server.bundle.js'),
    '-h', '127.0.0.1', '-p', String(ports.relay), '-l',
  ], {mustStayRunning: true, logPath: path.join(evidenceDirectory, 'relay.log')});
  await waitFor('production relay', async function probeRelay() { return isListening(ports.relay); });

  startOwnedProcess('registrar', nodeBinary, [
    path.join(registrarPackage, 'dist/cli.js'),
    '--host', '127.0.0.1', '--port', String(ports.registrar),
    '--quicvc-port', String(ports.quicvc),
    '--storage', path.join(evidenceDirectory, 'registrar-store'),
    '--comm-server', commServerUrl,
    '--email', `registrar-${runId}@filer-qa.local`,
    '--password', randomUUID(),
    '--name', `Filer QA Registrar ${runLabel}`,
    '--ephemeral',
  ], {mustStayRunning: true, logPath: path.join(evidenceDirectory, 'registrar.log')});
  const trustedSystemKey = await waitForRegistrarAuthority(glueApiBase);
  console.log('READY: production Glue registrar and relay');

  const actorEnvironment = {
    ...process.env,
    BROWSER: 'none',
    VITE_HEADLESS_URL: glueApiBase,
    VITE_API_URL: glueApiBase,
    VITE_COMM_SERVER_URL: commServerUrl,
    VITE_TRUSTED_SYSTEM_KEYS: trustedSystemKey,
  };
  for (const actor of ['alice', 'charlie']) {
    startOwnedProcess(`${actor} Fotos server`, nodeBinary, [
      path.join(browserUi, 'scripts/serve-qa.mjs'), String(ports[actor]),
    ], {
      cwd: browserUi,
      env: actorEnvironment,
      mustStayRunning: true,
      logPath: path.join(evidenceDirectory, `${actor}-server.log`),
    });
  }
  await Promise.all(['alice', 'charlie'].map(async function waitForFotosServer(actor) {
    await waitFor(`${actor} Fotos server`, async function probeFotosServer() {
      const response = await fetch(`http://127.0.0.1:${ports[actor]}/`, {signal: AbortSignal.timeout(3000)});
      return response.ok;
    });
  }));
  console.log('READY: stable Fotos QA servers');
  return {commServerUrl, glueApiBase, trustedSystemKey};
}

/** Resolve Playwright from the Fotos browser workspace that owns the dependency. */
async function loadChromium() {
  const modulePath = await realpath(path.join(browserUi, 'node_modules/playwright/index.mjs'));
  const playwright = await import(pathToFileURL(modulePath).href);
  if (!playwright.chromium) throw new Error(`Playwright Chromium is unavailable from ${modulePath}`);
  return playwright.chromium;
}

/** Extract the sole exact browser client ID registered on an actor server. */
async function waitForExactClientId(actor, apiBase) {
  return waitFor(`${actor} exact Fotos client`, async function probeClients() {
    const payload = await fetchJson(`${apiBase}/api/clients`);
    const clients = Array.isArray(payload) ? payload : payload?.clients ?? payload?.data?.clients;
    if (!Array.isArray(clients)) throw new Error(`${actor} returned an invalid client list`);
    if (clients.length === 0) return undefined;
    if (clients.length !== 1) throw new Error(`${actor} registered ${clients.length} browser clients; expected exactly one`);
    const clientId = clients[0]?.id ?? clients[0]?.clientId;
    if (typeof clientId !== 'string' || clientId.length === 0) {
      throw new Error(`${actor} client did not expose an exact ID`);
    }
    return clientId;
  });
}

/** Attach failure detection and a retained browser console log to one actor. */
function observeBrowserActor(actor) {
  const {name, browser, context, page, log, profilePath} = actor;
  context.once('close', function contextClosed() {
    signalFailure(new Error(`${name} persistent Chrome context disconnected; profile: ${profilePath}`));
  });
  browser.once('disconnected', function browserDisconnected() {
    signalFailure(new Error(`${name} Chrome process disconnected; profile: ${profilePath}`));
  });
  page.once('crash', function pageCrashed() {
    signalFailure(new Error(`${name} Fotos page crashed; browser log: ${actor.logPath}`));
  });
  page.once('close', function pageClosed() {
    signalFailure(new Error(`${name} Fotos page closed unexpectedly; profile: ${profilePath}`));
  });
  page.on('console', function browserConsole(message) {
    log.write(`[${message.type()}] ${message.text()}\n`);
  });
  page.on('pageerror', function browserError(error) {
    log.write(`[pageerror] ${error.stack ?? error.message}\n`);
  });
}

/** Save the app-owned debug snapshot and screenshot for one browser actor. */
async function captureBrowserActor(actor, label) {
  const snapshot = await actor.page.evaluate(async function readFotosDebug() {
    return {
      status: window.__fotosDebug?.getStatus(),
      qa: await window.__fotosDebug?.qa.getOperationSnapshot(),
      text: document.body.innerText.slice(0, 4000),
    };
  });
  await writeFile(path.join(evidenceDirectory, `${actor.name}-${label}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  await actor.page.screenshot({path: path.join(evidenceDirectory, `${actor.name}-${label}.png`)});
}

/** Read the random CDP listener created by an explicitly owned Chrome process. */
async function waitForChromeEndpoint(name, profilePath) {
  return waitFor(`${name} Chrome DevTools endpoint`, async function probeDevToolsPort() {
    const contents = await readFile(path.join(profilePath, 'DevToolsActivePort'), 'utf8');
    const port = Number(contents.split('\n')[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${name} Chrome wrote an invalid DevToolsActivePort`);
    }
    return `http://127.0.0.1:${port}`;
  });
}

/** Launch one Fotos actor in an explicitly owned durable Chrome profile. */
async function launchBrowserActor(chromium, name, port, chromeExecutable) {
  const profilePath = path.join(evidenceDirectory, `${name}-chrome-profile`);
  report.browserProfiles[name] = profilePath;
  startOwnedProcess(`${name} Chrome`, chromeExecutable, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    'about:blank',
  ], {
    mustStayRunning: true,
    logPath: path.join(evidenceDirectory, `${name}-chrome.log`),
  });
  const endpoint = await waitForChromeEndpoint(name, profilePath);
  const browser = await waitBounded(
    `${name} persistent Chrome connection`,
    chromium.connectOverCDP(endpoint),
    startupDeadlineMs,
  );
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error(`${name} Chrome exposed ${contexts.length} default contexts; expected one`);
  const context = contexts[0];
  const page = context.pages()[0] ?? await context.newPage();
  const logPath = path.join(evidenceDirectory, `${name}-browser.log`);
  const log = createWriteStream(logPath);
  openLogs.push(log);
  const actor = {name, browser, context, page, profilePath, logPath, log};
  browserActors.push(actor);
  observeBrowserActor(actor);
  const url = `http://127.0.0.1:${port}/?fotosDebug=1`;
  await waitBounded(`${name} Fotos navigation`, page.goto(url, {
    waitUntil: 'domcontentloaded', timeout: startupDeadlineMs,
  }), startupDeadlineMs);
  await waitBounded(`${name} Fotos debug surface`, page.waitForFunction(
    function hasFotosDebug() { return Boolean(window.__fotosDebug); },
    undefined,
    {timeout: startupDeadlineMs},
  ), startupDeadlineMs);
  const apiBase = `http://127.0.0.1:${port}`;
  const clientId = await waitForExactClientId(name, apiBase);
  await captureBrowserActor(actor, 'initial');
  report.actors[name] = {apiBase, clientId};
  await writeLauncherReport();
  console.log(`READY: ${name} exact Fotos client ${clientId}`);
  return {apiBase, clientId, displayName: `Filer QA ${name} ${runLabel}`};
}

/** Read the real PNG and JPEG fixtures owned by the Fotos browser workspace. */
async function loadFixtures() {
  const fixtureDefinitions = [
    {file: 'rose-detail.png', name: 'qa-original.png', mimeType: 'image/png'},
    {file: 'rose-top-left.jpg', name: 'qa-second.jpg', mimeType: 'image/jpeg'},
  ];
  return Promise.all(fixtureDefinitions.map(async function loadFixture(definition) {
    const fixturePath = path.join(browserUi, 'src/lib/__fixtures__/photos', definition.file);
    const [bytes, metadata] = await Promise.all([readFile(fixturePath), stat(fixturePath)]);
    return {
      name: definition.name,
      mimeType: definition.mimeType,
      bytesBase64: bytes.toString('base64'),
      lastModified: Math.floor(metadata.mtimeMs),
    };
  }));
}

/** Print only changing native test and protocol progress while retaining the full log. */
function createNativeProgressPrinter() {
  const pending = new Map([['stdout', ''], ['stderr', '']]);
  const progressPattern = /Filer QA:|Test (Case|Suite).*\b(started|passed|failed)\b|error:|Executed \d+ tests?|Filer protocol report:/;
  /** Consume complete native test output lines from one stream. */
  function consume(stream, bytes) {
    const lines = `${pending.get(stream)}${bytes.toString()}`.split('\n');
    pending.set(stream, lines.pop());
    for (const line of lines) {
      if (progressPattern.test(line)) console.log(line);
    }
  }
  /** Flush any unterminated progress line after XCTest exits. */
  function flush() {
    for (const line of pending.values()) {
      if (line && progressPattern.test(line)) console.log(line);
    }
  }
  return {consume, flush};
}

/** Locate the test bundle produced by the explicit native test build. */
async function resolveNativeTestBundle() {
  const binPath = await captureCommand('Swift test binary path', 'xcrun', [
    'swift', 'build', '--package-path', provider, '--show-bin-path',
  ]);
  const bundle = path.join(binPath.split('\n').at(-1), 'OneFilerPackageTests.xctest');
  await access(bundle);
  return bundle;
}

/** Run the same three XCTest suites as test:connection against the live actors. */
async function runNativeTests(nodeBinary, commServerUrl) {
  report.status = 'testing';
  await writeLauncherReport();
  const runtimeBundle = path.join(provider, 'build/native-runtime');
  const testBundle = await resolveNativeTestBundle();
  const xctest = await captureCommand('xctest path', 'xcrun', ['--find', 'xctest']);
  const progress = createNativeProgressPrinter();
  const native = startOwnedProcess('native XCTest integration', xctest, [
    '-XCTest', [
      'OneFilerTests.ONEBridgeRpcTests',
      'OneFilerTests.FilerQAProgressTests',
      'OneFilerTests.FilerQARuntimeTests',
    ].join(','),
    testBundle,
  ], {
    env: {
      ...process.env,
      NSUnbufferedIO: 'YES',
      FILER_QA_CONFIGURATION: configurationPath,
      FILER_QA_COMM_SERVER: commServerUrl,
      ONE_FILER_TEST_NODE: path.join(runtimeBundle, 'node'),
      ONE_FILER_TEST_ENTRY: path.join(runtimeBundle, 'runtime/node_modules/@refinio/api/dist/src/filer/stdio-main.js'),
      ONE_FILER_TEST_PRELOAD: path.join(runtimeBundle, 'runtime/console-to-stderr.cjs'),
    },
    logPath: path.join(evidenceDirectory, 'native-tests.log'),
    onStdout: function nativeStdout(bytes) { progress.consume('stdout', bytes); },
    onStderr: function nativeStderr(bytes) { progress.consume('stderr', bytes); },
  });
  const outcome = await waitBounded('native XCTest integration', native.exit, nativeTestDeadlineMs);
  await waitBounded('native XCTest log flush', native.closed, 10000);
  progress.flush();
  if (outcome.code !== 0) {
    const reason = outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`;
    throw new Error(`native XCTest integration failed with ${reason}; log: ${path.join(evidenceDirectory, 'native-tests.log')}`);
  }
  throwIfFailed();
  const nativeOutput = await readFile(path.join(evidenceDirectory, 'native-tests.log'), 'utf8');
  const summaries = [...nativeOutput.matchAll(/Executed (\d+) tests?, with (\d+) failures? \((\d+) unexpected\)/g)];
  const nativeSummary = summaries.at(-1);
  const skipped = [...nativeOutput.matchAll(/Test Case .* skipped/g)].length;
  report.nativeTests = {
    selectedSuites: 3,
    executed: nativeSummary ? Number(nativeSummary[1]) : undefined,
    failures: nativeSummary ? Number(nativeSummary[2]) : undefined,
    unexpected: nativeSummary ? Number(nativeSummary[3]) : undefined,
    skipped,
  };
  if (!nativeSummary || report.nativeTests.failures !== 0 || report.nativeTests.unexpected !== 0 || skipped !== 0) {
    throw new Error(`Native XCTest summary is incomplete or contains failures/skips; log: ${path.join(evidenceDirectory, 'native-tests.log')}`);
  }
  const protocol = JSON.parse(await readFile(protocolReportPath, 'utf8'));
  if (protocol.status !== 'passed') throw new Error(`Filer protocol report status is ${String(protocol.status)}`);
  if (!Array.isArray(protocol.steps) || protocol.steps.length !== 11 || protocol.steps.some(function isFailed(step) { return step.status !== 'PASS'; })) {
    throw new Error(`Filer protocol did not pass all 11 stages; report: ${protocolReportPath}`);
  }
  if (!Array.isArray(protocol.assertions) || !protocol.assertions.some(function coversReload(assertion) { return assertion.step === 11; })) {
    throw new Error(`Filer protocol report does not contain stage 11 assertions; report: ${protocolReportPath}`);
  }
  report.protocol = {
    status: protocol.status,
    durationMs: protocol.durationMs,
    stages: protocol.steps.length,
    assertions: protocol.assertions.length,
  };
}

/** Send one signal to the exact process group created by this launcher. */
function signalOwnedProcess(record, signal) {
  const {child} = record;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Reap all owned process groups, including each explicit Chrome group, within a bounded grace period. */
async function cleanup() {
  stopping = true;
  const errors = [];
  const browserCloseFallbacks = [];
  for (const actor of browserActors) {
    const closeOutcome = await Promise.race([
      actor.browser.close().then(
        function browserClosed() { return undefined; },
        function browserCloseFailed(error) { return asError(error).message; },
      ),
      new Promise(function browserCloseGrace(resolve) {
        setTimeout(function expireBrowserClose() { resolve('CDP close exceeded 2000 ms'); }, 2000);
      }),
    ]);
    if (closeOutcome) browserCloseFallbacks.push(`${actor.name}: ${closeOutcome}`);
  }
  for (const record of [...ownedProcesses].reverse()) {
    try { signalOwnedProcess(record, 'SIGTERM'); } catch (error) { errors.push(`${record.name}: ${asError(error).message}`); }
  }
  await Promise.race([
    Promise.allSettled(ownedProcesses.map(function waitForClose(record) { return record.closed; })),
    new Promise(function terminationGrace(resolve) { setTimeout(resolve, 5000); }),
  ]);
  for (const record of [...ownedProcesses].reverse()) {
    try { signalOwnedProcess(record, 'SIGKILL'); } catch (error) { errors.push(`${record.name}: ${asError(error).message}`); }
  }
  await Promise.race([
    Promise.allSettled(ownedProcesses.map(function reap(record) { return record.closed; })),
    new Promise(function killGrace(resolve) { setTimeout(resolve, 5000); }),
  ]);
  for (const record of ownedProcesses) {
    if (record.child.exitCode === null && record.child.signalCode === null) {
      errors.push(`${record.name}: process group did not exit after SIGKILL`);
    }
  }
  for (const log of openLogs) {
    if (!log.closed) log.end();
  }
  report.cleanup = {completed: errors.length === 0, errors, browserCloseFallbacks};
  return errors;
}

/** Run the disposable four-party integration and retain all evidence. */
async function main() {
  if (process.platform !== 'darwin') throw new Error('Glue/Fotos/Filer native integration requires macOS');
  await writeLauncherReport();
  console.log(`EVIDENCE: ${evidenceDirectory}`);
  const chromeExecutable = process.env.FOTOS_QA_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(chromeExecutable);
  const nodeBinary = await resolveNodeBinary();
  await buildPrerequisites(nodeBinary);

  const portValues = await Promise.all(Array.from({length: 5}, getFreePort));
  const ports = {
    relay: portValues[0], registrar: portValues[1], alice: portValues[2],
    charlie: portValues[3], quicvc: portValues[4],
  };
  report.ports = ports;
  report.chromeExecutable = chromeExecutable;
  report.status = 'starting-services';
  await writeLauncherReport();
  const services = await startServices(nodeBinary, ports);
  const chromium = await loadChromium();
  const alice = await launchBrowserActor(chromium, 'alice', ports.alice, chromeExecutable);
  const charlie = await launchBrowserActor(chromium, 'charlie', ports.charlie, chromeExecutable);
  const fixtures = await loadFixtures();
  const configuration = {
    glueApiBase: services.glueApiBase,
    alice,
    charlie,
    bobDisplayName: `Filer QA Bob ${runLabel}`,
    collectionName: `Filer QA collection ${runLabel}`,
    timeoutMs: 60000,
    fixtures,
  };
  await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`);
  console.log('RUNNING: packaged Swift Filer + Fotos + Glue integration');
  await runNativeTests(nodeBinary, services.commServerUrl);
  await Promise.all(browserActors.map(function captureFinal(actor) { return captureBrowserActor(actor, 'final'); }));
  throwIfFailed();
}

const overallTimer = setTimeout(function overallDeadline() {
  signalFailure(new Error(`Glue/Fotos/Filer launcher exceeded its ${overallDeadlineMs} ms overall deadline`));
}, overallDeadlineMs);
function interrupted(signal) {
  signalFailure(new Error(`Glue/Fotos/Filer launcher interrupted by ${signal}`));
}
process.once('SIGINT', function interrupt() { interrupted('SIGINT'); });
process.once('SIGTERM', function terminate() { interrupted('SIGTERM'); });

let failure;
try {
  await main();
} catch (error) {
  failure = asError(error);
}
clearTimeout(overallTimer);
const cleanupErrors = await cleanup();
if (!failure && cleanupErrors.length > 0) failure = new Error(`Owned process cleanup failed: ${cleanupErrors.join('; ')}`);
report.status = failure ? 'failed' : 'passed';
report.finishedAt = new Date().toISOString();
report.error = failure ? {message: failure.message, stack: failure.stack} : undefined;
await writeLauncherReport();

if (failure) {
  console.error(failure.stack ?? failure.message);
  console.error(`FAILED EVIDENCE: ${launcherReportPath}`);
  process.exitCode = 1;
} else {
  console.log(`PASSED: ${report.protocol.stages} stages, ${report.protocol.assertions} assertions in ${report.protocol.durationMs} ms`);
  console.log(`REPORT: ${protocolReportPath}`);
  console.log(`EVIDENCE: ${launcherReportPath}`);
}
