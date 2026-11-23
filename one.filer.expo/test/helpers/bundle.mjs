import {rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

/**
 * Bundle a TS entry for node:test, replacing named modules with inline stubs.
 * Third-party packages stay external so their own CJS `require()` calls keep
 * working; the bundle is written to a temp file inside the project so bare
 * imports resolve against the app's node_modules.
 */
export async function importBundled(entry, stubs = {}, alias = {}) {
    const names = Object.keys(stubs);
    const filter = names.length
        ? new RegExp(`^(${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`)
        : /^$/;
    const bundle = await build({
        entryPoints: [new URL(entry, import.meta.url).pathname],
        bundle: true,
        format: 'esm',
        platform: 'node',
        write: false,
        packages: 'external',
        alias,
        plugins: [{
            name: 'stubs',
            setup(b) {
                b.onResolve({filter}, ({path}) => ({path, namespace: 'stub'}));
                b.onLoad({filter: /.*/, namespace: 'stub'}, ({path}) => ({
                    contents: stubs[path],
                    loader: 'js'
                }));
            }
        }]
    });
    // Write beside the tests so bare imports resolve against the app tree.
    const file = join(new URL('.', import.meta.url).pathname, `.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mjs`);
    await writeFile(file, bundle.outputFiles[0].text);
    try {
        return await import(pathToFileURL(file).href);
    } finally {
        await rm(file, {force: true});
    }
}
