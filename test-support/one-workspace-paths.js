import fs from 'fs';
import path from 'path';

export function getExistingPath(candidates, description) {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `${description} not found. Checked:\n` +
        candidates.map(candidate => `- ${candidate}`).join('\n')
    );
}

export function getFileUrl(filePath) {
    return filePath.startsWith('/')
        ? `file://${filePath}`
        : `file:///${filePath.replace(/\\/g, '/')}`;
}

export function getOneWorkspaceDir(currentDir) {
    return getExistingPath(
        [
            path.resolve(currentDir, '../../one'),
            path.resolve(currentDir, '../../../one'),
            path.resolve(currentDir, '../../../../one')
        ],
        'ONE workspace'
    );
}

export function getBuiltOneWorkspacePackagePath(currentDir, packageName, relativeLibPath) {
    const oneWorkspaceDir = getOneWorkspaceDir(currentDir);

    return getExistingPath(
        [
            path.join(oneWorkspaceDir, 'packages', packageName, 'lib', relativeLibPath)
        ],
        `built ${packageName} module`
    );
}
