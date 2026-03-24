/**
 * JavaScript interface for FUSE3 N-API addon
 */

console.log('[index.js] MODULE LOADING');

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load the compiled addon
let fuse3_napi;
try {
    // Prioritize absolute paths (work from node_modules), then try relative paths
    const possiblePaths = [
        path.join(__dirname, 'build/Release/fuse3_napi.node'),
        path.join(__dirname, 'build/Debug/fuse3_napi.node'),
        './build/Release/fuse3_napi.node',
        './build/Debug/fuse3_napi.node',
        '../build/Release/fuse3_napi.node',
        '../build/Debug/fuse3_napi.node'
    ];

    for (const addonPath of possiblePaths) {
        try {
            fuse3_napi = require(addonPath);
            break;
        } catch (e) {
            // If it's not a "cannot find module" error, this is a real loading issue
            if (e.code !== 'MODULE_NOT_FOUND') {
                throw e;
            }
        }
    }

    if (!fuse3_napi) {
        throw new Error('Could not find compiled FUSE3 N-API addon');
    }

    // Verify addon is valid
    if (!fuse3_napi.Fuse3 || typeof fuse3_napi.Fuse3 !== 'function') {
        throw new Error('FUSE3 N-API addon is invalid - missing Fuse3 constructor');
    }
} catch (err) {
    console.error('Failed to load FUSE3 N-API addon:', err.message);
    console.error('Make sure to run: npm run build');
    throw err;
}

// Export error constants
export const EPERM = fuse3_napi.EPERM;
export const ENOENT = fuse3_napi.ENOENT;
export const EIO = fuse3_napi.EIO;
export const EACCES = fuse3_napi.EACCES;
export const EEXIST = fuse3_napi.EEXIST;
export const ENOTDIR = fuse3_napi.ENOTDIR;
export const EISDIR = fuse3_napi.EISDIR;
export const EINVAL = fuse3_napi.EINVAL;
export const ENOSPC = fuse3_napi.ENOSPC;
export const EROFS = fuse3_napi.EROFS;
export const EBUSY = fuse3_napi.EBUSY;
export const ENOTEMPTY = fuse3_napi.ENOTEMPTY;

/**
 * FUSE3 class - JavaScript wrapper around N-API addon
 */
class Fuse extends EventEmitter {
    constructor(mountPath, operations, options = {}) {
        super();
        
        if (typeof mountPath !== 'string') {
            throw new TypeError('mountPath must be a string');
        }
        
        if (typeof operations !== 'object' || operations === null) {
            throw new TypeError('operations must be an object');
        }
        
        this.mountPath = path.resolve(mountPath);
        this.operations = operations;
        this.options = options;
        this.mounted = false;
        
        // Wrap operations to handle errors properly
        this._wrappedOps = this._wrapOperations(operations);

        console.log('[Fuse constructor] Wrapped operations:', Object.keys(this._wrappedOps));
        console.log('[Fuse constructor] wrapped.open type:', typeof this._wrappedOps.open);

        // Create native FUSE instance
        this._fuse = new fuse3_napi.Fuse3(this.mountPath, this._wrappedOps);
    }
    
