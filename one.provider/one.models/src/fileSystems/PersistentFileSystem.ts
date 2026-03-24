/**
 * @author Sebastian Sandru <sebastian@refinio.com>
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 * @version 0.0.1
 */

import {calculateHashOfObj} from '@refinio/one.core/lib/util/object.js';
import {serializeWithType} from '@refinio/one.core/lib/util/promise.js';
import type {
    FileDescription,
    FileSystemDirectory,
    FileSystemFile,
    IFileSystem
} from './IFileSystem.js';
import FileSystemHelpers from './FileSystemHelpers.js';
import {getInstanceIdHash} from '@refinio/one.core/lib/instance.js';
import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from './FileSystemErrors.js';
import {OEvent} from '../misc/OEvent.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB, OneObjectTypes} from '@refinio/one.core/lib/recipes.js';
import type {
    PersistentFileSystemChild,
    PersistentFileSystemDirectory,
    PersistentFileSystemDirectoryEntry,
    PersistentFileSystemFile,
    PersistentFileSystemRoot
} from '../recipes/PersistentFileSystemRecipes.js';
import {readBlobAsArrayBuffer, storeArrayBufferAsBlob} from '@refinio/one.core/lib/storage-blob.js';
import {
    getObject,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {fileSize} from '@refinio/one.core/lib/system/storage-base.js';
import fs from 'fs';
import path from 'path';
import { getArrayBuffer } from '@refinio/one.core/lib/util/buffer.js';

/**
 * This represents a FileSystem Structure that can create and open directories/files and persist them in one.
 * This class is using {@link PersistentFileSystemRoot}, {@link PersistentFileSystemDirectory} and {@link PersistentFileSystemFile} Recipes &
 * {@link FileSystemDirectory} and {@link FileSystemFile} types from {@link IFileSystem} interface in order
 * to accomplish this FileSystem structure.
 */
export default class PersistentFileSystem implements IFileSystem {
    public onFilePersisted = new OEvent<
        (data: {fileHash: SHA256Hash<BLOB>; fileName: string}) => void
    >();

    /**
     * @global the root of the file system
     * @type {PersistentFileSystemRoot["root"]}
     * @private
     */
    private rootDirectoryContent: PersistentFileSystemRoot['root'];

    private readonly storage: string | undefined;

    /**
     *
     * @param {SHA256Hash<PersistentFileSystemDirectory>} rootDirectory
     * @param storage
     */
    public constructor(rootDirectory: PersistentFileSystemRoot, storage?: string) {
        this.rootDirectoryContent = rootDirectory.root;
        this.storage = storage;
    }

    /**
     * @global
     * @type {((rootHash: SHA256Hash<PersistentFileSystemDirectory>) => void) | null}
     */
    public onRootUpdate:
        | null
        | ((rootHash: SHA256Hash<PersistentFileSystemDirectory>) => Promise<void>) = null;

    /**
     * Overwrites a file if the file already exist in the folder, otherwise, adds the file.
     * @param {string} directoryPath
     * @param {SHA256Hash<BLOB>} fileHash
     * @param {string} fileName
     * @param {number} fileMode
     * @returns {Promise<PersistentFileSystemDirectory>}
     */
    public async createFile(
        directoryPath: string,
        fileHash: SHA256Hash<BLOB>,
        fileName: string,
        fileMode = 0o0100666
    ): Promise<void> {
        const mode = FileSystemHelpers.retrieveFileMode(fileMode);
        if (!(mode.type === 'file' || mode.type === 'symlink')) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: directoryPath
            });
        }
        await serializeWithType('FileSystemCreateLock', async () => {
            /** the directory where you want to save the file **/
            const targetDirectory = await this.openPersistedDir(directoryPath);
            const directoryMode = await this.getDirectoryMode(
                FileSystemHelpers.getParentDirectoryFullPath(directoryPath),
                FileSystemHelpers.getLastItem(directoryPath)
            );
            const directoryParsedMode = FileSystemHelpers.retrieveFileMode(directoryMode);

            const doesFileExists = await this.openPersistedDir(
                FileSystemHelpers.pathJoin(directoryPath, fileName)
            );

            if (doesFileExists) {
                throw createError('FSE-EXISTS', {
                    message: FS_ERRORS['FSE-EXISTS'].message,
                    path: directoryPath
                });
            }

            if (!targetDirectory) {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: directoryPath
                });
            }

            if (!directoryParsedMode.permissions.owner.write) {
                throw createError('FSE-EACCES-W', {
                    message: FS_ERRORS['FSE-EACCES-W'].message,
                    path: directoryPath
                });
            }

            const savedFile = await storeUnversionedObject({
                $type$: 'PersistentFileSystemFile',
                content: fileHash
            });

            const foundIndex = targetDirectory.children.findIndex(
                (child: PersistentFileSystemChild) => child.path === `/${fileName}`
            );

            if (foundIndex >= 0) {
                targetDirectory.children.splice(foundIndex, 1);
            }

            /** set the new file **/
            targetDirectory.children.push({
                ...PersistentFileSystem.buildFileSystemDirectoryEntry(savedFile.hash, fileMode),
                path: `/${fileName}`
            });
            /** update the directory **/
            await storeUnversionedObject(targetDirectory);
            const updatedTargetDirectoryHash = await calculateHashOfObj(targetDirectory);
            /** if the file is added on root, don't go recursive on the tree **/
            if (directoryPath === '/') {
                /** update the channel with the updated root directory **/
                if (this.onRootUpdate) {
                    await this.onRootUpdate(updatedTargetDirectoryHash);
                }
            } else {
                /** update the nodes above **/
                await this.updateFileSystemTree(
                    updatedTargetDirectoryHash,
                    FileSystemHelpers.getParentDirectoryFullPath(directoryPath),
                    directoryMode,
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(directoryPath))
                );
            }
            this.onFilePersisted.emit({fileHash: fileHash, fileName: fileName});
        });
    }

    /**
     * Checks if a file exists or not.
     * @param filePath
     */
    public async readFile(filePath: string): Promise<FileSystemFile> {
        const file = await this.findFile(filePath);
        const objFilePath = path.join(this.storage || process.cwd(), 'objects', file.content);

        const content = await fs.promises.readFile(objFilePath);
        return {
            content: getArrayBuffer(content)
        };
    }

    public supportsChunkedReading(_path?: string): boolean {
        return typeof global !== 'undefined' && {}.toString.call(global) === '[object global]';
    }

    /**
     *
     * @param {string} filePath
     * @param {number} length
     * @param {number} position
     * @returns {Promise<FileSystemFile>}
     */
    public async readFileInChunks(
        filePath: string,
        length: number,
        position: number
    ): Promise<FileSystemFile> {
        const file = await this.findFile(filePath);
        const objFilePath = path.join(this.storage || process.cwd(), 'objects', file.content);

        const fd = fs.openSync(objFilePath, 'r');
        const content = await new Promise<Buffer>((resolve, reject) => {
            fs.read(fd, Buffer.alloc(length), 0, length, position, (err: NodeJS.ErrnoException | null, _bytesRead: number, buffer: Buffer) => {
                if (err) {
                    return reject(new Error('Error: could not read from file.'));
                }
                resolve(buffer);
            });
        });
        return {
            content: getArrayBuffer(content)
        };
    }

    /**
     * @param directoryPath
     * @param dirMode
     */
    public async createDir(directoryPath: string, dirMode = 0o0040777): Promise<void> {
        const parentDirectoryPath = FileSystemHelpers.getParentDirectoryFullPath(directoryPath);
        const dirName = FileSystemHelpers.getLastItem(directoryPath);
        const mode = FileSystemHelpers.retrieveFileMode(dirMode);
        if (mode.type !== 'dir') {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: directoryPath
            });
        }

        await serializeWithType('FileSystemCreateLock', async () => {
            const pathExists = await this.openPersistedDir(directoryPath);

            const targetDirectory = await this.openPersistedDir(parentDirectoryPath);

            const directoryMode = FileSystemHelpers.retrieveFileMode(
                await this.getDirectoryMode(
                    FileSystemHelpers.getParentDirectoryFullPath(parentDirectoryPath),
                    FileSystemHelpers.getLastItem(parentDirectoryPath)
                )
            );

            if (pathExists) {
                throw createError('FSE-EXISTS', {
                    message: FS_ERRORS['FSE-EXISTS'].message,
                    path: directoryPath
                });
            }

            if (!targetDirectory) {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: directoryPath
                });
            }

            if (!directoryMode.permissions.owner.write) {
                throw createError('FSE-EACCES-W', {
                    message: FS_ERRORS['FSE-EACCES-W'].message,
                    path: directoryPath
                });
            }

            const newDirectory = await storeUnversionedObject({
                $type$: 'PersistentFileSystemDirectory',
                children: []
            });

            const newDirectoryHash = await calculateHashOfObj(newDirectory.obj);
            /** Intentionally the same hash because this directory was created now **/
            await this.updateFileSystemTree(
                newDirectoryHash,
                parentDirectoryPath,
                dirMode,
                FileSystemHelpers.pathJoin('/', dirName)
            );
        });
    }

    /**
     *
     * @param {string} path
     * @returns {Promise<PersistentFileSystemDirectory | undefined>}
     */
    public async readDir(path: string): Promise<FileSystemDirectory> {
        const foundDirectoryEntry = await this.search(path);
        const directoryMode = FileSystemHelpers.retrieveFileMode(
            await this.getDirectoryMode(
                FileSystemHelpers.getParentDirectoryFullPath(path),
                FileSystemHelpers.getLastItem(path)
            )
        );

        if (!foundDirectoryEntry) {
            throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: path});
        }
        const foundDirectoryEntryValue = await getObject(foundDirectoryEntry.content);
        if (!PersistentFileSystem.isDir(foundDirectoryEntryValue)) {
            throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: path});
        }
        if (!directoryMode.permissions.owner.read) {
            throw createError('FSE-EACCES-R', {
                message: FS_ERRORS['FSE-EACCES-R'].message,
                path: path
            });
        }

        return await PersistentFileSystem.transformPersistedDirectoryToFileSystemDirectory(
            foundDirectoryEntryValue
        );
    }

    public async chmod(pathName: string, mode: number): Promise<number> {
        const foundDirectoryEntry = await this.search(pathName);
        const parentPath = FileSystemHelpers.getParentDirectoryFullPath(pathName);
        const parent = await this.search(parentPath);
        /* If the parent or the current could not be found */
        if (!foundDirectoryEntry || !parent) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: parentPath
            });
        }

        /* Get parent content */
        const parentContent = await getObject(parent.content);

        const pathCurrentMode = FileSystemHelpers.retrieveFileMode(parent.mode);
        if (!pathCurrentMode.permissions.owner.write) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: parentPath
            });
        }

        /* If the parent is a {@link PersistentFileSystemDirectory} */
        if (PersistentFileSystem.isDir(parentContent)) {
            const desiredTarget = parentContent.children.find(
                (child: PersistentFileSystemChild) =>
                    child.path ===
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(pathName))
            );

            if (desiredTarget === undefined) {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: parentPath
                });
            }

            desiredTarget.mode = mode;

            const newDirectory = await storeUnversionedObject(parentContent);

            if (parentPath === '/') {
                /* update the channel with the updated root directory */
                if (this.onRootUpdate) {
                    await this.onRootUpdate(newDirectory.hash);
                }
            } else {
                /* Update the File System Tree */
                await this.updateFileSystemTree(
                    await calculateHashOfObj(parentContent),
                    FileSystemHelpers.getParentDirectoryFullPath(parentPath),
                    0o0040777,
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(parentPath))
                );
            }
            return 0;
        }

        throw createError('FSE-ENOENT', {
            message: FS_ERRORS['FSE-ENOENT'].message,
            path: parentPath
        });
    }

    public async rename(src: string, dest: string): Promise<number> {
        const foundDirectoryEntry = await this.search(src);

        const srcParentPath = FileSystemHelpers.getParentDirectoryFullPath(src);
        const destParentPath = FileSystemHelpers.getParentDirectoryFullPath(dest);

        const srcParent = await this.search(srcParentPath);
        const destParent = await this.search(destParentPath);

        /** If the parent or the current could not be found **/
        if (!foundDirectoryEntry || !srcParent || !destParent) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                srcPath: srcParentPath,
                destPath: destParentPath
            });
        }

        /** Get parent content **/
        const srcParentContent = await getObject(srcParent.content);
        const destParentContent = await getObject(destParent.content);

        const pathCurrentMode = FileSystemHelpers.retrieveFileMode(foundDirectoryEntry.mode);
        const destCurrentMode = FileSystemHelpers.retrieveFileMode(destParent.mode);

        /** Check if the file and the dest folder has write rights **/
        if (!pathCurrentMode.permissions.owner.write || !destCurrentMode.permissions.owner.write) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                srcPath: srcParentPath,
                destPath: destParentPath
            });
        }
        /** If the parent is a {@link PersistentFileSystemDirectory} **/
        if (
            PersistentFileSystem.isDir(srcParentContent) &&
            PersistentFileSystem.isDir(destParentContent)
        ) {
            /** If the paths are different folders, operate on both of them **/
            if (srcParentPath !== destParentPath) {
                /** delete the file from the src **/
                const foundIndex = srcParentContent.children.findIndex(
                    (child: PersistentFileSystemChild) =>
                        child.path ===
                        FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(src))
                );
                srcParentContent.children.splice(foundIndex, 1);
                /** added it to the dest path **/
                destParentContent.children.push({
                    ...foundDirectoryEntry,
                    path: FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(dest))
                });

                /** save updated directories **/
                const srcNewDirectory = await storeUnversionedObject(srcParentContent);
                const destNewDirectory = await storeUnversionedObject(destParentContent);

                /** if the src is root **/
                if (srcParentPath === '/') {
                    if (this.onRootUpdate) {
                        await this.onRootUpdate(srcNewDirectory.hash);
                    }
                }

                /** if the dest is root **/
                if (destParentPath === '/') {
                    if (this.onRootUpdate) {
                        await this.onRootUpdate(destNewDirectory.hash);
                    }
                }

                /** update the system tree if src is not root **/
                if (srcParentPath !== '/') {
                    await this.updateFileSystemTree(
                        srcNewDirectory.hash,
                        FileSystemHelpers.getParentDirectoryFullPath(srcParentPath),
                        0o0040777,
                        FileSystemHelpers.pathJoin(
                            '/',
                            FileSystemHelpers.getLastItem(srcParentPath)
                        )
                    );
                }
                /** update the system tree if dest is not root **/
                if (destParentPath !== '/') {
                    await this.updateFileSystemTree(
                        destNewDirectory.hash,
                        FileSystemHelpers.getParentDirectoryFullPath(destParentPath),
                        0o0040777,
                        FileSystemHelpers.pathJoin(
                            '/',
                            FileSystemHelpers.getLastItem(destParentPath)
                        )
                    );
                }
            } else {
                /** If src and path are EQUAL, operate only on one directory because they are the same **/
                /** Delete the given node from his content **/
                const foundIndex = srcParentContent.children.findIndex(
                    (child: PersistentFileSystemChild) =>
                        child.path ===
                        FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(src))
                );
                srcParentContent.children.splice(foundIndex, 1);
                srcParentContent.children.push({
                    ...foundDirectoryEntry,
                    path: FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(dest))
                });

                const newDirectory = await storeUnversionedObject(srcParentContent);
                /** Update the File System Tree **/
                if (srcParentPath === '/') {
                    /** update the channel with the updated root directory **/
                    if (this.onRootUpdate) {
                        await this.onRootUpdate(newDirectory.hash);
                    }
                } else {
                    await this.updateFileSystemTree(
                        newDirectory.hash,
                        FileSystemHelpers.getParentDirectoryFullPath(srcParentPath),
                        0o0040777,
                        FileSystemHelpers.pathJoin(
                            '/',
                            FileSystemHelpers.getLastItem(srcParentPath)
                        )
                    );
                }
            }

            return 0;
        }

        throw createError('FSE-ENOENT', {
            message: FS_ERRORS['FSE-ENOENT'].message,
            srcPath: srcParentPath,
            destPath: destParentPath
        });
    }

    /**
     * Removes the directory
     * @param pathName
     */
    public async rmdir(pathName: string): Promise<number> {
        const foundDirectoryEntry = await this.search(pathName);
        const parentPath = FileSystemHelpers.getParentDirectoryFullPath(pathName);
        const parent = await this.search(parentPath);

        /** If the parent or the current could not be found **/
        if (!foundDirectoryEntry || !parent) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: pathName
            });
        }

        /** If the given path is not a directory **/
        if (foundDirectoryEntry.content) {
            const dirContent = await getObject(foundDirectoryEntry.content);
            if (!PersistentFileSystem.isDir(dirContent)) {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: pathName
                });
            }
        }

        /** Get parent content **/
        const parentContent = await getObject(parent.content);

        const pathCurrentMode = FileSystemHelpers.retrieveFileMode(parent.mode);
        if (!pathCurrentMode.permissions.owner.write) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: parentPath
            });
        }

        /** If the parent is a {@link PersistentFileSystemDirectory} **/
        if (PersistentFileSystem.isDir(parentContent)) {
            /** Delete the given node from his content **/
            const foundIndex = parentContent.children.findIndex(
                (child: PersistentFileSystemChild) =>
                    child.path ===
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(pathName))
            );
            parentContent.children.splice(foundIndex, 1);

            const newDirectory = await storeUnversionedObject(parentContent);
            /** Update the File System Tree **/
            if (parentPath === '/') {
                /** update the channel with the updated root directory **/
                if (this.onRootUpdate) {
                    await this.onRootUpdate(newDirectory.hash);
                }
            } else {
                await this.updateFileSystemTree(
                    newDirectory.hash,
                    FileSystemHelpers.getParentDirectoryFullPath(parentPath),
                    0o0040777,
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(parentPath))
                );
            }
            return 0;
        }

        throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: pathName});
    }

    public async unlink(pathName: string): Promise<number> {
        const foundFile = await this.search(pathName);

        const parentPath = FileSystemHelpers.getParentDirectoryFullPath(pathName);
        const parent = await this.search(parentPath);

        /** If the parent or the current could not be found **/
        if (!foundFile || !parent) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: pathName
            });
        }

        /** If the given path is not a directory **/
        if (foundFile.content) {
            const dirContent = await getObject(foundFile.content);
            if (!PersistentFileSystem.isFile(dirContent)) {
                throw createError('FSE-ENOENT', {
                    message: FS_ERRORS['FSE-ENOENT'].message,
                    path: pathName
                });
            }
        }

        /** Get parent content **/
        const parentContent = await getObject(parent.content);

        const pathCurrentMode = FileSystemHelpers.retrieveFileMode(parent.mode);
        if (!pathCurrentMode.permissions.owner.write) {
            throw createError('FSE-EACCES-W', {
                message: FS_ERRORS['FSE-EACCES-W'].message,
                path: pathName
            });
        }

        /** If the parent is a {@link PersistentFileSystemDirectory} **/
        if (PersistentFileSystem.isDir(parentContent)) {
            /** Delete the given node from his content **/
            const foundIndex = parentContent.children.findIndex(
                (child: PersistentFileSystemChild) =>
                    child.path ===
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(pathName))
            );
            parentContent.children.splice(foundIndex, 1);

            const newDirectory = await storeUnversionedObject(parentContent);
            if (parentPath === '/') {
                /** update the channel with the updated root directory **/
                if (this.onRootUpdate) {
                    await this.onRootUpdate(newDirectory.hash);
                }
            } else {
                /** Update the File System Tree **/
                await this.updateFileSystemTree(
                    newDirectory.hash,
                    FileSystemHelpers.getParentDirectoryFullPath(parentPath),
                    0o0040777,
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(parentPath))
                );
            }
            return 0;
        }

        throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: pathName});
    }
    /**
     *
     * @param {string} path
     * @returns {Promise<FileDescription>}
     */
    public async stat(path: string): Promise<FileDescription> {
        const foundFile = await this.search(path);
        if (!foundFile) {
            throw createError('FSE-ENOENT', {message: FS_ERRORS['FSE-ENOENT'].message, path: path});
        }
        const resolvedDirectoryEntry = await getObject(foundFile.content);
        if (PersistentFileSystem.isFile(resolvedDirectoryEntry)) {
            const objectSize = await fileSize(resolvedDirectoryEntry.content);
            return {mode: foundFile.mode, size: objectSize};
        }
        return {mode: foundFile.mode, size: 0};
    }

    /**
     *
     * @param {string} path
     * @returns {Promise<void>}
     */
    public async exists(path: string): Promise<boolean> {
        const foundFile = await this.search(path);
        return foundFile !== undefined;
    }

    /**
     * Creates a symlink. Return 0 for success or an error code
     *
     * @param {string} src
     * @param {string} dest
     * @returns {Promise<void>}
     */
    async symlink(src: string, dest: string): Promise<void> {
        const buf = Buffer.from(src, 'utf8');
        const view = new Uint8Array(buf);
        for (let i = 0; i < buf.length; ++i) {
            view[i] = buf[i];
        }

        const fileName = FileSystemHelpers.getLastItem(dest);

        const blobDescriptor = {
            $type$: 'BlobDescriptor',
            data: (await storeArrayBufferAsBlob(view)).hash,
            lastModified: Date.now(),
            name: fileName,
            size: view.byteLength,
            type: 'Plain text file'
        } as const;

        const fileDescriptor = await storeUnversionedObject(blobDescriptor);

        await this.createFile(
            FileSystemHelpers.getParentDirectoryFullPath(dest),
            fileDescriptor.obj.data,
            fileName,
            0o0120666
        );
    }

    /**
     * Reads a symlink. Return 0 for success or an error code and the pointed path
     *
     * @param {string} filePath
     * @returns {Promise<number>}
     */
    public async readlink(filePath: string): Promise<FileSystemFile> {
        const blobHash: SHA256Hash<BLOB> = (await this.findFile(filePath)).content;

        const fileContent = await readBlobAsArrayBuffer(blobHash);

        return {
            content: fileContent
        };
    }

    /**
     *
     * @param rootDirectory
     */
    public set updateRoot(rootDirectory: PersistentFileSystemRoot) {
        this.rootDirectoryContent = rootDirectory.root;
    }

    // ---------------------------------------- Private ----------------------------------------

    /**
     * Find the persisted file in the fs
     * @param {string} filePath
     * @returns {Promise<PersistentFileSystemFile>}
     * @private
     */
    private async findFile(filePath: string): Promise<PersistentFileSystemFile> {
        const directoryMode = FileSystemHelpers.retrieveFileMode(
            await this.getDirectoryMode(
                FileSystemHelpers.getParentDirectoryFullPath(filePath),
                FileSystemHelpers.getLastItem(filePath)
            )
        );

        const foundDirectoryEntry = await this.search(filePath);
        if (!foundDirectoryEntry) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: filePath
            });
        }
        const foundDirectoryEntryValue = await getObject(foundDirectoryEntry.content);

        if (!PersistentFileSystem.isFile(foundDirectoryEntryValue)) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: filePath
            });
        }

        if (!directoryMode.permissions.owner.read) {
            throw createError('FSE-EACCES-R', {
                message: FS_ERRORS['FSE-EACCES-R'].message,
                path: filePath
            });
        }
        return foundDirectoryEntryValue;
    }

    /**
     *
     * @param {PersistentFileSystemDirectory} dir
     * @returns {Promise<FileSystemDirectory>}
     * @private
     */
    private static async transformPersistedDirectoryToFileSystemDirectory(
        dir: PersistentFileSystemDirectory
    ): Promise<FileSystemDirectory> {
        return {
            children: dir.children.map((child: PersistentFileSystemChild) =>
                child.path.replace('/', '')
            )
        };
    }

    /**
     *
     * @param {string} path
     * @returns {Promise<PersistentFileSystemDirectory | undefined>}
     * @private
     */
    private async openPersistedDir(
        path: string
    ): Promise<PersistentFileSystemDirectory | undefined> {
        const foundDirectoryEntry = await this.search(path);
        if (!foundDirectoryEntry) {
            return undefined;
        }
        const foundDirectoryEntryValue = await getObject(foundDirectoryEntry.content);

        if (!PersistentFileSystem.isDir(foundDirectoryEntryValue)) {
            return undefined;
        }

        return foundDirectoryEntryValue;
    }

    /**
     *
     * @param {SHA256Hash<PersistentFileSystemDirectory | PersistentFileSystemFile>} content
     * @param {number} mode
     * @returns {PersistentFileSystemDirectoryEntry}
     * @private
     */
    private static buildFileSystemDirectoryEntry(
        content: SHA256Hash<PersistentFileSystemDirectory | PersistentFileSystemFile>,
        mode: number
    ): PersistentFileSystemDirectoryEntry {
        return {
            content,
            mode
        };
    }

    /**
     * Retrieves the directory mode.
     * @param {string} parentDirectoryPath
     * @param {string} directoryName
     * @returns {Promise<number>}
     * @private
     */
    private async getDirectoryMode(
        parentDirectoryPath: string,
        directoryName: string
    ): Promise<number> {
        if (parentDirectoryPath === '/') {
            return this.rootDirectoryContent.mode;
        }
        const parentDirectory = await this.openPersistedDir(parentDirectoryPath);

        if (!parentDirectory) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: parentDirectoryPath
            });
        }
        const child = parentDirectory.children.find(
            ch => ch.path === FileSystemHelpers.pathJoin('/', directoryName)
        );

        if (!child) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: FileSystemHelpers.pathJoin('/', directoryName)
            });
        }
        return child.mode;
    }

    /**
     * This will update the directory chain recursively starting from the directory you just updated.
     * @param {SHA256Hash<PersistentFileSystemDirectory>} updatedCurrentDirectoryHash
     * @param {string} updateToPath - this gets consumed with every recursive call
     * @param dirMode
     * @param {string} directorySimplePath - NOT the full path, e.g /dir1
     * @returns {Promise<void>}
     * @private
     */
    private async updateFileSystemTree(
        updatedCurrentDirectoryHash: SHA256Hash<PersistentFileSystemDirectory>,
        updateToPath: string,
        dirMode: number,
        directorySimplePath: string
    ): Promise<void> {
        /** get his parent directory **/
        const currentDirectoryParent = await this.openPersistedDir(updateToPath);
        /** check if the parent directory exists**/
        if (currentDirectoryParent) {
            const foundIndex = currentDirectoryParent.children.findIndex(
                (child: PersistentFileSystemChild) => child.path === directorySimplePath
            );

            if (foundIndex >= 0) {
                currentDirectoryParent.children.splice(foundIndex, 1);
            }

            /** locate the outdated current directory hash in the parent's children **/
            currentDirectoryParent.children.push({
                path: directorySimplePath,
                ...PersistentFileSystem.buildFileSystemDirectoryEntry(
                    updatedCurrentDirectoryHash,
                    dirMode
                )
            });
            /** save the parent **/
            await storeUnversionedObject(currentDirectoryParent);
            /** get the updated parent hash **/
            const updatedCurrentDirectoryParent = await calculateHashOfObj(currentDirectoryParent);
            const parentDirectoryPath = FileSystemHelpers.getParentDirectoryFullPath(updateToPath);

            /** if its not root **/
            if (updateToPath !== '/') {
                const directoryMode = await this.getDirectoryMode(
                    parentDirectoryPath,
                    FileSystemHelpers.getLastItem(updateToPath)
                );
                await this.updateFileSystemTree(
                    updatedCurrentDirectoryParent,
                    parentDirectoryPath,
                    directoryMode,
                    FileSystemHelpers.pathJoin('/', FileSystemHelpers.getLastItem(updateToPath))
                );
            } else if (this.onRootUpdate) {
                /** update the channel with the updated root directory **/
                await this.onRootUpdate(await calculateHashOfObj(currentDirectoryParent));
            }
        }
    }

    /**
     * @param {string} givenPath - this gets consumed from the start.
     * @param {SHA256Hash<PersistentFileSystemDirectory | PersistentFileSystemFile>} parentDirectoryHash
     * @returns {Promise<PersistentFileSystemDirectory | PersistentFileSystemFile | undefined>}
     * @private
     */
    private async search(
        givenPath: string,
        parentDirectoryHash: SHA256Hash<
            PersistentFileSystemDirectory | PersistentFileSystemFile
        > = this.rootDirectoryContent.entry
    ): Promise<PersistentFileSystemDirectoryEntry | undefined> {
        /** get the top level directory **/
        const parentDirectory = await getObject(parentDirectoryHash);

        if (givenPath === '/') {
            return {mode: this.rootDirectoryContent.mode, content: this.rootDirectoryContent.entry};
        }

        /** if the given path it's not the root but it's a final path, e.g '/dir1' **/
        if (givenPath !== '/' && PersistentFileSystem.hasFoldersAboveExceptRoot(givenPath)) {
            if (PersistentFileSystem.isDir(parentDirectory)) {
                const child = parentDirectory.children.find(ch => ch.path === givenPath);
                if (child) {
                    return child;
                }
            }
        }

        /** if it's not a final path to search for, get the first folder in path **/
        const desiredPathInRoot = PersistentFileSystem.getFirstFolderAfterFirstSlash(givenPath);

        /** if the top level entity is a directory. Note that if it's a file and it's not the final path, it's an error **/
        if (PersistentFileSystem.isDir(parentDirectory)) {
            /** get his child **/
            const foundDirectory = parentDirectory.children.find(
                (child: PersistentFileSystemChild) => child.path === `/${desiredPathInRoot}`
            );
            if (foundDirectory) {
                /** consume the path from the start **/
                const nextPath = givenPath.replace(`/${desiredPathInRoot}`, '');
                return await this.search(nextPath, foundDirectory.content);
            } else {
                return undefined;
            }
        }
        return undefined;
    }

    /**
     * @static
     * Checks if the path is a final path, e.g /dir1 will return true.
     * @param {string} path
     * @returns {boolean}
     * @private
     */
    private static hasFoldersAboveExceptRoot(path: string): boolean {
        return path.lastIndexOf('/') === 0;
    }

    /**
     * @static
     * @param {OneObjectTypes} oneObject
     * @returns {caughtObject is FileSystemDirectory}
     * @private
     */
    private static isDir(oneObject: OneObjectTypes): oneObject is PersistentFileSystemDirectory {
        return oneObject.$type$ === 'PersistentFileSystemDirectory';
    }

    /**
     * @static
     * @param {OneObjectTypes} oneObject
     * @returns {caughtObject is FileSystemFile}
     * @private
     */
    private static isFile(oneObject: OneObjectTypes): oneObject is PersistentFileSystemFile {
        return oneObject.$type$ === 'PersistentFileSystemFile';
    }

    /**
     * @static
     * Retrieves the very first entry after the first '/' (root) -> e.g '/dir1/dir2/dir3' will return dir1.
     * @param {string} path
     * @returns {string}
     * @private
     */
    private static getFirstFolderAfterFirstSlash(path: string): string {
        const splitedPath: string[] = path.split('/');
        if (splitedPath[0] === '') {
            return splitedPath.splice(1, splitedPath.length)[0];
        } else {
            return splitedPath[0];
        }
    }
}
