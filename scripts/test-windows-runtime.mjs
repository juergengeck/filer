import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

/** Exercise the actual Windows launcher, private API, native imports and durable restart. */
test('Windows runtime: native namespace, device API, imported BLOB and restart', {timeout: 120000}, async () => {
    assert.equal(process.platform, 'win32');
    const temporary = await mkdtemp(path.join(tmpdir(), 'filer-windows-runtime-'));
    const server = new CommunicationServer();
    let host;
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const secret = randomBytes(32).toString('hex');
    const config = {directory: path.join(temporary, 'storage'), mountPoint: path.join(temporary, 'mount'),
        email: 'windows-runtime@filer.test', name: 'Windows runtime test',
        commServerUrl: `ws://127.0.0.1:${port}`, inviteUrlPrefix: 'https://refinio.one/invite'};
    const configPath = path.join(temporary, 'config.json');
    await writeFile(configPath, JSON.stringify(config));
    await mkdir(config.mountPoint);

    /** Match events with bounded deadlines; keep stdout exclusively as JSON protocol. */
    function startHost() {
        const child = spawn(process.execPath, [path.join(import.meta.dirname, 'windows-filer.mjs'), configPath],
            {stdio: ['pipe', 'pipe', 'pipe'], env: {...process.env, REFINIO_INSTANCE_SECRET: secret}});
        const events = [];
        const waiters = new Set();
        let diagnostics = '';
        let failure;
        child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-12000); });
        const lines = createInterface({input: child.stdout});
        lines.on('line', line => {
            let event;
            try { event = JSON.parse(line); }
            catch { failure = new Error(`Invalid protocol output: ${line}`); for (const waiter of waiters) waiter.fail(failure); return; }
            events.push(event);
            for (const waiter of [...waiters]) if (waiter.matches(event)) waiter.finish(event);
        });
        child.on('exit', code => {
            failure = new Error(`Windows host exited (${code})\n${diagnostics}`);
            for (const waiter of [...waiters]) waiter.fail(failure);
        });
        function wait(matches, after = 0) {
            const found = events.slice(after).find(matches);
            if (found) return Promise.resolve(found);
            if (failure) return Promise.reject(failure);
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => waiter.fail(new Error(`Windows runtime deadline exceeded\n${diagnostics}`)), 45000);
                const waiter = {matches,
                    finish(event) { clearTimeout(timer); waiters.delete(waiter); resolve(event); },
                    fail(error) { clearTimeout(timer); waiters.delete(waiter); reject(error); }};
                waiters.add(waiter);
            });
        }
        let nextId = 0;
        return {child, events, wait,
            async command(operation, request = {}) {
                const requestId = String(++nextId);
                const response = wait(event => event.requestId === requestId);
                child.stdin.write(JSON.stringify({operation, request, requestId}) + '\n');
                const result = await response;
                assert.equal(result.success, true, JSON.stringify(result));
                return result.result;
            },
            async stop() {
                if (child.exitCode !== null) return;
                const exited = once(child, 'exit');
                child.stdin.end();
                const [code] = await exited;
                assert.equal(code, 0, diagnostics);
            }};
    }
    try {
        await server.start('127.0.0.1', port);
        host = startHost();
        const first = await host.wait(event => event.ready === true);
        const namespace = await host.command('filer:readDir', {path: '/'});
        assert.deepEqual((await readdir(config.mountPoint)).sort(), namespace.result.children.sort());
        for (const name of ['Files', 'Fotos', 'ONE']) assert.ok(namespace.result.children.includes(name));
        assert.deepEqual(await readdir(path.join(config.mountPoint, 'Fotos')), []);
        const oneChildren = await readdir(path.join(config.mountPoint, 'ONE'));
        assert.ok(oneChildren.includes('devices'), `Expected /ONE/devices in ${JSON.stringify(oneChildren)}`);
        const devicesSnapshot = JSON.parse(await readFile(path.join(config.mountPoint, 'ONE', 'devices', 'devices.json'), 'utf8'));
        assert.equal(devicesSnapshot.$type$, 'FilerDevicesSnapshot');
        const folderSettings = JSON.parse(await readFile(path.join(config.mountPoint, 'ONE', 'System', 'settings', 'Filer', 'folders.json'), 'utf8'));
        assert.equal(folderSettings.$type$, 'FilerFolderSettings');
        assert.ok(Array.isArray(await host.command('devices:listDevices')));
        const bytes = randomBytes(2 * 1024 ** 2 + 17);
        let observed = host.events.length;
        await writeFile(path.join(config.mountPoint, 'Files', 'native.bin'), bytes);
        // Publication can include unrelated startup changes; require the committed Files entry.
        for (;;) {
            await host.wait(event => event.event === 'filerChanged' && event.containers.includes('/Files'), observed);
            observed = host.events.length;
            const result = await host.command('filer:stat', {path: '/Files/native.bin'});
            if (!result.error) { assert.equal(result.result.size, bytes.length); break; }
            assert.equal(result.error.code, -2);
        }
        const range = await host.command('filer:readFileInChunks', {path: '/Files/native.bin', position: 1048573, length: 30});
        assert.deepEqual(Buffer.from(range.result.content, 'base64'), bytes.subarray(1048573, 1048603));
        await host.stop();
        host = startHost();
        const second = await host.wait(event => event.ready === true);
        assert.equal(second.owner, first.owner);
        assert.deepEqual(await readFile(path.join(config.mountPoint, 'Files', 'native.bin')), bytes);
        const persisted = await host.command('filer:stat', {path: '/Files/native.bin'});
        assert.equal(persisted.result.size, bytes.length);
    } finally {
        try { await host?.stop(); }
        finally { await server.stop(); await rm(temporary, {recursive: true, force: true}); }
    }
});
