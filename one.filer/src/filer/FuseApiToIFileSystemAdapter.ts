/// <reference types="node" />

/* eslint-disable @typescript-eslint/ban-ts-comment */
/**
 * @author Sebastian Sandru <sebastian@refinio.com>
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 * @version 0.0.1
 */

import {join} from 'path';
import os from 'os';
import type {Stats as FuseStats} from '../fuse/native-fuse3.js';
import {Fuse} from '../fuse/native-fuse3.js';
import type {IFileSystem} from '@refinio/one.models/lib/fileSystems/IFileSystem';
import {OEvent} from '@refinio/one.models/lib/misc/OEvent';
import {isFunction} from '@refinio/one.core/lib/util/type-checks-basic';
import {FS_ERRORS} from '@refinio/one.models/lib/fileSystems/FileSystemErrors';
import {createError} from '@refinio/one.core/lib/errors';
import {handleError} from '../misc/fuseHelper';
import FuseTemporaryFilesManager from './FuseTemporaryFilesManager';

let fuseFd = 10;

/**
 * This class implements the fuse api and forward those calls to {@link IFileSystem}.
 */
export default class FuseApiToIFileSystemAdapter {
    private onFilePersisted = new OEvent<(state: {path: string}) => void>();

    private readonly constTimes = new Date();

    private readonly regularFileMode = 0o0100666;

    // 0o0040000 octal number for directory type concatenated with the desired mode private
    // readonly directoryMode = 0o0040000;

    /**
     * The file system class provided in the constructor. This class needs to implement
     * {@link IFileSystem}.
     * @private
     */
    private readonly fs: IFileSystem;

    private readonly logCalls: boolean;

    /**
     * This class adds needed functionality to the fs like saving a temporary file in data/tmp /
     * saving a blob in one from a temporary file.
     * @private
     */
    private readonly tmpFilesMgr: FuseTemporaryFilesManager;

    /**
     * The key is the file descriptor of the temporary file, the value contains the final file
     * name of the temporary file and the path.
     * @private
     */
    private readonly temporaryFileDescriptorToFileMap: Map<
        number,
        {fileName: string; path: string}
    > = new Map<number, {fileName: string; path: string}>();

    constructor(fs: IFileSystem, oneStoragePath: string, logCalls: boolean = false) {
        this.fs = fs;
        this.logCalls = logCalls;
        this.tmpFilesMgr = new FuseTemporaryFilesManager(oneStoragePath, fs);
    }

    public fuseInit(cb: (err: number) => void): void {
        cb(0);
    }

    public fuseError(cb: (err: number) => void): void {
        cb(0);
    }

    private getUid(): number {
        return typeof process.getuid === 'function' ? process.getuid() : 0;
    }

    private getGid(): number {
        return typeof process.getgid === 'function' ? process.getgid() : 0;
    }

    public fuseGetattr(path: string, cb: (err: number, stat?: FuseStats) => void): void {
        // see if the getAttr was called on a tmp file that it's in the process of writing
        const tmpFile = Array.from(this.temporaryFileDescriptorToFileMap.values()).find(
            description => description.path === path
        );

        // if the path points to that file...
        if (tmpFile) {
            try {
                // get the tmp file size
                const fileStat = this.tmpFilesMgr.statTemporaryFile(tmpFile.fileName);
                cb(0, {
                    mtime: this.constTimes,
                    atime: this.constTimes,
                    ctime: this.constTimes,
                    size: fileStat.size,
                    mode: fileStat.mode,
                    uid: this.getUid(),
                    gid: this.getGid()
                } as FuseStats);
            } catch (_e) {
                new Promise<FuseStats>((resolve, reject) => {
                    // we create a promise and wait for the event to happen (e.g. saving in one)
                    const handler = (state: {path: string}) => {
                        // if the path matches, resolve the promise
                        if (state.path === path) {
                            this.onFilePersisted.off(handler);
                            this.fs
                                .stat(path)
                                .then((res: {size: number; mode: number}) => {
                                    resolve({
                                        mtime: this.constTimes,
                                        atime: this.constTimes,
                                        ctime: this.constTimes,
                                        size: res.size,
                                        mode: res.mode,
                                        uid: this.getUid(),
                                        gid: this.getGid()
                                    } as FuseStats);
                                })
                                .catch((err: Error) => reject(err));
                        }
                    };
                    this.onFilePersisted.on(handler);
                    // don't let a floating promise, reject it if it doesn't arrive in 20 seconds
                    setTimeout(() => {
                        this.onFilePersisted.off(handler);
                        reject(createError('FSE-ENOENT', {
                            message: FS_ERRORS['FSE-ENOENT'].message,
                            path
                        }));
                    }, 20000);
                })
                    .then(res => cb(0, res))
                    .catch(err => cb(handleError(err, this.logCalls, 'getattr')));
            }
        } else {
            // if getAttr was called on a persisted file
            this.fs
                .stat(path)
                .then((res: {size: number; mode: number}) => {
                    cb(0, {
                        mtime: this.constTimes,
                        atime: this.constTimes,
                        ctime: this.constTimes,
                        size: res.size,
                        mode: res.mode,
                        uid: this.getUid(),
                        gid: this.getGid()
                    } as FuseStats);
                })
                .catch((err: Error) => cb(handleError(err, this.logCalls, 'getattr')));
        }
    }

