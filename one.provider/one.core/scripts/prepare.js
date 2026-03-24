#!/usr/bin/env node
import { buildIfNotBuilt } from './_build-common.js';
async function run() {
    console.log('########## one.core: Prepare ##########');
    console.log(`CWD:  ${process.cwd()}`);
    console.log(`ARGS: ${JSON.stringify(process.argv)}`);
    await buildIfNotBuilt();
    console.log('########## one.core: End Prepare ##########\n');
}
run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
//# sourceMappingURL=prepare.js.map