/**
 * This interface the main return structure for files
 */
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB} from '@refinio/one.core/lib/recipes.js';

export interface FileSystemFile {
    /**
     * The file's content can be either ArrayBuffer or a reference to a BLOB
     */
    content: ArrayBuffer;
}

/**
 * This interface represents the file/directory description structure for {@link FileSystemDirectory or @link FileSystemFile}
 */
export interface FileDescription {
    /**
     * The file mode {@link FileOptions}
     */
    mode: number;
    /**
     * The size of the file
     */
    size: number;
}

/**
 * This interface represents the main return structure for directories.
 */
export interface FileSystemDirectory {
    /**
     * Represents the content of the directory.
     */
    children: string[];
}

/**
 * File system generic interface
 * -----------------------------------------------
 *
 * Common file system interface for future file systems implementations. In order to achieve this, any
 * file system will have to implement the Interface and transform their data output in order to match function's
 * signatures.
 *
 * The following interfaces are used in order to create a common return type for most of the calls.
 * - {@link FileSystemFile}
 * - {@link FileSystemDirectory}
 * - {@link FileDescription}
 *
 *
 * Usage:
 * ------
 *
 * ``` typescript
 * class DemoFileSystem implements IFileSystem {
 *         createDir(directoryPath: string, dirMode: number): Promise<void> {
 *              // ... implement call
 *         }
 *         createFile(directoryPath: string,fileHash: SHA256Hash<BLOB>,fileName: string,fileMode: number): Promise<void> {
 *              // ... implement call
 *         }
 *         readDir(dirPath: string): Promise<FileSystemDirectory> {
 *              // ... implement call
 *         }
 *         readFile(filePath: string): Promise<FileSystemFile> {
 *              // ... implement call
 *         }
 *         readlink(filePath: string): Promise<FileSystemFile> {
 *              // ... implement call
 *         }
 *         readFileInChunks(filePath: string, length: number, position: number): Promise<FileSystemFile> {
 *              // ... implement call
 *         }
 *         supportsChunkedReading(path?: string): boolean {
 *              // ... implement call
 *         }
 *         stat(path: string): Promise<FileDescription> {
 *              // ... implement call
 *         }
 *         rmdir(pathName: string): Promise<number> {
 *              // ... implement call
 *         }
 *         unlink(pathName: string): Promise<number> {
 *              // ... implement call
 *         }
 *         symlink(src: string, dest: string): Promise<void> {
 *              // ... implement call
 *         }
 *         symlink(src: string, dest: string): Promise<void> {
 *              // ... implement call
 *         }
 *         rename(src: string, dest: string): Promise<number> {
 *              // ... implement call
 *         }
 *         chmod(pathName: string, mode: number): Promise<number> {
 *              // ... implement call
 *         }
 * }
 * ```
 *
 *
 *
 */
export interface IFileSystem {
    /**
     * Creates a directory.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} when the parent dir does not exist or the given mode is not a dir type
     * - {@link FS_ERRORS.FSE-EXISTS} when the current path already exists
     * - {@link FS_ERRORS.FSE-EACCES-W} if the parent directory does not have write permission
     *
     * @param {string} directoryPath - The wanted dir path
     * @param {number} dirMode - The wanted mode for the wanted dir
     * @returns {Promise<void>}
     */
    createDir(directoryPath: string, dirMode: number): Promise<void>;

    /**
     * Creates a file otherwise
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} when the parent dir does not exist or the given mode is not a file type
     * - {@link FS_ERRORS.FSE-EXISTS} when the current path already exists
     * - {@link FS_ERRORS.FSE-EACCES-W} if the parent directory does not have write permission
     *
     * @param {string} directoryPath - The directory where the file will be saved
     * @param {SHA256Hash<BLOB>} fileHash - The BLOB file hash
     * @param {string} fileName - The file name
     * @param {number} fileMode - The file mode
     * @returns {Promise<void>}
     */
    createFile(
        directoryPath: string,
        fileHash: SHA256Hash<BLOB>,
        fileName: string,
        fileMode: number
    ): Promise<void>;

