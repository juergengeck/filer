#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildIfNotBuilt } from './_build-common.js';
async function run() {
    console.log('########## one.core: Install ##########');
    console.log(`CWD:  ${process.cwd()}`);
    console.log(`ARGS: ${JSON.stringify(process.argv)}`);
    await buildIfNotBuilt();
    console.log('########## one.core: End install ##########\n');
}
const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, '..'));
run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
//# sourceMappingURL=install.js.map