import assert from 'node:assert/strict';
import {fork, spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.resolve(root, '../fotos/fotos.browser/browser-ui/src/lib/__fixtures__/photos');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filer-fotos-'));
const workers = [];
const importFixture = path.join(temporary, 'large-metadata.jpg');
const jpeg = await readFile(path.join(fixtures, 'rose-top-left.jpg'));
// Three valid JPEG COM segments exceed Express's default 100 KB body limit.
const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0xea, 0x62]), Buffer.alloc(60000, 65)]);
await writeFile(importFixture, Buffer.concat([jpeg.subarray(0, 2), comment, comment, comment, jpeg.subarray(2)]));
const commServer = new CommunicationServer();

/** Allocate an unused loopback port for a disposable test runtime. */
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

/** Match a concrete process event with a bounded failure deadline. */
function waitMessage(child, predicate, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Fotos integration event deadline exceeded')), timeoutMs);
        function finish(error, message) {
            clearTimeout(timer); child.off('message', receive); child.off('exit', exited);
            error ? reject(error) : resolve(message);
        }
        function receive(message) { if (predicate(message)) finish(null, message); }
        function exited(code) { finish(new Error(`Fotos runtime exited with code ${code}`)); }
        child.on('message', receive); child.once('exit', exited);
    });
}

/** Start a real ONE instance in its own process and storage directory. */
async function startWorker(name, extra = {}) {
    const token = randomBytes(32).toString('hex');
    const port = await freePort();
    const logPath = path.join(temporary, `${name}.log`);
    const log = createWriteStream(logPath);
    const child = fork(path.join(root, 'scripts/fotos-integration-worker.mjs'), [], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {...process.env, FOTOS_TEST_CONFIG: JSON.stringify({
            directory: path.join(temporary, name), secret: randomBytes(32).toString('hex'),
            email: `${name}@fotos-filer.test`, port, token, ...extra,
        })},
    });
    child.stdout.pipe(log); child.stderr.pipe(log);
    let requestId = 0;
    const worker = {child, token, port, logPath, log,
        endpoint: `http://127.0.0.1:${port}/filer/rpc`,
        async command(method, params) {
            const id = ++requestId;
            const response = waitMessage(child, message => message.id === id);
            child.send({id, method, params});
            const result = await response;
            if (result.error) throw new Error(result.error);
            return result.result;
        },
    };
    workers.push(worker);
    worker.ready = await waitMessage(child, message => message.event === 'ready');
    return worker;
}

/** Exercise the native Swift bridge against the live Fotos projection. */
async function swift(worker, test) {
    await new Promise((resolve, reject) => {
        const child = spawn('swift', ['test', '--filter', `FotosBridgeTests/${test}`], {
            cwd: path.join(root, 'one.provider'), stdio: 'inherit',
            env: {...process.env, FOTOS_TEST_ENDPOINT: worker.endpoint, FOTOS_TEST_TOKEN: worker.token,
                FOTOS_TEST_ORIGINAL: path.join(fixtures, 'rose-detail.png'),
                FOTOS_TEST_IMPORT: importFixture},
        });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Swift Fotos test failed: ${code}`)));
    });
}

/** Call the same authenticated filesystem transport used by Finder. */
async function rpc(worker, method, params, authorization = `Bearer ${worker.token}`) {
    const response = await fetch(worker.endpoint, {method: 'POST', headers: {
        'content-type': 'application/json', authorization,
    }, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
    assert.equal(response.status, 200);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
}

try {
    const commPort = await freePort();
    await commServer.start('127.0.0.1', commPort);
    const commServerUrl = `ws://127.0.0.1:${commPort}`;
    const source = await startWorker('source', {commServerUrl});
    await source.command('import', {name: 'rose-detail.png', path: path.join(fixtures, 'rose-detail.png')});
    console.log('1. Browsing Fotos originals through the Swift File Provider bridge');
    await swift(source, 'testBrowseOriginal');
    console.log('2. Importing through the Swift File Provider bridge');
    await swift(source, 'testImportOriginal');
    assert.equal((await rpc(source, 'stat', {path: '/fotos'})).mode & 0o200, 0o200);
    const original = await readFile(importFixture);
    assert.deepEqual(Buffer.from((await rpc(source, 'readFile', {path: '/fotos/imported.jpg'})).content, 'base64'), original);
    const importedVersion = await rpc(source, 'stat', {path: '/fotos/imported.jpg'});
    await source.command('import', {name: 'imported.jpg', path: path.join(fixtures, 'rose-top-left.jpg')});
    assert.deepEqual(await rpc(source, 'stat', {path: '/fotos/imported.jpg'}), importedVersion,
        'Changing JPEG container metadata must retain Fotos identity and the existing original');
    await assert.rejects(rpc(source, 'writeFile', {path: '/fotos/imported.jpg', content: Buffer.from('different').toString('base64')}), /already exists/);
    console.log('3. Pairing and syncing Fotos between independent ONE instances');
    const recipient = await startWorker('recipient', {commServerUrl, readOnly: true});
    const invitation = await source.command('invite');
    const sourcePaired = waitMessage(source.child, message => message.event === 'paired');
    const recipientPaired = waitMessage(recipient.child, message => message.event === 'paired');
    await recipient.command('pair', {invitation});
    assert.equal((await sourcePaired).person, recipient.ready.person);
    assert.equal((await recipientPaired).person, source.ready.person);
    await assert.rejects(rpc(recipient, 'readDir', {path: '/fotos'}));
    const initialSync = waitMessage(recipient.child, message => message.event === 'manifest' && message.count === 2);
    await source.command('share', {person: recipient.ready.person});
    await initialSync;
    await swift(recipient, 'testBrowseOriginal');
    assert.equal((await rpc(recipient, 'stat', {path: '/fotos'})).mode & 0o200, 0);
    assert.deepEqual(Buffer.from((await rpc(recipient, 'readFile', {path: '/fotos/imported.jpg'})).content, 'base64'), original);
    const liveSync = waitMessage(recipient.child, message => message.event === 'manifest' && message.count === 3);
    await source.command('import', {name: 'live.jpg', path: path.join(fixtures, 'rose-center.jpg')});
    await liveSync;
    assert.deepEqual(Buffer.from((await rpc(recipient, 'readFile', {path: '/fotos/live.jpg'})).content, 'base64'),
        await readFile(path.join(fixtures, 'rose-center.jpg')));
    console.log('Fotos browse, import, pairing, initial sync, and live sync passed');
} catch (error) {
    for (const worker of workers) {
        console.error(`Runtime log: ${worker.logPath}\n${(await readFile(worker.logPath, 'utf8')).slice(-14000)}`);
    }
    throw error;
} finally {
    for (const worker of workers) {
        if (worker.child.exitCode === null && worker.child.connected) {
            try { await worker.command('stop'); } finally { worker.child.kill('SIGTERM'); }
        }
        worker.log.end();
    }
    await commServer.stop();
    await rm(temporary, {recursive: true, force: true});
}
