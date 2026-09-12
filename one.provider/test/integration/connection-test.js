#!/usr/bin/env node
// Exercise the app's process owner against the packaged canonical runtime.
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
const provider = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = path.join(provider, 'build/native-runtime');
const entry = path.join(bundle, 'runtime/node_modules/@refinio/api/dist/src/filer/stdio-main.js');
await access(entry);
const child = spawn('swift', ['test', '--filter', 'ONEBridgeRpcTests|FilerQAProgressTests|FilerQARuntimeTests'], {
    cwd: provider, stdio: 'inherit', env: {...process.env,
        ONE_FILER_TEST_NODE: path.join(bundle, 'node'), ONE_FILER_TEST_ENTRY: entry,
        ONE_FILER_TEST_PRELOAD: path.join(bundle, 'runtime/console-to-stderr.cjs')}
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
