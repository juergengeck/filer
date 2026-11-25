#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {localPackages, supportsPlatform} from './platform-packages.mjs';

const siblingDependencyPackages = [
    {directory: '../one/packages/one.core'},
    {directory: '../one/packages/one.models'},
    {directory: '../one/packages/trie.core'},
    {directory: '../one/packages/chat.core'},
    {directory: '../one/packages/filer.core'},
    {directory: '../one/packages/llm.one'},
    {directory: '../fotos/fotos.core'},
    {directory: '../one/packages/settings.core'},
    {directory: '../one/packages/refinio.api'}
];

const [scriptName, ...rawScriptArgs] = process.argv.slice(2);
const localOnly = rawScriptArgs.includes('--local-only');
const scriptArgs = rawScriptArgs.filter(arg => arg !== '--local-only');
const workspacePackages = localOnly ? localPackages : [...siblingDependencyPackages, ...localPackages];

if (!scriptName) {
    console.error('Usage: node scripts/run-workspace-script.mjs <script> [-- <args>]');
    process.exit(1);
}

const rootDir = resolve(import.meta.dirname, '..');
const currentPlatform = platform();
let ranAnyScript = false;

for (const packageConfig of workspacePackages) {
    const packageDir = packageConfig.directory;
    const packageJsonPath = resolve(rootDir, packageDir, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const packageScriptName = packageConfig.scripts?.[scriptName] ?? scriptName;

    if (!supportsPlatform(packageConfig, packageJson, currentPlatform)) {
        console.log(`- ${packageJson.name ?? packageDir}: skipped on ${currentPlatform}`);
        continue;
    }

    if (!packageJson.scripts?.[packageScriptName]) {
        console.log(`- ${packageJson.name ?? packageDir}: no ${packageScriptName} script`);
        continue;
    }

    console.log(`\n> ${packageJson.name ?? packageDir}: ${packageScriptName}`);
    ranAnyScript = true;

    const pnpmEntry = process.env.npm_execpath;
    if (currentPlatform === 'win32' && !pnpmEntry) {
        throw new Error('Run workspace scripts through pnpm so its Node entry point is available on Windows.');
    }
    const result = spawnSync(
        currentPlatform === 'win32' ? process.execPath : 'pnpm',
        [...(currentPlatform === 'win32' ? [pnpmEntry] : []), '--dir', packageDir, 'run', packageScriptName, ...scriptArgs],
        {
            cwd: rootDir,
            stdio: 'inherit'
        }
    );

    if (result.error) {
        console.error(result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

if (!ranAnyScript) {
    console.error(`No package ran script "${scriptName}".`);
    process.exit(1);
}