    /**
     * Truncate only on the temporary files that are being written
     * @param _path
     * @param _fd
     * @param _size
     * @param cb
     */
    public fuseFtruncate(
        _path: string,
        _fd: number,
        _size: number,
        cb: (err: number) => void
    ): void {
        cb(0);
    }

    /**
     * Truncate only on the temporary files that are being written
     * @param _path
     * @param _size
     * @param cb
     */
    public fuseTruncate(_path: string, _size: number, cb: (err: number) => void): void {
        cb(0);
    }

    /**
     *
     * @param path
     * @param cb
     */
    public fuseReaddir(
        path: string,
        cb: (err: number, names?: string[], stats?: FuseStats[]) => void
    ): void {
        this.fs
            .readDir(path)
            .then((res: {children: string[]}) => cb(0, res.children))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    /**
     *
     * @param _path
     * @param _flags
     * @param cb
     */
    public fuseOpendir(
        _path: string,
        _flags: number,
        cb: (err: number, fd?: number) => void
    ): void {
        cb(0, fuseFd++);
    }

    /**
     *
     * @param _path
     * @param _flags
     * @param cb
     */
    public fuseOpen(_path: string, _flags: number, cb: (err: number, fd?: number) => void): void {
        cb(0, fuseFd++);
    }

    /**
     *
     * @param givenPath
     * @param _fd
     * @param buffer
     * @param length
     * @param position
     * @param cb
     */
    public fuseRead(
        givenPath: string,
        _fd: number,
        buffer: Buffer,
        length: number,
        position: number,
        cb: (err: number, bytesRead?: number) => void
    ): void {
        if (this.fs.supportsChunkedReading(givenPath)) {
            this.fs
                .readFileInChunks(givenPath, length, position)
                .then((res: {content: Buffer}) => {
                    const bufferR = Buffer.from(res.content);
                    bufferR.copy(buffer);
                    cb(0, bufferR.length);
                })
                .catch((err: Error) => cb(handleError(err, this.logCalls), 0));
        }
    }

    /**
     *
     * @param dirPath
     * @param _mode
     * @param cb
     */
    public fuseMkdir(dirPath: string, _mode: number, cb: (err: number) => void): void {
        this.fs
            .createDir(dirPath, 0o0040777)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    /**
     * Flush on temporary files
     * @param _path
     * @param fd
     * @param cb
     */
    public fuseFlush(_path: string, fd: number, cb: (err: number) => void): void {
        const fileName = this.temporaryFileDescriptorToFileMap.get(fd);

        if (fileName) {
            cb(0);
        } else {
            // TODO Why not use the given fd?
            cb(0);
        }
    }

    /**
     * Release is called when a temporary file has finished writing. The File Descriptor of that
     * file is passed as
     * a parameter in fuseRelease.
     *
     * From FUSE docs:
     *
     * For every open() call there will be exactly one release() call with the same flags and
     * file handle. It is possible to have a file opened more than once, in which case only the
     * last release will mean, that no more reads/writes will happen on the file. The return
     * value of release is ignored.
     *
     * @see {@link https://libfuse.github.io/doxygen/structfuse__operations.html#a4a6f1b50c583774125b5003811ecebce}
     * @param path
     * @param fd
     * @param cb
     */
    public fuseRelease(path: string, fd: number, cb: (err: number) => void): void {
        let fileDescription = this.temporaryFileDescriptorToFileMap.get(fd);

        // If the file was not found, also check the tmpFilesMgr cache for tmp files because this
        // particular file might be in the process of edit
        if (fileDescription === undefined) {
            try {
                const fileName = path.substring(path.lastIndexOf('/') + 1);
                this.tmpFilesMgr.retrieveTemporaryFilePath(fileName);
                fileDescription = {fileName: fileName, path: path};
            } catch (_e) {
                fileDescription = undefined;
            }
        }

        if (fileDescription) {
            const fileName = fileDescription.fileName;

            this.tmpFilesMgr
                .releaseTemporaryFile(join(path, '..'), fileDescription.fileName)
                .then(blobHash =>
                    this.fs.createFile(join(path, '..'), blobHash, fileName, this.regularFileMode)
                )
                .then(() => {
                    this.temporaryFileDescriptorToFileMap.delete(fd);
                    this.onFilePersisted.emit({path: path});
                    cb(0);
                })
                .catch(err => cb(handleError(err, this.logCalls)));
        } else {
            cb(Fuse.ENOENT);
        }
    }

    /**
     *
     * @param _path
     * @param _fd
     * @param cb
     */
    public fuseReleasedir(_path: string, _fd: number, cb: (err: number) => void): void {
        cb(0);
    }

    /** Delete file. */
    public fuseUnlink(path: string, cb: (err: number) => void): void {
        this.fs
            .unlink(path)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    /** Rename file. */
    public fuseRename(src: string, dest: string, cb: (err: number) => void): void {
        this.fs
            .rename(src, dest)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    /** Remove directory. */
    public fuseRmdir(path: string, cb: (err: number) => void): void {
        this.fs
            .rmdir(path)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    /** Change mode of file. */
    public fuseChmod(path: string, mode: number, cb: (err: number) => void): void {
        this.fs
            .chmod(path, mode)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    public fuseMknod(_path: string, _mode: number, _dev: number, cb: (err: number) => void): void {
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'mknod'));
    }

    public fuseSetxattr(
        _path: string,
        _name: string,
        _value: Buffer,
        _size: number,
        _flags: number,
        cb: (err: number) => void
    ): void {
        // If we want to store it, we need to store the value Buffer somewhere
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'setxattr'));
    }

    public fuseGetxattr(
        _path: string,
        _name: string,
        _size: number,
        cb: (err: number, xattr?: Buffer | null) => void
    ): void {
        cb(0, null);
    }

    public fuseListxattr(_path: string, cb: (err: number, list?: string[]) => void): void {
        // Empty list: We don't support any extended attributes, for this or any path
        cb(0, []);
    }

    public fuseRemovexattr(_path: string, _name: string, cb: (err: number) => void): void {
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'removexattr'));
    }

