/// <reference types="node" />

/**
 * @author Sebastian Sandru <sebastian@refinio.com>
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 * @version 0.0.1
 */

import {createError} from '@refinio/one.core/lib/errors';
import * as path from 'path';
import type {Stats} from 'fs';
import * as fs from 'fs';
import {stat, rename, unlink} from 'fs/promises';
import {getInstanceIdHash} from '@refinio/one.core/lib/instance';
import {createHash} from 'crypto';
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem';
import {FS_ERRORS} from '@refinio/one.models/lib/fileSystems/FileSystemErrors';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks';
import type {BLOB} from '@refinio/one.core/lib/recipes';
import type {FileCreationStatus} from '@refinio/one.core/lib/storage-base-common';
import {createTempFileName, CREATION_STATUS} from '@refinio/one.core/lib/storage-base-common';
import {handleError, logFuseError} from '../misc/fuseHelper';

type FileName = string;

/**
 * File system proxy that adds additional functionalities to be used in {@link FuseApiToIFileSystemAdapter}
 */
export default class FuseTemporaryFilesManager {
    private readonly oneStoragePath: string;

    /**
     * Operating System name
     */
    private readonly platform = process.platform;

    private readonly vfs: IFileSystem;

    /**
     * Maps the final file name to the temporary file name and his file descriptor
     * @private
     */
    private fileToTemporaryFileMap: Map<
        FileName,
        {temporaryFilePath: string; temporaryFileDescriptor: number}
    > = new Map<FileName, {temporaryFilePath: string; temporaryFileDescriptor: number}>();

    constructor(storageName: string = 'data', vfs: IFileSystem) {
        this.oneStoragePath = path.join(storageName);
        this.vfs = vfs;
    }

    /**
     * Retrieves the path for the specific one folder
     * @param storage
     * @param folder
     */
    private static getOnePath(storage: string, folder: 'objects' | 'tmp'): string {
        const instanceIdHash = getInstanceIdHash();

        if (instanceIdHash === undefined) {
            throw createError('FSE-EINVAL', {
                message: FS_ERRORS['FSE-EINVAL'].message,
                details: 'Instance ID hash is not set'
            });
        }

        return path.resolve(process.cwd(), storage) + path.sep + instanceIdHash + path.sep + folder;
    }

