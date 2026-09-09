/** Package the canonical API's installed runtime closure; never ship workspace symlinks. */
import {cp, mkdir, readFile, realpath, rm, symlink, writeFile, copyFile, chmod, access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const provider = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.resolve(provider, '../../one/packages/refinio.api');
const output = path.resolve(process.argv[2] ?? path.join(provider, 'build/native-runtime'));
const binary = process.env.NODE_BINARY;
if (!binary || !path.isAbsolute(binary)) throw new Error('Set NODE_BINARY to the absolute path of the Node.js release to bundle');
const version = execFileSync(binary, ['--version'], {encoding: 'utf8'}).trim();
if (!/^v(22|24)\./.test(version)) throw new Error('Bundle a maintained Node.js 22 or 24 LTS release');
await access(path.join(api, 'dist/src/filer/stdio-main.js'));
await rm(output, {recursive: true, force: true});
await mkdir(path.join(output, 'runtime/node_modules'), {recursive: true});
await copyFile(binary, path.join(output, 'node'));
await chmod(path.join(output, 'node'), 0o755);
await copyFile(path.join(provider, 'scripts/console-to-stderr.cjs'), path.join(output, 'runtime/console-to-stderr.cjs'));
const installed = new Map();
const packages = [];

/** Resolve a dependency according to Node's directory lookup, including workspace peer links. */
async function resolvePackage(name, from) {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name);
    try { return await realpath(candidate); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Missing runtime dependency ${name} from ${from}`);
    directory = parent;
  }
}

/** Preserve each installed dependency's resolution graph, including distinct versions and cycles. */
async function copyPackage(source) {
  source = await realpath(source);
  if (installed.has(source)) return installed.get(source);
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  const key = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const destination = path.join(output, 'runtime/packages', key);
  installed.set(source, destination);
  const skipped = new Set(['node_modules', '.git', '.turbo', '.build', 'test', 'tests', '__tests__']);
  await cp(source, destination, {recursive: true, dereference: true, filter: file => file === source || (!path.basename(file).startsWith('.') && !skipped.has(path.basename(file)))});
  packages.push({name: manifest.name, version: manifest.version});
  const dependencies = {...manifest.dependencies, ...manifest.peerDependencies};
  for (const name of Object.keys(dependencies)) {
    if (manifest.peerDependenciesMeta?.[name]?.optional && !manifest.dependencies?.[name]) continue;
    let dependency;
    try { dependency = await resolvePackage(name, source); }
    catch (error) { if (manifest.peerDependenciesMeta?.[name]?.optional) continue; throw error; }
    const target = await copyPackage(dependency);
    const link = path.join(destination, 'node_modules', name);
    await mkdir(path.dirname(link), {recursive: true});
    await symlink(path.relative(path.dirname(link), target), link);
  }
  return destination;
}

const main = await copyPackage(api);
const link = path.join(output, 'runtime/node_modules/@refinio/api');
await mkdir(path.dirname(link), {recursive: true});
await symlink(path.relative(path.dirname(link), main), link);
await writeFile(path.join(output, 'runtime/manifest.json'), JSON.stringify({node: version, packages}, null, 2) + '\n');
console.log(`Bundled Node ${version} and ${packages.length} runtime packages at ${output}`);
