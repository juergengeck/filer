#!/usr/bin/env node
'use strict';

/*
  eslint-disable
  global-require,
  no-await-in-loop,
  no-console,
  require-jsdoc,
  no-sync,
  @typescript-eslint/no-var-requires,
  @typescript-eslint/no-use-before-define
 */

/**
 * @file Build project files for node.js, React-Native or for browsers, and strip Flow type
 * annotations.
 */

const fs = require('fs');
const {basename, dirname, join, sep} = require('path');
const {promisify} = require('util');
const {execSync} = require('child_process');

// @ts-ignore
const babel = require('@babel/core');

const PLATFORMS = {
    nodejs: ['commonjs', 'es2015'],
    browser: ['es2015']
};

const BABEL_MODULE_TARGETS = {
    // See https://babeljs.io/docs/en/next/babel-plugin-transform-modules-commonjs.html
    commonjs: '@babel/plugin-transform-modules-commonjs',
    // See https://babeljs.io/docs/en/next/babel-plugin-transform-modules-systemjs.html
    systemjs: '@babel/plugin-transform-modules-systemjs',
    // See https://babeljs.io/docs/en/next/babel-plugin-transform-modules-umd.html
    umd: '@babel/plugin-transform-modules-umd'
};

const BABEL_OPTS = {
    presets: ['@babel/preset-typescript'],
    sourceMap: true,
    plugins: [
        // https://babel.dev/docs/en/babel-plugin-transform-typescript
        ['@babel/plugin-transform-typescript', {strictMode: true}],
        // https://babel.dev/docs/en/babel-plugin-transform-runtime
        '@babel/plugin-transform-runtime'
    ],
    comments: false,
    filename: ''
};

const chmod = promisify(fs.chmod);
const unlink = promisify(fs.unlink);
const lstat = promisify(fs.lstat);
const mkDir = promisify(fs.mkdir);
const rmDir = promisify(fs.rmdir);
const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

/**
 * @returns {void}
 */
function usage() {
    console.log(`
Usage: node build.js or ./build.js [help] [node|browser|rn|low|moddable] [-m es2015|commonjs|systemjs|umd] [-t target directory] [-f script.js]

Options:

  h | help | -h | --help   Show this usage text.

  Target:

  nodejs     Build for node.js
  lowjs      Build for low.js
  moddable   Build for Moddable
  browser    Build for webbrowsers
  rn         Build for React Native

  NOTE: The target can also be given in environment variable ONE_TARGET_PLATFORM
        Specifying a target platform as command line argument overrides the environment variable.

  -m Choose the target module system. Default is CommonJS, other options are ES2015,
     SystemJS and UMD (all names need to be without any capitalization).

  -t target directory Default is ./lib/

  The -f option is for processing source files individually, usually by a watcher process:

  -f relative/path/script.js

  Example for how to use it to build for the "node.js" target in a WebStorm watcher process that
  watches source files for changes and calls build.js when it detects a change:

  Program:   build.js
  Arguments: -f $/FilePathRelativeToProjectRoot$ node
  File Type: "Javascript"
  Scope: "Current File" (with any scope that contains more than one file build.js will be
         called for every file in that scope, even if only one file changed)
    `);
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
function mkDirExistOkay(dir) {
    return mkDir(dir, {recursive: true}).catch(err => {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    });
}

/**
 * @param {string} dir
 * @param {string} file
 * @returns {Promise<void>}
 */
async function deleteFile(dir, file) {
    const filePath = join(dir, file);
    const stats = await lstat(filePath);

    if (stats.isDirectory()) {
        return await deleteDirectory(filePath);
    } else {
        return unlink(filePath);
    }
}

/**
 * @param {string} dir
 * @returns {Promise<void>}
 */
async function deleteDirectory(dir) {
    let files;

    try {
        files = await readDir(dir);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // Nothing to remove? That's okay!
            return;
        } else {
            throw err;
        }
    }

    await Promise.all(files.map(file => deleteFile(dir, file)));

    await rmDir(dir);
}

