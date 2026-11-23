const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {parse} = require('yaml');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const {packages, transitivePackages = []} = require('../.vendorrc.json');
const lock = parse(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'filer-vendor-check-'));
const failures = [];

function digest(file, algorithm, encoding) {
    return createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
}

function archiveFiles(directory, relative = '') {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const file = path.join(relative, entry.name);
        return entry.isDirectory() ? archiveFiles(path.join(directory, entry.name), file) : [file];
    });
}

function verifyPackage(name, spec) {
    if (!spec?.startsWith('file:./vendor/') || manifest.pnpm.overrides[name] !== spec) {
        throw new Error('expected a local archive and a matching pnpm override');
    }
    const archive = path.resolve(root, spec.slice('file:'.length));
    const relative = path.relative(root, archive);
    const checksum = digest(archive, 'sha256', 'hex').slice(0, 16);
    if (!relative.startsWith(`vendor${path.sep}`) || !relative.endsWith(`-${checksum}.tgz`)) {
        throw new Error('archive path or content digest differs from its pin');
    }
    const integrity = `sha512-${digest(archive, 'sha512', 'base64')}`;
    if (lock.packages?.[`${name}@file:${relative}`]?.resolution?.integrity !== integrity) {
        throw new Error('archive differs from lockfile integrity');
    }

    const installed = path.join(root, 'node_modules', name);
    if (!fs.realpathSync(installed).startsWith(`${fs.realpathSync(path.join(root, 'node_modules'))}${path.sep}`)) {
        throw new Error('installed package resolves outside this app');
    }
    const destination = fs.mkdtempSync(path.join(temporary, 'entry-'));
    execFileSync('tar', ['-xzf', archive, '-C', destination]);
    const packed = path.join(destination, 'package');
    for (const file of archiveFiles(packed)) {
        if (file === 'package.json') continue;
        const target = path.join(installed, file);
        if (!fs.existsSync(target) || digest(path.join(packed, file), 'sha256', 'hex') !== digest(target, 'sha256', 'hex')) {
            failures.push(`${name}/${file}: differs from archive`);
        }
    }

    const expected = JSON.parse(fs.readFileSync(path.join(packed, 'package.json'), 'utf8'));
    const actual = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    for (const field of ['name', 'version', 'main', 'module', 'react-native', 'browser', 'exports']) {
        if (JSON.stringify(expected[field]) !== JSON.stringify(actual[field])) failures.push(`${name}: package.json ${field} differs`);
    }
}

try {
    const entries = [
        ...packages.map(({name}) => [name, manifest.dependencies[name]]),
        ...transitivePackages.map(({name}) => [name, manifest.pnpm.overrides[name]]),
    ];
    for (const [name, spec] of entries) {
        try {
            verifyPackage(name, spec);
        } catch (error) {
            failures.push(`${name}: ${error.message}`);
        }
    }
    if (failures.length) {
        console.error(`Vendor install differs from pinned archives (${failures.length} mismatches)\n${failures.join('\n')}`);
        process.exitCode = 1;
    } else {
        console.log(`Verified ${entries.length} vendored packages against the lockfile and installed files.`);
    }
} finally {
    fs.rmSync(temporary, {recursive: true, force: true});
}
