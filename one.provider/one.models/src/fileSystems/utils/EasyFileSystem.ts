import type {
    FileDescription,
    FileSystemDirectory,
    FileSystemFile,
    IFileSystem
} from '../IFileSystem.js';
import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from '../FileSystemErrors.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';
import {escapeFileName} from './FileNameEscaping.js';
import {getArrayBuffer} from '@refinio/one.core/lib/util/buffer.js';

export type EasyDirectoryContent = Map<string, EasyDirectoryEntry>;
export type EasyRegularFileContent = Uint8Array | string;
export type EasySymlinkContent = string;

export type EasyDirectory = EasyDirectoryContent | (() => Promise<EasyDirectoryContent>);
export type EasyRegularFile = EasyRegularFileContent | (() => Promise<EasyRegularFileContent>);
export type EasySymlink = EasySymlinkContent | (() => Promise<EasySymlinkContent>);

export type EasyDirectoryEntry =
    | {type: 'directory'; content: EasyDirectory}
    | {type: 'regularFile'; content: EasyRegularFile}
    | {type: 'symlink'; content: EasySymlink};

interface EasyDirectoryLookupError {
    type: 'error';
    reason: 'ExpectedDirectoryRegularFileFound' | 'DirectoryNotFound';
    path: string[];
}

/**
 * This is a convenience implementation for readonly file systems with small files.
 *
 * Write support might be added later.
 *
 * In order to use it you only have to specify the directory structure as a hierarchy of maps,
 * like
 *
 *         super();
 *         this.setRootDirectory(
 *             new Map<string, EasyDirectoryEntry>([
 *                 ['chats.json', {type: 'regularFile', content: this.loadTopics.bind(this)}],
 *                 ['channels.json', {type: 'regularFile', content: this.loadChannels.bind(this)}],
 *                 ['chats', {type: 'directory', content: new Map()}]
 *             ])
 *         );
 */
export default class EasyFileSystem implements IFileSystem {
    private rootDirectory: EasyDirectory = new Map();
    private readonly escapeFileNames;

    /**
     * Constructor
     */
    constructor(escapeFileNames: boolean = false) {
        this.escapeFileNames = escapeFileNames;
    }

    /**
     * Set the root directory layout.
     *
     * @param rootDirectory
     */
    protected setRootDirectory(rootDirectory: EasyDirectory): void {
        this.rootDirectory = rootDirectory;
    }

    // ######## IFileSystem interface implementation ########

    async createDir(directoryPath: string, _dirMode: number): Promise<void> {
        throw await this.getNoWritePermissionError(directoryPath);
    }

    async createFile(
        directoryPath: string,
        _fileHash: SHA256Hash<BLOB>,
        _fileName: string,
        _fileMode: number
    ): Promise<void> {
        throw await this.getNoWritePermissionError(directoryPath);
    }

    async exists(path: string): Promise<boolean> {
        const elem = await this.getDirectoryEntry(path);
        return elem.type === 'error';
    }

    async readDir(path: string): Promise<FileSystemDirectory> {
        const elem = await this.getDirectoryEntryThrows(path);

        if (elem.type !== 'directory') {
            throw createError('FSE-ENOTDIR', {
                message: FS_ERRORS['FSE-ENOTDIR'].message,
                path
            });
        }

        const content = await EasyFileSystem.loadDirectoryContent(
            elem.content,
            this.escapeFileNames
        );
        return {
            children: [...content.keys()]
        };
    }

    async readFile(path: string): Promise<FileSystemFile> {
        const elem = await this.getDirectoryEntryThrows(path);

        if (elem.type === 'directory') {
            throw createError('FSE-EISDIR', {
                message: FS_ERRORS['FSE-EISDIR'].message,
                path
            });
        } else if (elem.type === 'symlink') {
            // The open man page states, that if an 'open' is made on a symlink with
            // O_PATH and O_NOFOLLOW the read call should return EBADF. Other ways of getting a
            // read on a symlink should not be possible.
            // Let's hope, that the symlink following is done by fuse itself and we don't have
            // to do it!
            throw createError('FSE-EBADF', {
                message: FS_ERRORS['FSE-EBADF'].message,
                path
            });
        }

        return {content: await EasyFileSystem.loadRegularFileContentAsBinary(elem.content)};
    }

    async readFileInChunks(
        path: string,
        length: number,
        position: number
    ): Promise<FileSystemFile> {
        return {
            content: (await this.readFile(path)).content.slice(position, position + length)
        };
    }

    async chmod(path: string, _mode: number): Promise<number> {
        throw await this.getNoWritePermissionError(path);
    }

    async rename(_src: string, dest: string): Promise<number> {
        throw await this.getNoWritePermissionError(dest);
    }

    async rmdir(path: string): Promise<number> {
        throw await this.getNoWritePermissionError(path);
    }

    async unlink(path: string): Promise<number> {
        throw await this.getNoWritePermissionError(path);
    }

