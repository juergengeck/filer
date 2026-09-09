#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const siblingDependencyPackages = [
    {directory: '../one/packages/one.core'},
    {directory: '../one/packages/one.models'},
    {directory: '../one/packages/trie.core'},
    {directory: '../one/packages/chat.core'},
    {directory: '../one/packages/refinio.api'}
];

const localPackages = [
    {directory: 'one.filer'},
    {directory: 'one.provider'},
    {directory: 'one.fuse3'},
    {directory: 'one.projfs'}
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

    if (!isPackageSupportedOnPlatform(packageJson.os, currentPlatform)) {
        console.log(`- ${packageJson.name ?? packageDir}: skipped on ${currentPlatform}`);
        continue;
    }

    if (!packageJson.scripts?.[packageScriptName]) {
        console.log(`- ${packageJson.name ?? packageDir}: no ${packageScriptName} script`);
        continue;
    }

    console.log(`\n> ${packageJson.name ?? packageDir}: ${packageScriptName}`);
    ranAnyScript = true;

    const result = spawnSync(
        'pnpm',
        ['--dir', packageDir, 'run', packageScriptName, ...scriptArgs],
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

function isPackageSupportedOnPlatform(osField, current) {
    if (!Array.isArray(osField) || osField.length === 0) {
        return true;
    }

    const blocked = osField.some(entry => entry === `!${current}`);

    if (blocked) {
        return false;
    }

    const allowList = osField.filter(entry => !entry.startsWith('!'));

    return allowList.length === 0 || allowList.includes(current);
}