    /**
     * Wrap user operations to handle errors and callbacks properly
     */
    _wrapOperations(ops) {
        const wrapped = {};
        
        // Helper to convert error codes
        const errnoToCode = (errno) => {
            if (errno === 0) return 0;
            if (errno > 0) return -errno;
            return errno;
        };
        
        // Wrap each operation
        // Helper to convert Date objects or numeric timestamps to Unix time
        const toUnixTime = (timeValue) => {
            if (!timeValue) {
                return Math.floor(Date.now() / 1000);
            } else if (typeof timeValue === 'number') {
                // Already a timestamp in milliseconds, convert to seconds
                return Math.floor(timeValue / 1000);
            } else if (timeValue instanceof Date) {
                // Date object, get time in milliseconds and convert to seconds
                return Math.floor(timeValue.getTime() / 1000);
            } else {
                // Default to current time
                return Math.floor(Date.now() / 1000);
            }
        };

        if (ops.getattr) {
            wrapped.getattr = (path, cb) => {
                try {
                    ops.getattr(path, (err, stats) => {
                        if (err) {
                            cb(errnoToCode(err.errno || err), null);
                        } else {
                            // Convert Date objects or numeric timestamps to Unix time
                            const stat = {
                                mode: stats.mode || 0,
                                uid: stats.uid || process.getuid(),
                                gid: stats.gid || process.getgid(),
                                size: stats.size || 0,
                                atime: toUnixTime(stats.atime),
                                mtime: toUnixTime(stats.mtime),
                                ctime: toUnixTime(stats.ctime)
                            };
                            cb(0, stat);
                        }
                    });
                } catch (e) {
                    cb(errnoToCode(e.errno || EIO));
                }
            };
        }

        if (ops.readdir) {
            wrapped.readdir = (path, cb) => {
                try {
                    ops.readdir(path, (err, files) => {
                        if (err) {
                            cb(errnoToCode(err.errno || err), []);
                        } else {
                            cb(0, files || []);
                        }
                    });
                } catch (e) {
                    cb(errnoToCode(e.errno || EIO), []);
                }
            };
        }

        if (ops.open) {
            wrapped.open = (path, flags, cb) => {
                console.log('[index.js wrapped.open] called with args:', {
                    path,
                    flags_type: typeof flags,
                    flags_value: flags,
                    cb_type: typeof cb,
                    num_args: arguments.length
                });
                console.trace('[index.js wrapped.open] Call stack:');
                try {
                    ops.open(path, flags, (err, fd) => {
                        console.log('[index.js wrapped.open] callback: err=', err, 'fd=', fd);
                        cb(errnoToCode(err ? (err.errno || err) : 0), fd || 0);
                    });
                } catch (e) {
                    console.log('[index.js wrapped.open] exception:', e);
                    cb(errnoToCode(e.errno || EIO), 0);
                }
            };
        }

        if (ops.read) {
            wrapped.read = (path, fd, buffer, length, offset, cb) => {
                try {
                    // User's read callback is Node.js style: (err, bytesRead)
                    // But C++ expects: (bytesRead, buffer) for success or (negativeError) for error
                    ops.read(path, fd, buffer, length, offset, (err, bytesRead) => {
                        if (err) {
                            // Error: pass negative error code
                            cb(errnoToCode(err.errno || err));
                        } else {
                            // Success: pass bytesRead and buffer
                            cb(bytesRead || 0, buffer);
                        }
                    });
                } catch (e) {
                    cb(errnoToCode(e.errno || EIO));
                }
            };
        }

        if (ops.write) {
            wrapped.write = (path, fd, buffer, length, offset, cb) => {
                try {
                    ops.write(path, fd, buffer, length, offset, (err, bytesWritten) => {
                        cb(errnoToCode(err ? (err.errno || err) : 0) || bytesWritten || 0);
                    });
                } catch (e) {
                    cb(errnoToCode(e.errno || EIO));
                }
            };
        }

        // Add more operation wrappers as needed
        const simpleOps = ['create', 'unlink', 'mkdir', 'rmdir', 'rename', 'chmod',
                          'chown', 'truncate', 'release', 'fsync', 'flush'];

        for (const op of simpleOps) {
            if (ops[op]) {
                wrapped[op] = (...args) => {
                    const cb = args[args.length - 1];
                    try {
                        ops[op](...args.slice(0, -1), (err) => {
                            cb(errnoToCode(err ? (err.errno || err) : 0));
                        });
                    } catch (e) {
                        cb(errnoToCode(e.errno || EIO));
                    }
                };
            }
        }
        
        return wrapped;
    }
    
    /**
     * Mount the filesystem
     */
    mount(callback) {
        if (this.mounted) {
            process.nextTick(callback, new Error('Already mounted'));
            return;
        }
        
        // Ensure mount point exists
        fs.mkdir(this.mountPath, { recursive: true }, (err) => {
            if (err && err.code !== 'EEXIST') {
                return callback(err);
            }
            
            // Mount using N-API addon
            this._fuse.mount((err) => {
                if (err) {
                    callback(new Error(err));
                } else {
                    this.mounted = true;
                    this.emit('mount');
                    callback(null);
                }
            });
        });
    }
    
    /**
     * Unmount the filesystem
     */
    unmount(callback) {
        if (!this.mounted) {
            process.nextTick(callback, new Error('Not mounted'));
            return;
        }
        
        this._fuse.unmount();
        this.mounted = false;
        this.emit('unmount');
        process.nextTick(callback, null);
    }
    
    /**
     * Get mount point
     */
    get mnt() {
        return this.mountPath;
    }
    
    /**
     * Check if mounted
     */
    isMounted() {
        return this._fuse.isMounted();
    }
    
    /**
     * Static unmount method
     */
    static unmount(mountPath, callback) {
        const { exec } = require('child_process');
        exec(`fusermount -u ${mountPath}`, (err) => {
            callback(err);
        });
    }
    
    /**
     * Check if FUSE is configured
     */
    static isConfigured(callback) {
        const { exec } = require('child_process');
        exec('which fusermount3 || which fusermount', (err) => {
            callback(null, !err);
        });
    }
    
    /**
     * Configure FUSE (no-op for Linux)
     */
    static configure(callback) {
        process.nextTick(callback, null);
    }
}

// Export the Fuse class and error constants
export { Fuse };
export default Fuse;