/// <reference types="node" />

/**
 * @author Sebastian Sandru <sebastian@refinio.com>
 * @copyright REFINIO GmbH
 * @license SEE LICENSE IN LICENSE.md
 * @version 0.0.1
 */

import {
    FS_ERRORS,
    FS_INTERNAL_ERROR_CODE
} from '@refinio/one.models/lib/fileSystems/FileSystemErrors';
import {createError} from '@refinio/one.core/lib/errors';
import type {FuseError} from '../fuse/native-fuse3.js';
import { 
    Fuse, 
    EPERM, 
    ENOENT, 
    EIO, 
    EACCES, 
    EEXIST, 
    ENOTDIR, 
    EISDIR, 
    EINVAL, 
    ENOSPC, 
    EROFS, 
    EBUSY, 
    ENOTEMPTY 
} from '../fuse/native-fuse3.js';
import {COLOR} from '@refinio/one.core/lib/logger';

export function splitRoutePath(routePath: string): {
    prefix: string;
    rest: string;
} {
    // Assume a leading slash in this method
    const dirs = routePath.split('/');

    // calculate prefix
    let prefix = '';

    if (dirs.length > 1) {
        prefix = dirs[1];
    }

    // calculate rest
    let rest = '/';

    if (dirs.length > 2) {
        rest += dirs.slice(2).join('/');
    }

    return {
        prefix: prefix,
        rest: rest
    };
}

/**
 * Maps FUSE error codes to one.core filesystem error codes
 */
const FUSE_TO_FS_ERRORS = {
    [EPERM]: 'FSE-EPERM',     // Operation not permitted
    [ENOENT]: 'FSE-ENOENT',   // No such file or directory
    [EIO]: 'FSE-EIO',         // I/O error
    [EACCES]: 'FSE-EACCES',   // Permission denied
    [EEXIST]: 'FSE-EEXIST',   // File exists
    [ENOTDIR]: 'FSE-ENOTDIR', // Not a directory
    [EISDIR]: 'FSE-EISDIR',   // Is a directory
    [EINVAL]: 'FSE-EINVAL',   // Invalid argument
    [ENOSPC]: 'FSE-ENOSPC',   // No space left on device
    [EROFS]: 'FSE-EROFS',     // Read-only file system
    [EBUSY]: 'FSE-EBUSY',     // Device or resource busy
    [ENOTEMPTY]: 'FSE-ENOTEMPTY' // Directory not empty
} as const;

type FuseErrorCode = keyof typeof FUSE_TO_FS_ERRORS;
type FSErrorCode = keyof typeof FS_ERRORS;

/**
 * Maps a FUSE error code to a one.core filesystem error
 */
function mapFuseError(fuseCode: number, path?: string): Error {
    const fsErrorCode = FUSE_TO_FS_ERRORS[fuseCode as FuseErrorCode];
    if (fsErrorCode) {
        return createError(fsErrorCode, {
            message: FS_ERRORS[fsErrorCode].message,
            path
        });
    }
    return createError('FSE-UNK', {
        message: FS_ERRORS['FSE-UNK'].message,
        path
    });
}

/**
 * Enhanced error logging for FUSE operations
 */
export function logFuseError(
    error: Error & {code?: string; path?: string},
    operation: string,
    severity: 'warn' | 'error' = 'error'
): void {
    const color = severity === 'error' ? COLOR.FG_RED : COLOR.FG_YELLOW;
    console.log(
        `${color}[${severity.toUpperCase()}]:${COLOR.OFF}`,
        `Operation: ${operation}`,
        `Path: ${error.path || 'unknown'}`,
        `Error: ${error.message}`
    );
    if (error.stack) {
        console.log(error.stack);
    }
}

/**
 * Handles filesystem errors with enhanced logging and mapping
 * @param err - The error to handle
 * @param logCalls - Whether to log the error
 * @param operation - The operation that caused the error (for logging)
 */
export function handleError(
    err: Error & {code?: FSErrorCode; path?: string} | number,
    logCalls: boolean = false,
    operation: string = 'unknown'
): number {
    // Handle raw FUSE error codes
    if (typeof err === 'number') {
        const mappedError = mapFuseError(err);
        if (logCalls) {
            logFuseError(mappedError, operation);
        }
        return err;
    }

    if (logCalls) {
        logFuseError(err as Error & {code?: string; path?: string}, operation);
    }

    // If it's already a filesystem error, extract the code
    if (err.message && err.message.includes(':')) {
        const code = err.message.slice(0, err.message.indexOf(':'));
        if (FS_ERRORS[code as FSErrorCode]) {
            if (FS_ERRORS[code as FSErrorCode].linuxErrCode === FS_INTERNAL_ERROR_CODE) {
                console.log(new Error().stack);
                console.error(err);
                return 0;
            }
            return FS_ERRORS[code as FSErrorCode].linuxErrCode;
        }
    }

    // Handle one.core errors
    if (err.code && FS_ERRORS[err.code]) {
        return FS_ERRORS[err.code].linuxErrCode;
    }

    // Unknown error
    console.log(new Error().stack);
    console.error(err);
    return 0;
}
