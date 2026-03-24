#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
export async function generateDocumentation() {
    console.log('=> Generating doc/API/ using "jsdoc"...');
    await rm(join('doc', 'API'), { recursive: true, force: true });
    const pkgJsonTxt = await readFile(join(__dirname, '..', 'package.json'), { encoding: 'utf8' });
    const pkgJsonObj = JSON.parse(pkgJsonTxt);
    pkgJsonObj.type = 'commonjs';
    await rename(join(__dirname, '..', 'package.json'), join(__dirname, '..', 'package.jsonORIG'));
    await writeFile(join(__dirname, '..', 'package.json'), JSON.stringify(pkgJsonObj, null, 4));
    try {
        execSync('npx --no-install jsdoc --verbose -a undefined -a public -c jsdoc.json', {
            stdio: 'inherit'
        });
    }
    catch (err) {
        console.error(err);
    }
    finally {
        await rm(join(__dirname, '..', 'package.json'), { force: true });
        await rename(join(__dirname, '..', 'package.jsonORIG'), join(__dirname, '..', 'package.json'));
    }
}
async function run() {
    await rm('lib', { recursive: true, force: true });
    console.log('########## one.core: Make docs (jsdoc) ##########');
    console.log(`CWD:  ${process.cwd()}`);
    console.log(`ARGS: ${JSON.stringify(process.argv)}`);
    await generateDocumentation();
    console.log('########## one.core: End make docs (jsdoc) ##########\n');
}
if (import.meta.url.startsWith('file:') && fileURLToPath(import.meta.url) === process.argv[1]) {
    run().catch(err => {
        console.log(err.message);
        process.exit(1);
    });
}
//# sourceMappingURL=makeDocs.js.map