/**
 * @param {string} code
 * @param {object} options - See https://babeljs.io/docs/en/options
 * @returns {Promise<{code:string, map:SourceMap}>} Returns the transformed code string
 */
function transform(code, options) {
    return new Promise((resolve, reject) => {
        // See https://babeljs.io/docs/en/babel-core
        // result: {code, map, ast}
        babel.transform(code, options, (/** @type Error*/ err, /** @type any*/ result) => {
            if (err) {
                return reject(err);
            }

            return resolve({
                code: result.code.replace(/(\nimport [^"']+["'])([^"']+).[tj]s(["'];)/gm, '$1$2$3'),
                map: result.map
            });
        });
    });
}

/**
 * @param {string} targetDir - Where to write the transpiled file to
 * @param {string} srcDir - Directory relative to PROJECT_ROOT
 * @param {string} file - The filename without path
 * @returns {Promise<void>}
 */
async function transformAndWriteJsFile(targetDir, srcDir, file) {
    if (file.endsWith('.d.ts') || !file.endsWith('.ts')) {
        return;
    }

    const code = await readFile(join(__dirname, srcDir, file), 'utf8');

    if (!code) {
        return console.warn(`WARNING: empty file ${file}`);
    }

    await mkDirExistOkay(targetDir);

    const destination = join(targetDir, file.replace(/\.ts$/, ''));

    console.log(`Processing file ${join(srcDir, file)} ⇒ ${destination}[.ts]`);

    BABEL_OPTS.filename = file;

    const transformedCode = await transform(code, BABEL_OPTS);

    transformedCode.code += `\n//# sourceMappingURL=${file.replace(/\.ts$/, '')}.js.map`;
    await writeFile(destination + '.js', transformedCode.code, {flag: 'w'});

    transformedCode.map.sources[0] = `../${srcDir}/` + transformedCode.map.sources[0];
    await writeFile(destination + '.js.map', JSON.stringify(transformedCode.map), {
        flag: 'w'
    });

    if (destination.endsWith(join('tools', file.replace(/\.ts$/, '')))) {
        await chmod(destination + '.js', '755');
    }
}

/**
 * @param {string} srcDir
 * @param {string} targetDir
 * @param {string} system
 * @returns {Promise<void>}
 */
async function processAllFiles(srcDir, targetDir, system) {
    console.log(`=> Processing directory ${srcDir}...`);

    const files = await readDir(join(__dirname, srcDir));

    for (const file of files) {
        const stats = fs.statSync(join(srcDir, file));

        if (stats.isDirectory()) {
            if (!file.includes('system') || file.includes('system-' + system)) {
                await processAllFiles(join(srcDir, file), join(targetDir, file), system);
            }
        } else {
            await transformAndWriteJsFile(
                srcDir.endsWith('system-' + system)
                    ? targetDir.replace('system-' + system, 'system')
                    : targetDir,
                srcDir,
                file
            );
        }
    }
}

/**
 * @param {string} targetDir
 * @returns {Promise<void>}
 */
async function createDeclarationFiles(targetDir) {
    console.log('Calling tsc to create declaration and map files...');

    try {
        execSync('tsc -p tsconfig.declarations.json --outDir ' + targetDir, {stdio: 'inherit'});
    } catch (err) {
        console.error('tsc failed with ' + err.message);
    } finally {
        // Remove extraneous system folders, the target platform's code has been written to system/
        for (const p of Object.keys(PLATFORMS)) {
            await deleteDirectory(join(targetDir, `system-${p}`));
        }
    }
}

/**
 * If "-m" option is found a target system is set, otherwise the default of "commonjs" is used.
 * GLOBAL SIDE EFFECT: Possibly mutates BABEL_OPTS
 * @returns {string}
 */
function setModuleTarget() {
    const mIndex = process.argv.findIndex(arg => arg.startsWith('-m'));

    const moduleTarget = mIndex >= 0 ? process.argv[mIndex + 1].toLocaleLowerCase() : 'commonjs';

    switch (moduleTarget) {
        case 'es2015':
            break;

        case 'commonjs':
        case 'systemjs':
        case 'umd':
            // @ts-ignore
            BABEL_OPTS.plugins.push(BABEL_MODULE_TARGETS[moduleTarget]);
            break;

        default:
            throw new Error(
                'Option -m detected but no valid module system string (see usage with -h)'
            );
    }

    return moduleTarget;
}

/**
 * If "-t" option is found a target directory is set, otherwise the default of "lib" is used.
 * @returns {string}
 */
function getTargetDir() {
    const tIndex = process.argv.findIndex(arg => arg.startsWith('-t'));

    if (tIndex >= 0) {
        const targetDir = process.argv[tIndex + 1];

        if (targetDir === undefined) {
            throw new Error('Option -t detected but no target directory');
        }

        return targetDir;
    }

    return 'lib';
}

/**
 * Called e.g. by a watcher process for a single file? If so option "-f filename" will be found.
 * @returns {string} Returns the filename or an empty string if no "-f" option was detected
 */
function calledForSingleFile() {
    const fIndex = process.argv.findIndex(arg => arg.startsWith('-f'));

    if (fIndex >= 0) {
        const file = process.argv[fIndex + 1];

        if (file === undefined) {
            throw new Error('Option -f detected but no filename');
        }

        return file;
    }

    return '';
}

async function hackySetVersionNumberForCommander() {
    console.log('\nProcessing file lib/index.js to set version info from package.json...');
    const version = JSON.parse(await readFile(join(__dirname, 'package.json'), 'utf8')).version;
    const file = join(__dirname, 'lib', 'index.js');
    const code = await readFile(file, 'utf8');
    let replaceCount = 0;
    await writeFile(
        file,
        code.replace(/\.version\('[^']+',/g, () => {
            replaceCount += 1;
            return `.version('${version}',`;
        }),
        {
            flag: 'w'
        }
    );

    if (replaceCount !== 1) {
        console.error(
            `Found ${replaceCount} ".version()" commands in lib/index.js, expecting exactly 1`
        );
        process.exit(1);
    }

    console.log('...lib/index.js version set from package.json to', version);
}

/**
 * @returns {Promise<void>}
 */
async function run() {
    const SYSTEM = 'nodejs';
    const targetDir = getTargetDir();
    const moduleTarget = setModuleTarget(); // Call with side effect
    const singleFile = calledForSingleFile();

    if (singleFile !== '') {
        if (singleFile.startsWith('src/system') && !singleFile.startsWith(`src/system-${SYSTEM}`)) {
            return;
        }

        let destination = join(targetDir, dirname(singleFile).replace(/^src[\\/]?/, ''));

        if (singleFile.startsWith('test' + sep)) {
            destination = 'test';
        }

        if (singleFile.startsWith(`src${sep}system-${SYSTEM}${sep}`)) {
            destination = join(targetDir, 'system');
        }

        await transformAndWriteJsFile(destination, dirname(singleFile), basename(singleFile));

        if (singleFile.endsWith('index.js')) {
            await hackySetVersionNumberForCommander();
        }
    }

    console.log(`\n========== Begin building one.filer (${moduleTarget}/${SYSTEM}) ==========`);

    await deleteDirectory(targetDir);
    await processAllFiles('src', targetDir, SYSTEM);
    await createDeclarationFiles(targetDir);
    await processAllFiles('test', 'test', SYSTEM);

    await hackySetVersionNumberForCommander();

    console.log(`\n========== Done building one.filer (${moduleTarget}/${SYSTEM}) ==========`);
}

if (
    process.argv.includes('h') ||
    process.argv.includes('-h') ||
    process.argv.includes('help') ||
    process.argv.includes('--help')
) {
    usage();
    process.exit(0);
}

run().catch(err => {
    console.log(err.message);
    process.exit(1);
});
