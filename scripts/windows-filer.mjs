#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Console} from 'node:console';
import {IFSProjFSProvider} from '../one.projfs/IFSProjFSProvider.js';

// Keep stdout exclusively for the existing authenticated private RPC protocol.
globalThis.console = new Console({stdout: process.stderr, stderr: process.stderr});
if (process.platform !== 'win32') throw new Error('This launcher requires Windows');
if (process.argv.length !== 3) throw new Error('Usage: node scripts/windows-filer.mjs <configuration.json>');
const config = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
for (const key of ['directory', 'email', 'name', 'commServerUrl', 'inviteUrlPrefix', 'mountPoint']) {
    if (typeof config[key] !== 'string' || !config[key]) throw new Error(`Missing configuration field: ${key}`);
}
const secret = process.env.REFINIO_INSTANCE_SECRET;
delete process.env.REFINIO_INSTANCE_SECRET;
if (!secret) throw new Error('Set REFINIO_INSTANCE_SECRET before starting Filer');
const {runFilerGlueHost} = await import('@refinio/filer.runtime/host');
await runFilerGlueHost({
    configuration: {...config, secret, directory: path.resolve(config.directory), mountPoint: path.resolve(config.mountPoint)},
    providerFactory: options => new IFSProjFSProvider(options)
});
