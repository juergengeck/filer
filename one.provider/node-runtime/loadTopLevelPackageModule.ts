import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

function getPackagesDirectory(): string {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));

    if (basename(moduleDirectory) === 'lib') {
        return resolve(moduleDirectory, '../../../packages');
    }

    return resolve(moduleDirectory, '../../packages');
}

/**
 * Resolve a file below the repository-local top-level packages directory.
 *
 * The node runtime executes from either source or `lib/`, so the path needs to
 * account for both layouts.
 *
 * @param relativePath
 */
export function getTopLevelPackagePath(relativePath: string): string {
    return resolve(getPackagesDirectory(), relativePath);
}

/**
 * Import a repository-local vendored package module by path.
 *
 * @param relativePath
 */
export async function importTopLevelPackageModule(relativePath: string): Promise<any> {
    return import(pathToFileURL(getTopLevelPackagePath(relativePath)).href);
}