    async stat(path: string): Promise<FileDescription> {
        const elem = await this.getDirectoryEntryThrows(path);

        switch (elem.type) {
            case 'directory':
                return {mode: 0o0040555, size: 0};
            case 'regularFile': {
                const content = await EasyFileSystem.loadRegularFileContentAsBinary(elem.content);
                return {mode: 0o0100444, size: content.byteLength};
            }
            case 'symlink':
                return {mode: 0o0120777, size: 0};
            default:
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: path
                });
        }
    }

    async symlink(src: string, _dest: string): Promise<void> {
        throw createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message,
            functionName: 'symlink()',
            path: src
        });
    }

    async readlink(path: string): Promise<FileSystemFile> {
        const elem = await this.getDirectoryEntryThrows(path);

        if (elem.type !== 'symlink') {
            // See readlink(2) man page
            throw createError('FSE-EINVAL', {
                message: FS_ERRORS['FSE-EINVAL'].message,
                path
            });
        }

        return {content: await EasyFileSystem.loadSymlinkContentAsBinary(elem.content)};
    }

    supportsChunkedReading(_path?: string): boolean {
        return true;
    }

    // ######## Private stuff ########

    /**
     * This will construct the appropriate error for not having write permissions.
     *
     * If the file does not exist, then it will return ENOENT, otherwise it will return EACCESS.
     *
     * @param path
     */
    private async getNoWritePermissionError(path: string): Promise<object> {
        if (await this.exists(path)) {
            return createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path
            });
        } else {
            return createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path
            });
        }
    }

    // ######## Recursive loading of directory elements ########

    /**
     * Get the directory entry from the given path.
     *
     * @param path
     */
    private async getDirectoryEntry(
        path: string
    ): Promise<EasyDirectoryEntry | EasyDirectoryLookupError> {
        const pathArr = path.split('/');

        if (pathArr.length < 2) {
            throw new Error(
                'Path does not start with a /. path.split does not return at least two elements'
            );
        }

        const [emptyElement, ...remainingPathArr] = pathArr;

        if (emptyElement !== '') {
            throw new Error(
                'Path does not start with a / path.split does not return an empty first element.'
            );
        }

        return this.getDirectoryEntryPathArray(
            // For the '/' path we have one empty element => pass empty array
            remainingPathArr.length === 1 && remainingPathArr[0] === '' ? [] : remainingPathArr,
            this.rootDirectory
        );
    }

    /**
     * Same as getDirectoryEntry, except that it throws on error.
     *
     * @param path
     */
    private async getDirectoryEntryThrows(path: string): Promise<EasyDirectoryEntry> {
        const entry = await this.getDirectoryEntry(path);
        return EasyFileSystem.ensureNoLookupError(entry, path);
    }

    /**
     * Same as getDirectoryEntry but operates on an array of path elements.
     *
     * This is the recursive implementation.
     *
     * @param path
     * @param directory
     * @private
     */
    private async getDirectoryEntryPathArray(
        path: string[],
        directory: EasyDirectory
    ): Promise<EasyDirectoryEntry | EasyDirectoryLookupError> {
        if (path.length === 0) {
            return {type: 'directory', content: directory};
        }

        const [topLevelPath, ...remainingPath] = path;
        const directoryContent = await EasyFileSystem.loadDirectoryContent(
            directory,
            this.escapeFileNames
        );
        const entry = directoryContent.get(topLevelPath);

        if (entry === undefined) {
            return {type: 'error', reason: 'DirectoryNotFound', path};
        }

        // We found the requested element => return
        if (remainingPath.length === 0) {
            return entry;
        }

        // We need to get a step deeper
        if (entry.type !== 'directory') {
            return {type: 'error', reason: 'ExpectedDirectoryRegularFileFound', path};
        }

        return this.getDirectoryEntryPathArray(remainingPath, entry.content);
    }

    /**
     * This converts an lookup error in directory lookup into an exception that is then thrown.
     *
     * @param directoryEntry
     * @param path
     * @private
     */
    private static ensureNoLookupError(
        directoryEntry: EasyDirectoryEntry | EasyDirectoryLookupError,
        path: string
    ): EasyDirectoryEntry {
        if (directoryEntry.type === 'error') {
            if (directoryEntry.reason === 'ExpectedDirectoryRegularFileFound') {
                throw createError('FSE-ENOTDIR', {
                    message: FS_ERRORS['FSE-ENOTDIR'].message,
                    path
                });
            } else {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path
                });
            }
        }

        return directoryEntry;
    }

    // ######## Directory and file loading ########

    /**
     * Get the content of a directory and escape forbidden chars in file names if activated.
     *
     * @param directory
     * @param escapeForbiddenChars
     */
    private static async loadDirectoryContent(
        directory: EasyDirectory,
        escapeForbiddenChars: boolean
    ): Promise<EasyDirectoryContent> {
        let content;

        if (typeof directory === 'function') {
            content = await directory();
        } else {
            content = directory;
        }

        // Escape forbidden chars if it is enabled.
        if (escapeForbiddenChars) {
            const escapedMap = new Map();

            for (const [key, value] of content.entries()) {
                escapedMap.set(escapeFileName(key), value);
            }

            content = escapedMap;
        }

        return content;
    }

    /**
     * Load the content of a file.
     *
     * @param file
     */
    private static async loadRegularFileContent(
        file: EasyRegularFile
    ): Promise<EasyRegularFileContent> {
        if (typeof file === 'function') {
            return file();
        } else {
            return file;
        }
    }

    /**
     * Load the content of a file as binary.
     *
     * @param file
     */
    private static async loadRegularFileContentAsBinary(
        file: EasyRegularFile
    ): Promise<ArrayBuffer> {
        const content = await EasyFileSystem.loadRegularFileContent(file);
        if (content instanceof Uint8Array) {
            return getArrayBuffer(content);
        }
        return getArrayBuffer(new TextEncoder().encode(content));
    }

    /**
     * Load the content of a symlink.
     *
     * @param link
     */
    private static async loadSymlinkContent(link: EasySymlink): Promise<EasySymlinkContent> {
        if (typeof link === 'function') {
            return link();
        } else {
            return link;
        }
    }

    /**
     * Load the content of a symlink as binary.
     *
     * @param link
     */
    private static async loadSymlinkContentAsBinary(link: EasySymlink): Promise<ArrayBuffer> {
        const content = await EasyFileSystem.loadSymlinkContent(link);
        return getArrayBuffer(new TextEncoder().encode(content));
    }
}
