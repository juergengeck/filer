#!/usr/bin/env node
import { generateDocumentation } from './makeDocs.js';
async function run() {
    console.log('########## one.core: PrepublishOnly ##########');
    console.log(`CWD:  ${process.cwd()}`);
    console.log(`ARGS: ${JSON.stringify(process.argv)}`);
    await generateDocumentation();
    console.log('########## one.core: End PrepublishOnly ##########\n');
}
run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
//# sourceMappingURL=prepublishOnly.js.map