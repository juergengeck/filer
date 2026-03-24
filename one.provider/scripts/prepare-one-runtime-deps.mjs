import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const nodeRuntimeDir = join(projectDir, 'node-runtime');
const nodeRuntimeModulesDir = join(nodeRuntimeDir, 'node_modules');
const refinioModulesDir = join(nodeRuntimeModulesDir, '@refinio');
const localOneDir = process.env.ONE_PROVIDER_LOCAL_ONE_DIR
    ? resolve(projectDir, process.env.ONE_PROVIDER_LOCAL_ONE_DIR)
    : resolve(projectDir, '../../one');
const useLocalOneSetting = (process.env.ONE_PROVIDER_USE_LOCAL_ONE || 'auto').toLowerCase();

function isLocalOneEnabled() {
    return !['0', 'false', 'no', 'off'].includes(useLocalOneSetting);
}

function getWorkspacePackageDir(packageName) {
    return join(localOneDir, 'packages', packageName);
}

function ensureWorkspacePackageReady(packageName) {
    const packageDir = getWorkspacePackageDir(packageName);

    if (!existsSync(packageDir)) {
        throw new Error(`Missing local ONE package: ${packageDir}`);
    }

    if (!existsSync(join(packageDir, 'lib'))) {
        throw new Error(
            `Missing built output for ${packageName} at ${join(packageDir, 'lib')}. Run the build in ../one first.`
        );
    }

    if (!existsSync(join(packageDir, 'node_modules'))) {
        throw new Error(
            `Missing node_modules for ${packageName} at ${join(packageDir, 'node_modules')}. Run pnpm install in ../one first.`
        );
    }

    return packageDir;
}

function copyWorkspacePackage(packageName) {
    const destinationDir = join(refinioModulesDir, packageName);
    ensureWorkspacePackageReady(packageName);
    rmSync(destinationDir, {recursive: true, force: true});
    const deployArguments = ['--dir', localOneDir, '--filter', `@refinio/${packageName}`, 'deploy'];

    if (packageName !== 'one.core') {
        deployArguments.push('--prod');
    }

    deployArguments.push(destinationDir);

    const result = spawnSync(
        'pnpm',
        deployArguments,
        {
            stdio: 'inherit'
        }
    );

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }

    // one.models is deployed with its workspace dependency bundled as a nested @refinio/one.core.
    // Remove that nested copy so the runtime uses the same top-level one.core instance everywhere.
    rmSync(join(destinationDir, 'node_modules', '@refinio'), {recursive: true, force: true});
}

function installVendoredPackages() {
    console.log('Using vendored ONE packages for node-runtime');
    const result = spawnSync('npm', ['run', 'vendor:install'], {
        cwd: nodeRuntimeDir,
        stdio: 'inherit'
    });

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function installLocalWorkspacePackages() {
    console.log(`Using local ONE workspace at ${localOneDir}`);
    mkdirSync(refinioModulesDir, {recursive: true});
    copyWorkspacePackage('one.core');
    copyWorkspacePackage('one.models');
}

const shouldUseLocalOne =
    isLocalOneEnabled() &&
    existsSync(getWorkspacePackageDir('one.core')) &&
    existsSync(getWorkspacePackageDir('one.models'));

if (shouldUseLocalOne) {
    installLocalWorkspacePackages();
} else {
    installVendoredPackages();
}
