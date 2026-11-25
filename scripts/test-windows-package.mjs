import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile, access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import CommunicationServer from '../../one/packages/one.models/lib/misc/ConnectionEstablishment/communicationServer/CommunicationServer.js';

if (process.platform !== 'win32' || process.argv.length !== 3) throw new Error('Usage: node scripts/test-windows-package.mjs <package-directory>');
const bundle = path.resolve(process.argv[2]);
const temporary = await mkdtemp(path.join(tmpdir(), 'Filer package test '));
const installed = path.join(temporary, 'Installed Filer');
const profile = path.join(temporary, 'Protected profile');
const server = new CommunicationServer();

/** Run a packaged executable without inherited workspace resolution or visible windows. */
async function run(command, args, input = '') {
    const env = {...process.env}; delete env.NODE_PATH; delete env.NODE_OPTIONS; delete env.PSModulePath;
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {cwd: temporary, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env});
        let stdout = '', stderr = '';
        child.stdout.on('data', bytes => { stdout += bytes; });
        child.stderr.on('data', bytes => { stderr += bytes; });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Packaged command failed (${code}): ${stderr}`)));
        child.stdin.end(input);
    });
}
const powershell = path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe');
try {
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    await server.start('127.0.0.1', port);
    await run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(bundle, 'Install.ps1'), '-Destination', installed, '-NoShortcut']);
    const secret = randomBytes(32).toString('hex');
    const config = {email: 'package@filer.test', name: 'Packaged Filer', secret,
        directory: path.join(profile, 'storage'), mountPoint: path.join(temporary, 'Mounted files'),
        commServerUrl: `ws://127.0.0.1:${port}`, inviteUrlPrefix: 'https://refinio.one/invite'};
    const executable = path.join(installed, 'Filer.exe');
    await run(executable, ['--configure-stdin', profile], JSON.stringify(config) + '\n');
    const protectedBytes = await readFile(path.join(profile, 'profile.dat'));
    assert.equal(protectedBytes.includes(Buffer.from(secret)), false);
    for (let attempt = 0; attempt < 2; attempt++) {
        const result = JSON.parse((await run(executable, ['--smoke', profile])).trim());
        assert.equal(result.ready, true);
        assert.equal(result.devices, 1);
        for (const name of ['Files', 'Fotos', 'ONE']) assert.ok(result.root.children.includes(name));
    }
    const keep = path.join(installed, 'user-note.txt');
    await writeFile(keep, 'Preserve unlisted files');
    await run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(installed, 'Uninstall.ps1')]);
    await assert.rejects(access(executable), {code: 'ENOENT'});
    assert.equal(await readFile(keep, 'utf8'), 'Preserve unlisted files');
    assert.deepEqual(await readFile(path.join(profile, 'profile.dat')), protectedBytes);
    console.log('PASS: relocated native package, protected credentials, Devices, native browsing, restart and preserving user files during uninstall');
} finally {
    await server.stop();
    await rm(temporary, {recursive: true, force: true});
}
