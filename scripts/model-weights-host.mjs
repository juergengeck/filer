/** Launch the canonical private runtime with a protected local configuration file. */
import {readFile, stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const [runtimeDirectory, configurationPath] = process.argv.slice(2);
if (!runtimeDirectory || !configurationPath) throw new Error('Usage: model-weights-host.mjs RUNTIME_DIRECTORY CONFIGURATION_PATH');
const metadata = await stat(configurationPath);
if ((metadata.mode & 0o077) !== 0) throw new Error('Runtime configuration must be private (mode 0600)');
const configuration = JSON.parse(await readFile(configurationPath, 'utf8'));
const child = spawn(process.execPath, ['--require', path.join(runtimeDirectory, 'console-to-stderr.cjs'),
  path.join(runtimeDirectory, 'node_modules/@refinio/api/dist/src/filer/stdio-main.js')], {
  stdio: ['pipe', 'pipe', 'inherit']
});
child.stdin.write(JSON.stringify(configuration) + '\n');
// The controller waits for readiness before sending operations, as the native host does.
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; process.stdin.destroy(); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal));
