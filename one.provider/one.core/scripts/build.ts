#!/usr/bin/env node

/* eslint-disable no-console */

import {dirname, join} from 'path';
import {fileURLToPath} from 'url';

import {build} from './_build-common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
    console.log('########## one.core: Build ##########');

    await build();

    console.log('########## one.core: End build ##########');
}

// TODO GACK Temporary hack  when I'm switching between 0.4.x and 0.5.x one.core lines the
//  watcher required for 0.4.x spawns lots of vuild.js for each file changed by switching the
//  branch, completely overloading my system, since build.js instead of handling just a single
//  file with the "-f file" command line argument, now does a complete build.
if (process.argv.findIndex(arg => arg.startsWith('-f')) >= 0) {
    console.error('It looks like build.js was called by a watcher process');
    process.exit(1);
}

process.chdir(join(__dirname, '..'));

run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
