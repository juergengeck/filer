#!/usr/bin/env node

/* eslint-disable no-console */

import {generateDocumentation} from './makeDocs.js';

async function run(): Promise<void> {
    console.log('########## one.core: PrepublishOnly ##########');
    console.log(`CWD:  ${process.cwd()}`);
    console.log(`ARGS: ${JSON.stringify(process.argv)}`);

    // tsc --build is done through prepare.js script

    await generateDocumentation();

    console.log('########## one.core: End PrepublishOnly ##########\n');
}

run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
