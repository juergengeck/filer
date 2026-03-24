/**
 * FUSE Wrapper for WSL2 Debian Integration  
 * 
 * This module wraps the real fuse-native package and provides proper integration
 * with our existing FuseApiToIFileSystemAdapter to create a true virtual filesystem.
 * 
 * @author ONE.filer Team
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 */

import { EventEmitter } from 'events';

// Re-export fuse-native's error codes and types
const realFuse = require('fuse-native');

export const EPERM = realFuse.EPERM;
export const ENOENT = realFuse.ENOENT;
export const EIO = realFuse.EIO;
export const EACCES = realFuse.EACCES;
export const EEXIST = realFuse.EEXIST;
export const ENOTDIR = realFuse.ENOTDIR;
export const EISDIR = realFuse.EISDIR;
export const EINVAL = realFuse.EINVAL;
export const ENOSPC = realFuse.ENOSPC;
export const EROFS = realFuse.EROFS;
export const EBUSY = realFuse.EBUSY;
export const ENOTEMPTY = realFuse.ENOTEMPTY;

export interface Stats {
    mtime: Date;
    atime: Date;
    ctime: Date;
    size: number;
    mode: number;
    uid: number;
    gid: number;
    nlink?: number;
}

export interface FuseError extends Error {
    code: string;
    path?: string;
}

export interface FuseOperations {
    init?: (cb: (err: number) => void) => void;
    error?: (err: Error) => void;
    access?: (path: string, mode: number, cb: (err: number) => void) => void;
    statfs?: (path: string, cb: (err: number, stat?: any) => void) => void;
    getattr?: (path: string, cb: (err: number, stat?: Stats) => void) => void;
    fgetattr?: (path: string, fd: number, cb: (err: number, stat?: Stats) => void) => void;
    flush?: (path: string, fd: number, cb: (err: number) => void) => void;
    fsync?: (path: string, datasync: boolean, fd: number, cb: (err: number) => void) => void;
    fsyncdir?: (path: string, datasync: boolean, fd: number, cb: (err: number) => void) => void;
    readdir?: (path: string, cb: (err: number, files?: string[], stats?: Stats[]) => void) => void;
    truncate?: (path: string, size: number, cb: (err: number) => void) => void;
    ftruncate?: (path: string, fd: number, size: number, cb: (err: number) => void) => void;
    readlink?: (path: string, cb: (err: number, linkString?: string) => void) => void;
    chown?: (path: string, uid: number, gid: number, cb: (err: number) => void) => void;
    chmod?: (path: string, mode: number, cb: (err: number) => void) => void;
    mknod?: (path: string, mode: number, dev: number, cb: (err: number) => void) => void;
    setxattr?: (path: string, name: string, value: Buffer, size: number, flags: number, cb: (err: number) => void) => void;
    getxattr?: (path: string, name: string, cb: (err: number, value?: Buffer) => void) => void;
    listxattr?: (path: string, cb: (err: number, list?: string[]) => void) => void;
    removexattr?: (path: string, name: string, cb: (err: number) => void) => void;
    open?: (path: string, flags: number, cb: (err: number, fd?: number) => void) => void;
    opendir?: (path: string, flags: number, cb: (err: number, fd?: number) => void) => void;
    read?: (path: string, fd: number, buffer: Buffer, length: number, position: number, cb: (err: number, bytesRead?: number) => void) => void;
    write?: (path: string, fd: number, buffer: Buffer, length: number, position: number, cb: (err: number, bytesWritten?: number) => void) => void;
    release?: (path: string, fd: number, cb: (err: number) => void) => void;
    releasedir?: (path: string, fd: number, cb: (err: number) => void) => void;
    create?: (path: string, mode: number, cb: (err: number, fd?: number) => void) => void;
    utimens?: (path: string, atime: number, mtime: number, cb: (err: number) => void) => void;
    unlink?: (path: string, cb: (err: number) => void) => void;
    rename?: (src: string, dest: string, cb: (err: number) => void) => void;
    link?: (src: string, dest: string, cb: (err: number) => void) => void;
    symlink?: (src: string, dest: string, cb: (err: number) => void) => void;
    mkdir?: (path: string, mode: number, cb: (err: number) => void) => void;
    rmdir?: (path: string, cb: (err: number) => void) => void;
}

/**
 * FUSE wrapper that properly integrates with fuse-native
 */
export class Fuse extends EventEmitter {
    private realFuse: any;
    private mountPath: string;
    private operations: FuseOperations;
    private options: any;
    private mounted = false;

    // Static error codes (re-export from fuse-native)
    static EPERM = realFuse.EPERM;
    static ENOENT = realFuse.ENOENT;
    static EIO = realFuse.EIO;
    static EACCES = realFuse.EACCES;
    static EEXIST = realFuse.EEXIST;
    static ENOTDIR = realFuse.ENOTDIR;
    static EISDIR = realFuse.EISDIR;
    static EINVAL = realFuse.EINVAL;
    static ENOSPC = realFuse.ENOSPC;
    static EROFS = realFuse.EROFS;
    static EBUSY = realFuse.EBUSY;
    static ENOTEMPTY = realFuse.ENOTEMPTY;

    constructor(mountPath: string, operations: FuseOperations, options: any = {}) {
        super();
        this.mountPath = mountPath;
        this.operations = operations;
        this.options = options;

        // Create the real fuse-native instance
        this.realFuse = new realFuse(mountPath, operations, this.options);
    }

    mount(callback: (err?: Error | null) => void): void {
        console.log(`🔧 Mounting FUSE filesystem at ${this.mountPath} using fuse-native`);
        console.log(`📂 Available operations: ${Object.keys(this.operations).join(', ')}`);
        
        this.realFuse.mount((err?: Error) => {
            if (err) {
                console.error(`❌ FUSE mount failed:`, err);
                callback(err);
                return;
            }
            
            console.log(`✅ FUSE filesystem mounted successfully at ${this.mountPath}`);
            this.mounted = true;
            this.emit('mount');
            callback(null);
        });
    }

    unmount(callback: (err?: Error | null) => void): void {
        if (!this.mounted) {
            callback(new Error('Filesystem not mounted'));
            return;
        }

        console.log(`🔧 Unmounting FUSE filesystem at ${this.mountPath}`);
        
        this.realFuse.unmount((err?: Error) => {
            if (err) {
                console.error(`❌ FUSE unmount failed:`, err);
                callback(err);
            } else {
                console.log(`✅ FUSE filesystem unmounted from ${this.mountPath}`);
                this.mounted = false;
                this.emit('unmount');
                callback(null);
            }
        });
    }

    get mnt(): string {
        return this.mountPath;
    }

    static unmount(mountPath: string, callback: (err?: Error) => void): void {
        realFuse.unmount(mountPath, callback);
    }

    static isConfigured(callback: (err: Error | null, isConfigured: boolean) => void): void {
        // FUSE is available if we can require fuse-native successfully
        try {
            require('fuse-native');
            callback(null, true);
        } catch (err) {
            callback(err as Error, false);
        }
    }

    static configure(callback: (err?: Error) => void): void {
        // No configuration needed for fuse-native
        callback();
    }
}

export type OPERATIONS = Required<FuseOperations>; 