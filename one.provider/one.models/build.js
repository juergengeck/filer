#!/usr/bin/env node

/* eslint-disable no-console */

import {dirname} from 'path';
import {fileURLToPath} from 'url';
import {rm} from 'fs/promises';
import {execSync} from 'child_process';
import * as fs from 'fs';
import path from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
    console.log('########## one.models: Build ##########');

    console.log('=> Remove target folder "lib"');
    await rm('lib', {recursive: true, force: true});

    console.log('=> Remove tsc build cache files tsconfig.[src.|test.]tsbuildinfo');
    // The incremental build files can lead to unpredictable build issues for the full-build
    // run, possibly because the target directory is deleted first.
    await rm('tsconfig.tsbuildinfo', {force: true});
    await rm('tsconfig.src.tsbuildinfo', {force: true});
    await rm('tsconfig.test.tsbuildinfo', {force: true});

    console.log('=> Calling tsc --build...');
    execSync('npx --no-install tsc --build --force --verbose', {stdio: 'inherit'});

    console.log('########## one.models: End build ##########');

    // Remove exports field to rely on Node's default resolution
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
        console.log('=> Removing "exports" field from package.json');
        try {
            /** @type {Record<string, any>} */
            const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkgJson.exports) {
                delete pkgJson.exports;
                fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2));
            }
        } catch (err) {
            console.error('Error while removing exports field:', err);
        }
    }
}

process.chdir(__dirname);

run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
