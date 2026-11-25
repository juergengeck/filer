import {build} from 'esbuild';
import {createReadStream} from 'node:fs';
import {mkdir, mkdtemp, readFile, copyFile, readdir, writeFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {builtinModules} from 'node:module';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Package on Windows x64 with the matching built ProjFS addon');
const binary = process.env.NODE_BINARY ?? process.execPath;
const runtime = JSON.parse(execFileSync(binary, ['-p', 'JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})'], {encoding: 'utf8'}));
if (!/^v22\./.test(runtime.version) || runtime.arch !== 'x64' || runtime.platform !== 'win32') throw new Error('This package requires Windows x64 Node 22');
await mkdir(path.join(repository, 'dist'), {recursive: true});
const output = await mkdtemp(path.join(repository, 'dist/OneFiler-windows-x64-'));
const bundle = await build({absWorkingDir: repository, entryPoints: ['windows/host.mjs'], outfile: path.join(output, 'host.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', metafile: true, legalComments: 'eof',
  banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"},
  external: ['bufferutil', 'utf-8-validate'], define: {'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"'}});
const builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
for (const entry of Object.values(bundle.metafile.outputs).flatMap(entry => entry.imports)) {
  if (!builtins.has(entry.path)) throw new Error('Unbundled dependency: ' + entry.path);
}
await mkdir(path.join(output, 'build/Release'), {recursive: true});
await copyFile(path.join(repository, 'one.projfs/build/Release/ifsprojfs.node'), path.join(output, 'build/Release/ifsprojfs.node'));
await copyFile(binary, path.join(output, 'node.exe'));
for (const name of ['health-theme.css', 'NativeHtmlDocument.js']) {
  await copyFile(path.resolve(repository, '../one/packages/refinio.api/dist/src/filer', name), path.join(output, name));
}
for (const name of ['Install.ps1', 'Uninstall.ps1', 'README.md']) await copyFile(path.join(import.meta.dirname, name), path.join(output, name));
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
execFileSync(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + path.join(output, 'Filer.exe'),
  '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', '/reference:System.Security.dll',
  path.join(import.meta.dirname, 'FilerDesktop.cs')], {stdio: 'inherit'});

// Carry the licenses of every package contributing bytes, not just direct dependencies.
const packages = new Map();
for (const input of Object.keys(bundle.metafile.inputs)) {
  let directory = path.dirname(path.resolve(repository, input));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name) packages.set(directory, manifest);
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
}
const inventory = [];
for (const [source, manifest] of packages) {
  const id = (manifest.name + '-' + manifest.version).replace(/[^a-zA-Z0-9.-]/g, '_');
  const destination = path.join(output, 'licenses', id);
  await mkdir(destination, {recursive: true});
  for (const file of await readdir(source)) if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(file) && (await stat(path.join(source, file))).isFile())
    await copyFile(path.join(source, file), path.join(destination, file));
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({name: manifest.name, version: manifest.version, license: manifest.license}, null, 2));
  inventory.push({name: manifest.name, version: manifest.version, license: manifest.license});
}
const licenseResponse = await fetch(`https://raw.githubusercontent.com/nodejs/node/${runtime.version}/LICENSE`);
if (!licenseResponse.ok) throw new Error('Could not obtain the matching Node redistribution license');
await writeFile(path.join(output, 'licenses/Node-LICENSE'), await licenseResponse.text());

/** Hash only package-owned regular files; the installer rejects extra or escaped paths. */
async function files(directory) {
  const result = {};
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(target));
    else if (entry.isFile()) result[path.relative(output, target).split(path.sep).join('/')] = createHash('sha256').update(await readFile(target)).digest('hex');
    else throw new Error('Package contains a link or unsupported file: ' + target);
  }
  return result;
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({format: 1, platform: 'win32', arch: 'x64', node: runtime.version,
  packages: inventory, files: await files(output)}, null, 2) + '\n');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(import.meta.dirname, 'Archive.ps1'), output, output + '.zip'], {stdio: 'inherit'});
const archive = output + '.zip';
const archiveHash = createHash('sha256');
for await (const chunk of createReadStream(archive)) archiveHash.update(chunk);
const checksum = archive + '.sha256';
await writeFile(checksum, archiveHash.digest('hex') + '  ' + path.basename(archive) + '\n');
console.log(JSON.stringify({directory: output, archive, checksum}));