    /**
     *
     * @param givenPath
     * @param mode
     * @param cb
     */
    public fuseCreate(
        givenPath: string,
        mode: number,
        cb: (err: number, fd?: number, modePassedOn?: number) => void
    ): void {
        const fileName = givenPath.substring(givenPath.lastIndexOf('/') + 1);
        this.tmpFilesMgr
            .createTemporaryFile(fileName)
            .then(fd => {
                this.temporaryFileDescriptorToFileMap.set(fd, {
                    fileName: fileName,
                    path: givenPath
                });
                cb(0, fd, mode);
            })
            .catch(err => cb(handleError(err, this.logCalls)));
    }

    /**
     *
     * @param givenPath
     * @param _fd
     * @param buffer
     * @param length
     * @param position
     * @param cb
     */
    public fuseWrite(
        givenPath: string,
        _fd: number,
        buffer: Buffer,
        length: number,
        position: number,
        cb: (err: number, bytesWritten?: number) => void
    ): void {
        this.tmpFilesMgr
            .writeToTemporaryFile(givenPath, buffer, length, position)
            .then(bytesWritten => cb(0, bytesWritten))
            .catch(err => cb(handleError(err, this.logCalls), 0));
    }

    /**
     * fuseAccess is called to check rights for an inode.
     * @param _path
     * @param _mode
     * @param cb
     */
    public fuseAccess(_path: string, _mode: number, cb: (err: number) => void): void {
        cb(0);
    }

    public fuseStatfs(
        _path: string,
        cb: (
            err: number,
            stats?: {
                bsize: number;
                frsize: number;
                blocks: number;
                bfree: number;
                bavail: number;
                files: number;
                ffree: number;
                favail: number;
                fsid: number;
                flag: number;
                namemax: number;
            }
        ) => void
    ): void {
        cb(0, {
            bsize: 1000000,
            frsize: 1000000,
            blocks: 1000000,
            bfree: 1000000,
            bavail: 1000000,
            files: 1000000,
            ffree: 1000000,
            favail: 1000000,
            fsid: 1000000,
            flag: 1000000,
            namemax: 1000000
        });
    }

    public fuseFgetattr(
        _path: string,
        _fd: number,
        cb: (err: number, stat?: FuseStats) => void
    ): void {
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'fgetattr'));
    }

    /**
     * fuseChown is called to change the owner of an inode.
     * @param _path
     * @param _uid
     * @param _gid
     * @param cb
     */
    public fuseChown(_path: string, _uid: number, _gid: number, cb: (err: number) => void): void {
        cb(0);
    }

    /**
     * Update the last access time of the given object.
     * @param _path
     * @param _atime
     * @param _mtime
     * @param cb
     */
    public fuseUtimens(_path: string, _atime: Date, _mtime: Date, cb: (err: number) => void): void {
        cb(0);
    }

    public fuseLink(_src: string, _dest: string, cb: (err: number) => void): void {
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'link'));
    }

    public fuseSymlink(src: string, dest: string, cb: (err: number) => void): void {
        this.fs
            .symlink(src, dest)
            .then((_: void) => cb(0))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    public fuseReadlink(path: string, cb: (err: number, linkName?: string) => void): void {
        this.fs
            .readlink(path)
            .then((res: {content: Buffer}) => cb(0, Buffer.from(res.content).toString()))
            .catch((err: Error) => cb(handleError(err, this.logCalls)));
    }

    public fuseFsync(
        _path: string,
        _datasync: boolean,
        _fd: number,
        cb: (err: number) => void
    ): void {
        cb(0);
    }

    public fuseFsyncdir(
        _path: string,
        _datasync: boolean,
        _fd: number,
        cb: (err: number) => void
    ): void {
        cb(handleError(createError('FSE-ENOSYS', {
            message: FS_ERRORS['FSE-ENOSYS'].message
        }), this.logCalls, 'fsyncdir'));
    }
}
