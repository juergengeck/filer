import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = name => JSON.parse(readFileSync(join(root, name), 'utf8'));

test('iOS identity matches the standalone Filer plan', () => {
    const app = readJson('app.json').expo;
    assert.equal(app.ios.bundleIdentifier, 'one.filer');
    assert.equal(app.ios.appleTeamId, '26W8AC52QS');
    assert.deepEqual(app.ios.infoPlist.NSBonjourServices, ['_one-refinio._udp']);
    assert.equal(app.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
    assert.deepEqual(app.ios.infoPlist.LSApplicationQueriesSchemes, ['shareddocuments']);
    const pluginEntry = app.plugins.find(
        entry => (Array.isArray(entry) ? entry[0] : entry) === '@refinio/filer.expo'
    );
    assert.ok(pluginEntry, 'expects the @refinio/filer.expo plugin entry');
    const filerPlugin = Array.isArray(pluginEntry) ? pluginEntry[1] : undefined;
    assert.ok(filerPlugin, 'expects @refinio/filer.expo plugin options');
    assert.equal(filerPlugin.appGroupIdentifier, 'group.one.filer');
    assert.equal(filerPlugin.iosExtensionBundleIdentifier, 'one.filer.extension');
    assert.equal(filerPlugin.iosDisplayName, 'ONE Filer');
});

test('every vendored package resolves to a local archive', () => {
    const pkg = readJson('package.json');
    const vendorrc = readJson('.vendorrc.json');
    for (const entry of vendorrc.packages) {
        assert.match(entry.name, /^(@refinio|@glueone)\//, 'internal packages only');
        assert.ok(
            existsSync(resolve(root, entry.path)),
            `vendor source exists for ${entry.name}`
        );
        const spec = pkg.dependencies[entry.name];
        assert.match(spec ?? '', /^file:\.\/vendor\/.+\.tgz$/, `pinned archive for ${entry.name}`);
        assert.equal(pkg.pnpm.overrides[entry.name], spec, `pnpm override for ${entry.name}`);
        assert.equal(pkg.overrides[entry.name], spec, `npm override for ${entry.name}`);
    }
});
