/**
 * Internal error constant.
 */
export const FS_INTERNAL_ERROR_CODE = 999;

/**
 *
 * Filer Errors
 * -----------------------------------------------
 *
 * Error codes that returns {@link FS_INTERNAL_ERROR_CODE} must be thrown in the used project. They represent a logic error.
 *
 * FSE stands for 'File System Error'
 */
export const FS_ERRORS: {[key: string]: {message: string; linuxErrCode: number}} = {
    // ---------------------------- FS ERRORS ONLY ----------------------------

    /**
     * When the given file or directory does not exist.
     */
    'FSE-ENOENT': {message: 'No such file or directory', linuxErrCode: -2},
    /**
     * When a directory was expected, but something else was found.
     */
    'FSE-ENOTDIR': {message: 'Directory part of path is not a directory', linuxErrCode: -20},
    /**
     * When something else was expected, but a directory was found.
     */
    'FSE-EISDIR': {message: 'File is a directory', linuxErrCode: -21},
    /**
     * When the given file or directory does not have write permission.
     */
    'FSE-EACCES-W': {message: 'Write permissions required', linuxErrCode: -13},
    /**
     * When the given file or directory does not have read permission.
     */
    'FSE-EACCES-R': {message: 'Read permissions required', linuxErrCode: -13},
    /**
     * When the given file or directory does not have execute permission.
     */
    'FSE-EACCES-E': {message: 'Execute permissions required', linuxErrCode: -13},
    /**
     * When the function is not implemented.
     */
    'FSE-ENOSYS': {message: 'Function not implemented', linuxErrCode: -38},
    /**
     * When the given path already exists.
     */
    'FSE-EXISTS': {message: 'Path already exists', linuxErrCode: -17},
    /**
     * Invalid value of several syscalls
     */
    'FSE-EINVAL': {message: 'Invalid value', linuxErrCode: -22},
    /**
     * Bad file descriptor
     */
    'FSE-EBADF': {message: 'Bad file descriptor', linuxErrCode: -9},
    /**
     * When a hidden file and/or extended attributes are creating on MacOS.
     */
    'FSE-MACH': {
        message: 'Hidden files and extended attributes are disabled on MacOS',
        linuxErrCode: -2
    },

    // ---------------------------- INTERNAL ERRORS ONLY ----------------------------

    /**
     * When a {@link IFileSystem.readFileInChunks} is not supported. It is only supported on Node.
     */
    'FSE-CHUNK-R': {
        message: 'Reading file in chunks is not supported on other systems than node',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When a {@link getObjectSize} is not supported. It is only supported on Node.
     */
    'FSE-OBJS': {
        message: 'Getting object size from data folder is not supported on other systems than node',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the desired mounting path already exists.
     */
    'FSE-MOUNT1': {
        message: 'The path was already mounted. Unmount it first',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the desired mounting path already exists.
     */
    'FSE-MOUNT2': {
        message: 'Cannot mount path under already mounted path. Unmount first',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the desired unmounting path is not mounted in the first place.
     */
    'FSE-MOUNT3': {
        message: 'Cannot unmount path. Path not mounted',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the {@link TemporaryFileSystem} cannot map the call to the specific FS
     */
    'FSE-FSMAP': {
        message: 'Could not map call to the file system. File system not found',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the given mode is malformed
     */
    'FSE-WRM1': {
        message: 'The given file mode was malformed',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * When the given file permissions were malformed
     */
    'FSE-WRM2': {
        message: 'The given file permissions were malformed',
        linuxErrCode: FS_INTERNAL_ERROR_CODE
    },
    /**
     * Unknown Internal Error
     */
    'FSE-UNK': {message: 'Unknown File System Error', linuxErrCode: FS_INTERNAL_ERROR_CODE},
    /**
     * Cannot execute command on the root path
     */
    'FSE-ROOT': {message: 'Cannot execute command on root path', linuxErrCode: 0}
};
