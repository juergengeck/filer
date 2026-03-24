import { execSync } from 'child_process';
import { access, constants, rm } from 'fs/promises';
export async function fileExists(file) {
    try {
        await access(file, constants.F_OK);
        return true;
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            return false;
        }
        throw err;
    }
}
export async function build() {
    console.log('=> Run tsc --build --clean');
    execSync('npx --no-install tsc --build --clean', { stdio: 'inherit' });
    console.log('=> Remove target folder "lib"');
    await rm('lib', { recursive: true, force: true });
    console.log('=> Remove tsc build cache files tsconfig.[src.|test.]tsbuildinfo');
    await rm('tsconfig.tsbuildinfo', { force: true });
    await rm('tsconfig.src.tsbuildinfo', { force: true });
    await rm('tsconfig.test.tsbuildinfo', { force: true });
    console.log('=> Calling tsc --build...');
    execSync('npx --no-install tsc --build --force --verbose', { stdio: 'inherit' });
}
export async function buildIfNotBuilt() {
    if (!(await fileExists('lib'))) {
        await build();
    }
}
//# sourceMappingURL=_build-common.js.map