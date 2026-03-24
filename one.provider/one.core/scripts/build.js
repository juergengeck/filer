#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { build } from './_build-common.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
async function run() {
    console.log('########## one.core: Build ##########');
    await build();
    console.log('########## one.core: End build ##########');
}
if (process.argv.findIndex(arg => arg.startsWith('-f')) >= 0) {
    console.error('It looks like build.js was called by a watcher process');
    process.exit(1);
}
process.chdir(join(__dirname, '..'));
run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
//# sourceMappingURL=build.js.map