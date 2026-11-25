import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localPackages, supportsPlatform} from './platform-packages.mjs';

test('actual workspace manifests preserve Linux and macOS providers while selecting native Windows', async () => {
    const packages = await Promise.all(localPackages.map(async config => ({config,
        manifest: JSON.parse(await readFile(new URL(`../${config.directory}/package.json`, import.meta.url), 'utf8'))})));
    const expected = {linux: ['one.filer', 'one.fuse3'], darwin: ['one.filer', 'one.provider'], win32: ['one.projfs']};
    for (const [platform, targets] of Object.entries(expected)) {
        assert.deepEqual(packages.filter(({config, manifest}) => supportsPlatform(config, manifest, platform))
            .map(({config}) => config.directory), targets);
    }
});