    /**
     * Reads a directory.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the directory does not exist
     * - {@link FS_ERRORS.FSE-EACCES-R} if the directory does not have read permission
     *
     * @param {string} dirPath - The directory path
     * @returns {Promise<FileSystemDirectory>} - The content of the directory
     */
    readDir(dirPath: string): Promise<FileSystemDirectory>;

    /**
     * Reads a file.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the file does not exist
     * - {@link FS_ERRORS.FSE-EACCES-R} if the file does not have read permission
     *
     * @param {string} filePath - The file path
     * @returns {Promise<FileSystemFile>} - The content of the file
     */
    readFile(filePath: string): Promise<FileSystemFile>;

    /**
     * Reads a link.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the file does not exist
     * - {@link FS_ERRORS.FSE-EACCES-R} if the file does not have read permission
     *
     * @param {string} filePath - The file path
     * @returns {Promise<FileSystemFile>} - The content of the file
     */
    readlink(filePath: string): Promise<FileSystemFile>;

    /**
     * Reads a file in chunks by a given len and position.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-CHUNK-R} if the platform does not support chunked reading. This is supported only on Node. This happen if the check for {@link Platform} is not nodejs.
     * - {@link FS_ERRORS.FSE-ENOENT} if the file does not exist
     * - {@link FS_ERRORS.FSE-EACCES-R} if the file does not have read permission
     *
     * @param {string} filePath - The file path
     * @param length
     * @param position
     * @returns {Promise<FileSystemFile>} - The content of the file
     */
    readFileInChunks(filePath: string, length: number, position: number): Promise<FileSystemFile>;

    /**
     * If file reading in chunks is supported on the current platform.
     * @param {string} path
     * @returns {boolean}
     */
    supportsChunkedReading(path?: string): boolean;

    /**
     * Stat a file.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the file does not exist
     *
     * @param path
     * @returns {Promise<FileSystemFile>} - The content of the file
     */
    stat(path: string): Promise<FileDescription>;

    /**
     * See if the file/directory can be opened
     * @param {string} path
     * @returns {Promise<void>}
     */
    // exists(path: string): Promise<boolean>;

    /**
     * Deletes a directory
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the dir does not exist
     * - {@link FS_ERRORS.FSE-EACCES-W} if the dir does not have write permission
     *
     * @param {string} pathName - the directory path
     * @returns {Promise<number>} Returns 0 for success
     */
    rmdir(pathName: string): Promise<number>;

    /**
     * Deletes a file or a symlink.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} if the file does not exist
     * - {@link FS_ERRORS.FSE-EACCES-W} if the file does not have write permission
     *
     * @param {string} pathName
     * @returns {Promise<number>} - Returns 0 for success
     */
    unlink(pathName: string): Promise<number>;

    /**
     * Creates a hardlink. Return 0 for success or an error code
     * @param {string} src
     * @param {string} dest
     * @todo options do we needed them now?
     * @returns {Promise<number>}
     */
    // link(src: string, dest: string): Promise<number>;

    /**
     * Creates a symlink.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} when the parent dir does not exist or the given mode is not a file type
     * - {@link FS_ERRORS.FSE-EXISTS} when the current path already exists
     * - {@link FS_ERRORS.FSE-EACCES-W} if the parent directory does not have write permission
     *
     * @param {string} src - The src path
     * @param {string} dest - The dest path
     * @returns {Promise<void>} - Returns 0 for success
     */
    symlink(src: string, dest: string): Promise<void>;

    /**
     * Rename file.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} when the parent dir does not exist or the given mode is not a file type
     * - {@link FS_ERRORS.FSE-EACCES-W} if the parent directory does not have write permission
     *
     * @param {string} src - The src path
     * @param {string} dest - The dest path
     * @returns {Promise<void>} - Returns 0 for success
     */
    rename(src: string, dest: string): Promise<number>;

    /**
     * Change the permissions.
     *
     * Can throw:
     * - {@link FS_ERRORS.FSE-ENOENT} when the parent dir does not exist or the given mode is not a file type
     * - {@link FS_ERRORS.FSE-EACCES-W} if the parent directory does not have write permission
     *
     * @param {string} pathName - The file path
     * @param {number} mode - The desired mode
     * @returns {Promise<number>} - Returns 0 for success
     */
    chmod(pathName: string, mode: number): Promise<number>;
}
