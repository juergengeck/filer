/**
 * IFSFuse3Provider - Bridges ONE.models IFileSystem to FUSE3
 *
 * This provider adapts the IFileSystem interface to FUSE3 operations,
 * providing the same interface as IFSProjFSProvider for cross-platform compatibility.
 */

import Fuse, { ENOENT, EIO } from './index.js';
import path from 'path';

class IFSFuse3Provider {
    constructor(options) {
        if (!options.fileSystem) {
            throw new Error('fileSystem is required');
        }
        if (!options.virtualRoot) {
            throw new Error('virtualRoot (mount point) is required');
        }

        this.fileSystem = options.fileSystem;
        this.virtualRoot = options.virtualRoot;
        this.debug = options.debug || false;
        this.fuse = null;
        this.running = false;

        this.log('IFSFuse3Provider created');
    }

    /**
     * Start the FUSE3 provider (mount filesystem)
     */
    async start(mountPoint) {
        if (this.running) {
            throw new Error('Already running');
        }

        console.log(`[IFSFuse3Provider] Starting FUSE3 mount at ${mountPoint || this.virtualRoot}`);
        const actualMountPoint = mountPoint || this.virtualRoot;

        // Create FUSE operations
        const operations = {
            getattr: this._getattr.bind(this),
            readdir: this._readdir.bind(this),
            open: this._open.bind(this),
            read: this._read.bind(this),
            release: this._release.bind(this)
        };

        // Create FUSE instance
        this.fuse = new Fuse(actualMountPoint, operations, {
            debug: this.debug,
            force: true,
            mkdir: true
        });

        // Mount the filesystem
        console.log('[IFSFuse3Provider] Calling fuse.mount()...');
        await new Promise((resolve, reject) => {
            this.fuse.mount((err) => {
                if (err) {
                    console.log('[IFSFuse3Provider] Mount failed:', err);
                    reject(err);
                } else {
                    this.running = true;
                    console.log('[IFSFuse3Provider] Mount successful!');
                    resolve();
                }
            });
        });
        console.log('[IFSFuse3Provider] Mount promise resolved');
    }

    /**
     * Stop the FUSE3 provider (unmount filesystem)
     */
    async stop() {
        if (!this.running || !this.fuse) {
            return;
        }

        this.log('Stopping FUSE3 mount');

        await new Promise((resolve) => {
            this.fuse.unmount((err) => {
                if (err) {
                    this.log('Unmount error (ignored):', err);
                }
                this.running = false;
                this.fuse = null;
                resolve();
            });
        });
    }

    /**
     * Check if provider is running
     */
    isRunning() {
        return this.running && this.fuse && this.fuse.isMounted();
    }

    /**
     * FUSE getattr operation - get file/directory attributes
     */
    _getattr(filePath, callback) {
        console.log('[JS] _getattr called:', filePath);
        this.log('getattr:', filePath);

        (async () => {
            try {
                console.log('[JS] _getattr: calling fileSystem.stat()');
                const stats = await this.fileSystem.stat(filePath);
                console.log('[JS] _getattr: stat returned:', stats);

                // IFileSystem returns mode directly (e.g., 0o40755 for directories)
                // Use the mode from IFileSystem as-is
                const fuseStats = {
                    mode: stats.mode,
                    uid: process.getuid ? process.getuid() : 1000,
                    gid: process.getgid ? process.getgid() : 1000,
                    size: stats.size || 0,
                    atime: stats.atime || new Date(),
                    mtime: stats.mtime || new Date(),
                    ctime: stats.ctime || new Date()
                };

                console.log('[JS] _getattr: calling callback with success');
                this.log('getattr success:', filePath, fuseStats);
                callback(null, fuseStats);
                console.log('[JS] _getattr: callback completed');
            } catch (error) {
                console.log('[JS] _getattr: error:', error.message);
                this.log('getattr error:', filePath, error.message);
                callback(ENOENT);
            }
        })();
        console.log('[JS] _getattr returned (async work pending)');
    }

    /**
     * FUSE readdir operation - list directory contents
     */
    _readdir(dirPath, callback) {
        this.log('readdir:', dirPath);

        (async () => {
            try {
                // IFileSystem uses readDir (not readDirectory) and returns { children: [...] }
                const result = await this.fileSystem.readDir(dirPath);
                const children = result.children || [];

                // Add . and .. entries
                const files = ['.', '..', ...children];

                this.log('readdir success:', dirPath, files.length, 'entries');
                callback(null, files);
            } catch (error) {
                this.log('readdir error:', dirPath, error.message);
                callback(ENOENT, []);
            }
        })();
    }

    /**
     * FUSE open operation - open a file
     */
    _open(filePath, flags, callback) {
        this.log('open:', filePath, 'flags:', flags);

        // Just return success - getattr already checked if file exists
        // IFileSystem doesn't have explicit open/close operations
        callback(null, 0);
    }

    /**
     * FUSE read operation - read file contents
     */
    _read(filePath, fd, buffer, length, offset, callback) {
        this.log('read:', filePath, 'length:', length, 'offset:', offset);

        (async () => {
            try {
                // IFileSystem readFile returns { content: ArrayBuffer }
                const result = await this.fileSystem.readFile(filePath);
                const data = Buffer.from(result.content);

                // Handle offset and length
                const start = offset;
                const end = Math.min(offset + length, data.length);
                const bytesToRead = Math.max(0, end - start);

                if (bytesToRead > 0) {
                    // Copy data to buffer
                    data.copy(buffer, 0, start, end);
                    this.log('read success:', filePath, bytesToRead, 'bytes');
                    // Node.js style: callback(err, bytesRead)
                    callback(null, bytesToRead);
                } else {
                    // EOF
                    this.log('read EOF:', filePath);
                    callback(null, 0);
                }
            } catch (error) {
                this.log('read error:', filePath, error.message);
                callback(EIO);
            }
        })();
    }

    /**
     * FUSE release operation - close a file
     */
    _release(filePath, fd, callback) {
        this.log('release:', filePath);
        // IFileSystem doesn't need explicit close
        callback(null);
    }

    /**
     * Debug logging
     */
    log(...args) {
        if (this.debug) {
            console.log('[IFSFuse3Provider]', ...args);
        }
    }
}

export { IFSFuse3Provider };
