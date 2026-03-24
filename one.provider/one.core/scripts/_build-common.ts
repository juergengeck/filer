/* eslint-disable no-console */

import {execSync} from 'child_process';
import {access, constants, rm} from 'fs/promises';

// /**
//  * Copies all console.log output to a file for easier debugging of npm stuff.
//  * @param file
//  */
// export function redirectOutputToFile(file: string) {
//     const reallog = console.log;
//
//     console.log = (...args) => {
//         reallog(...args);
//
//         for (const arg of args) {
//             writeFileSync(file, arg + '\n', {
//                 flag: 'a'
//             });
//         }
//     };
// }

export async function fileExists(file: string): Promise<boolean> {
    try {
        await access(file, constants.F_OK);
        return true;
    } catch (err) {
        if (err.code === 'ENOENT') {
            return false;
        }

        throw err;
    }
}

export async function build(): Promise<void> {
    console.log('=> Run tsc --build --clean');
    execSync('npx --no-install tsc --build --clean', {stdio: 'inherit'});

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
}

export async function buildIfNotBuilt(): Promise<void> {
    if (!(await fileExists('lib'))) {
        // Require it only on-demand, because this line requires dev-dependencies (TypeScript). If
        // dev-dependencies are missing this will fail.
        await build();
    }
}
