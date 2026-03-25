import {resolve} from 'path';
import {pathToFileURL} from 'url';

function getPackagesDirectory(): string {
    return resolve(__dirname, '../../../packages');
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
