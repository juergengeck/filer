import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, open, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {IFSProjFSProvider} from '../IFSProjFSProvider.js';

/** Exercise the real Windows kernel bridge, with deterministic owner bytes and isolated storage. */
test('native projection: cold metadata, ranges above 4 GiB, refresh, imports and shutdown', {timeout: 120000}, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'filer-native-'));
    const largeSize = (process.env.FILER_LARGE_READ_TEST ? 5 * 1024 ** 3 : 8 * 1024 ** 2) + 123;
    let text = 'first version';
    const reads = [];
    const imports = [];
    const inviteCtimeMs = Date.UTC(2026, 8, 12, 18, 20, 29);
    const inviteMtimeMs = Date.UTC(2026, 8, 13, 9, 44, 40);
    const fileSystem = {
        async stat(target) {
            if (target === '/Fotos') return {mode: 0o40555, size: 0, canAddChildren: true};
            if (['/', '/ONE', '/ONE/invites', '/Files'].includes(target)) return {mode: 0o40555, size: 0};
            if (target === '/large.bin') return {mode: 0o100444, size: largeSize, contentHash: 'large'};
            if (target === '/ONE/invites/iop_invite.txt') {
                return {mode: 0o100444, size: Buffer.byteLength(text), contentHash: text,
                    ctimeMs: inviteCtimeMs, mtimeMs: inviteMtimeMs};
            }
            if (target === '/failure.bin') return {mode: 0o100444, size: 10};
            throw Object.assign(new Error('Missing'), {code: -2});
        },
        async readDir(target) {
            const children = {'/': ['ONE', 'Files', 'Fotos', 'large.bin', 'failure.bin'], '/ONE': ['invites'],
                '/ONE/invites': ['iop_invite.txt'], '/Files': [], '/Fotos': []}[target];
            if (!children) throw Object.assign(new Error('Missing'), {code: -2});
            return {children};
        },
        async readFile() { throw new Error('Whole-file reads are forbidden'); },
        async readFileInChunks(target, length, position) {
            reads.push({target, length, position});
            assert.ok(length <= 1024 ** 2);
            if (target === '/failure.bin') throw new Error('Owner read failed');
            if (target === '/ONE/invites/iop_invite.txt') return {content: Uint8Array.from(Buffer.from(text).subarray(position, position + length)).buffer};
            const pattern = Buffer.from(Array.from({length: 251}, (_, i) => (position + i) % 251));
            const bytes = Buffer.alloc(Math.min(length, largeSize - position), pattern);
            return {content: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
        }
    };
    const provider = new IFSProjFSProvider({virtualRoot: root, fileSystem,
        async importLocal(target, local, directory) { imports.push({target, content: directory ? null : await readFile(local)}); }});
    const errors = [];
    provider.on('operationError', event => errors.push(event));
    try {
        await provider.start();
        // Publication may precede the first OS browse of any of its ancestors.
        await provider.refresh(['/Files', '/ONE/invites']);
        // Access before enumerating: no speculative not-found response.
        assert.equal((await stat(path.join(root, 'LARGE.BIN'))).size, largeSize);
        assert.deepEqual((await readdir(root)).sort(), ['Files', 'Fotos', 'ONE', 'failure.bin', 'large.bin'].sort());
        const invite = path.join(root, 'ONE', 'invites', 'iop_invite.txt');
        const inviteStats = await stat(invite);
        assert.equal(Math.trunc(inviteStats.mtimeMs), inviteMtimeMs);
        assert.equal(Math.trunc(inviteStats.birthtimeMs), inviteCtimeMs);
        assert.equal(await readFile(invite, 'utf8'), text);
        const file = await open(path.join(root, 'large.bin'), 'r');
        try {
            const positions = [0, Math.floor(largeSize / 2) + 8193, largeSize - 17];
            await Promise.all(positions.map(async position => {
                const buffer = Buffer.alloc(17);
                const {bytesRead} = await file.read(buffer, 0, 17, position);
                assert.equal(bytesRead, 17);
                assert.deepEqual(buffer, Buffer.from(Array.from({length: 17}, (_, i) => (position + i) % 251)));
            }));
        } finally { await file.close(); }
        await assert.rejects(readFile(path.join(root, 'failure.bin')));
        await assert.rejects(stat(path.join(root, 'absent')));
        text = 'updated invitation bytes';
        await provider.refresh(['/ONE/invites']);
        assert.equal(await readFile(invite, 'utf8'), text);
        const imported = once(provider, 'imported', {signal: AbortSignal.timeout(10000)});
        // ProjFS suppresses notifications for I/O originating in the provider process.
        await promisify(execFile)(process.execPath, ['-e',
            "require('node:fs').writeFileSync(process.argv[1], 'import bytes')", path.join(root, 'Files', 'hello.txt')]);
        assert.deepEqual(await imported, ['/Files/hello.txt']);
        assert.equal(imports[0].content.toString(), 'import bytes');
        const photoImported = once(provider, 'imported', {signal: AbortSignal.timeout(10000)});
        await promisify(execFile)(process.execPath, ['-e',
            "require('node:fs').writeFileSync(process.argv[1], 'jpeg bytes')", path.join(root, 'Fotos', 'pic.jpg')]);
        assert.deepEqual(await photoImported, ['/Fotos/pic.jpg']);
        assert.equal(imports.find(item => item.target === '/Fotos/pic.jpg')?.content.toString(), 'jpeg bytes');
        await assert.rejects(promisify(execFile)(process.execPath, ['-e',
            "require('node:fs').writeFileSync(process.argv[1], 'overwrite')", invite]));
        await assert.rejects(promisify(execFile)(process.execPath, ['-e',
            "require('node:fs').writeFileSync(process.argv[1], 'overwrite')", path.join(root, 'Files', 'hello.txt')]));
        const folderImported = new Promise(resolve => {
            provider.on('imported', target => { if (target === '/Files/folder/child.txt') resolve(); });
        });
        await promisify(execFile)(process.execPath, ['-e',
            "const fs = require('node:fs'); fs.mkdirSync(process.argv[1]); fs.writeFileSync(process.argv[1] + '/child.txt', 'child')",
            path.join(root, 'Files', 'folder')]);
        await folderImported;
        assert.ok(imports.findIndex(item => item.target === '/Files/folder') < imports.findIndex(item => item.target === '/Files/folder/child.txt'));
        await provider.refresh(['/']);
        assert.equal(await readFile(path.join(root, 'Files', 'hello.txt'), 'utf8'), 'import bytes');
        assert.ok(reads.some(read => read.position > largeSize / 2));
        assert.ok(provider.getStats().reads.peak <= 4);
        await provider.stop();
        assert.equal(provider.getStats().pending, 0);
        assert.equal(provider.getStats().reads.active, 0);
        assert.equal(provider.isRunning(), false);
        assert.ok(errors.some(event => event.error.message === 'Owner read failed'));
        // Restart must preserve the root marker rather than delete user state.
        await provider.start();
        assert.equal(await readFile(invite, 'utf8'), text);
    } finally {
        await provider.stop();
        // Only this test's freshly created, absolute temporary directory is removed.
        assert.ok(root.startsWith(path.join(tmpdir(), 'filer-native-')));
        await rm(root, {recursive: true, force: true});
    }
});

/** Shutdown cancels the OS command and waits for the owning read to release its reservation. */
test('shutdown drains an outstanding owner read', {timeout: 10000}, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'filer-native-'));
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const fileSystem = {
        async stat() { return {mode: 0o100444, size: 10}; },
        async readDir() { return {children: ['slow.bin']}; },
        async readFileInChunks() { entered(); await gate; return {content: new ArrayBuffer(10)}; }
    };
    const provider = new IFSProjFSProvider({virtualRoot: root, fileSystem});
    try {
        await provider.start();
        const reading = readFile(path.join(root, 'slow.bin')).catch(error => error);
        await started;
        let drained = false;
        const stopping = provider.stop().then(() => { drained = true; });
        assert.equal(drained, false);
        release();
        await stopping;
        await reading;
        assert.equal(provider.getStats().pending, 0);
        assert.equal(provider.getStats().reads.active, 0);
    } finally {
        release();
        await provider.stop();
        assert.ok(root.startsWith(path.join(tmpdir(), 'filer-native-')));
        await rm(root, {recursive: true, force: true});
    }
});