    /**
     * Get stats for a temporary file
     * @param fileName
     */
    public statTemporaryFile(fileName: string): Stats {
        const tmpFilePath = this.retrieveTemporaryFilePath(fileName);

        try {
            return fs.statSync(tmpFilePath);
        } catch (err) {
            logFuseError(err as Error, 'statTemporaryFile');
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: fileName
            });
        }
    }

    /**
     * Saves the content of the temporary file created in tmp one folder as Blob
     * @param _directoryPath
     * @param fileName
     */
    public async releaseTemporaryFile(
        _directoryPath: string,
        fileName: string
    ): Promise<SHA256Hash<BLOB>> {
        this.throwErrorForMacOSHiddenFiles(fileName);

        const readStream = fs.createReadStream(this.retrieveTemporaryFilePath(fileName));

        return new Promise((resolve, reject) => {
            const cryptoHashObj = createHash('sha256');

            readStream.once('error', err => {
                logFuseError(err, 'releaseTemporaryFile');
                reject(
                    createError('FSE-ENOENT', {
                        message: FS_ERRORS['FSE-ENOENT'].message,
                        path: fileName
                    })
                );
            });

            readStream.on('readable', () => {
                let chunk;

                while (null !== (chunk = readStream.read() as Buffer)) {
                    cryptoHashObj.update(chunk);
                }
            });

            readStream.once('end', () => {
                const hash = cryptoHashObj.digest('hex') as SHA256Hash<BLOB>;
                this.persistTemporaryFileAsBlob(fileName, hash)
                    .then(_ => resolve(hash))
                    .catch(err => {
                        logFuseError(err, 'releaseTemporaryFile');
                        reject(
                            createError('FSE-ENOENT', {
                                message: FS_ERRORS['FSE-ENOENT'].message,
                                path: fileName
                            })
                        );
                    });
            });
        });
    }

    /**
     * Writes to the temporary file created in one tmp folder
     * @param filepath
     * @param buffer
     * @param length
     * @param position
     */
    public async writeToTemporaryFile(
        filepath: string,
        buffer: Buffer,
        length: number,
        position: number
    ): Promise<number> {
        const fileName = filepath.substring(filepath.lastIndexOf('/') + 1);
        this.throwErrorForMacOSHiddenFiles(fileName);

        const temporaryFile = this.fileToTemporaryFileMap.get(fileName);

        if (temporaryFile) {
            return new Promise((resolve, reject) => {
                fs.write(
                    temporaryFile.temporaryFileDescriptor,
                    buffer,
                    0,
                    length,
                    position,
                    (err, written) => {
                        if (err) {
                            logFuseError(err, 'writeToTemporaryFile');
                            reject(
                                createError('FSE-EIO', {
                                    message: FS_ERRORS['FSE-EIO'].message,
                                    path: fileName
                                })
                            );
                        } else {
                            resolve(written);
                        }
                    }
                );
            });
        }

        throw createError('FSE-ENOENT', {
            message: FS_ERRORS['FSE-ENOENT'].message,
            path: fileName
        });
    }

    /**
     * This function copied behaviour of moveFromTempToObjectSpace from
     * one.core/system-nodejs/storage-streams.ts
     *
     * Low-level functions for file-access don't throw standard Javascript errors, they throw
     * node.js SYSTEM errors. Ref.: https://nodejs.org/api/errors.html#errors_system_errors
     * When calling node.js fs methods we use .catch() instead of try/catch because
     *
     * 1. Only the former manages to enable async. stack trace creation (a feature available in
     *    recent node.js/V8)
     * 2. We also need to throw a createError(err) to get the stack trace. The one we get from
     * node.js does not have it. Our createError() method always creates a createError.
     *
     * @param temporaryFileName
     * @param persistedFileName
     */
    private async persistTemporaryFileAsBlob(
        temporaryFileName: string,
        persistedFileName: string
    ): Promise<FileCreationStatus> {
        const temporaryFile = this.fileToTemporaryFileMap.get(temporaryFileName);

        if (!temporaryFile) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: temporaryFileName
            });
        }

        const persistedFilePath = path.join(
            FuseTemporaryFilesManager.getOnePath(this.oneStoragePath, 'objects'),
            persistedFileName
        );

        return stat(persistedFilePath)
            .then(stats => {
                if (stats.size === 0) {
                    // The file exists but is empty. This is a remnant of a failed write.
                    // Delete it and try again.
                    return unlink(persistedFilePath)
                        .then(() =>
                            rename(temporaryFile.temporaryFilePath, persistedFilePath).then(() => {
                                return new Promise<'new'>((resolve, reject) =>
                                    fs.close(temporaryFile.temporaryFileDescriptor, closeErr => {
                                        if (closeErr) {
                                            logFuseError(closeErr, 'persistTemporaryFileAsBlob');
                                            reject(
                                                createError('SST-MV3', {
                                                    name: 'FileNotFoundError',
                                                    filename: temporaryFileName
                                                })
                                            );
                                        } else {
                                            this.fileToTemporaryFileMap.delete(temporaryFileName);
                                            resolve(CREATION_STATUS.NEW);
                                        }
                                    })
                                );
                            })
                        )
                        .catch(unlinkErr => {
                            if ((unlinkErr as NodeJS.ErrnoException).code === 'ENOENT') {
                                // The file we were supposed to rename no longer exists.
                                // While this is seemingly okay since the target already
                                // exists so that it seems we've got what we wanted the
                                // disappearance of the file is unexpected.
                                throw createError('SST-MV2', {
                                    name: 'FileNotFoundError',
                                    filename: temporaryFileName
                                });
                            }

                            throw createError('SST-MV6', unlinkErr);
                        });
                }

                // This is an "impossible" error, but you never know
                throw createError('SST-MV7', {
                    old: temporaryFile.temporaryFilePath,
                    new: persistedFilePath
                });
            })
            .catch((err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    // "No such file or directory" - perfect, go ahead and move the file to one
                    // objects space.
                    return rename(temporaryFile.temporaryFilePath, persistedFilePath)
                        .then(() => {
                            return new Promise<'new'>((resolve, reject) =>
                                fs.close(temporaryFile.temporaryFileDescriptor, closeErr => {
                                    if (closeErr) {
                                        logFuseError(closeErr, 'persistTemporaryFileAsBlob');
                                        reject(
                                            createError('SST-MV3', {
                                                name: 'FileNotFoundError',
                                                filename: temporaryFileName
                                            })
                                        );
                                    } else {
                                        this.fileToTemporaryFileMap.delete(temporaryFileName);
                                        resolve(CREATION_STATUS.NEW);
                                    }
                                })
                            );
                        })
                        .catch((renameErr: NodeJS.ErrnoException) => {
                            if (renameErr.code === 'ENOENT') {
                                throw createError('SST-MV3', {
                                    name: 'FileNotFoundError',
                                    filename: temporaryFileName
                                });
                            }

                            throw createError('SST-MV4', renameErr);
                        });
                }

                throw createError('SST-MV5', err);
            });
    }

    /**
     * Throws an error for hidden files on macOS
     */
    private throwErrorForMacOSHiddenFiles(fileName: string): void {
        if (this.platform === 'darwin' && fileName.startsWith('.')) {
            logFuseError(
                createError('FSE-MACH', {
                    message: FS_ERRORS['FSE-MACH'].message,
                    path: fileName
                }),
                'throwErrorForMacOSHiddenFiles'
            );
            throw createError('FSE-MACH', {
                message: FS_ERRORS['FSE-MACH'].message,
                path: fileName
            });
        }
    }

    /**
     * Retrieves the path for a temporary file
     * @param fileName
     */
    public retrieveTemporaryFilePath(fileName: string): string {
        this.throwErrorForMacOSHiddenFiles(fileName);

        const existingFile = this.fileToTemporaryFileMap.get(fileName);

        if (!existingFile) {
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: fileName
            });
        }

        return existingFile.temporaryFilePath;
    }

    /**
     * Creates a temporary file in one tmp folder with a random name
     * @param fileName
     */
    public async createTemporaryFile(fileName: string): Promise<number> {
        this.throwErrorForMacOSHiddenFiles(fileName);

        const tmpFilePath = path.join(
            FuseTemporaryFilesManager.getOnePath(this.oneStoragePath, 'tmp'),
            createTempFileName()
        );

        try {
            const fd = fs.openSync(tmpFilePath, 'a');

            this.fileToTemporaryFileMap.set(fileName, {
                temporaryFilePath: tmpFilePath,
                temporaryFileDescriptor: fd
            });

            return fd;
        } catch (err) {
            logFuseError(err as Error, 'createTemporaryFile');
            throw createError('FSE-ENOENT', {
                message: FS_ERRORS['FSE-ENOENT'].message,
                path: fileName
            });
        }
    }
}
