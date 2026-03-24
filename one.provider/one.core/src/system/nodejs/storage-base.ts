/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @private
 * @module
 */

/*
 * NOTE ABOUT ERRORS AND PROMISE STYLE (promise.catch instead of try/catch)
 *
 * Low-level functions for file-access don't throw standard Javascript errors, they throw
 * node.js SYSTEM errors. Ref.: https://nodejs.org/api/errors.html#errors_system_errors
 *
 * When calling node.js fs methods we use .catch() instead of try/catch because
 *
 * 1. Only the former manages to enable async. stack trace creation (a feature available in
 *    recent node.js/V8)
 * 2. We also need to throw a createError(err) to get the stack trace. The one we get from node.js
 *    does not have it. Our createError() method always creates a createError.
 *
 * Follow https://bugs.chromium.org/p/v8/issues/detail?id=9443
 */

import {isUtf8} from 'buffer';
import {constants, createReadStream} from 'fs';
import {
    access,
    appendFile,
    chmod,
    mkdir,
    open,
    readdir,
    readFile,
    rm,
    stat,
    writeFile
} from 'fs/promises';
import {join, sep} from 'path';

import {createError} from '../../errors.js';
import type {HashTypes, Instance} from '../../recipes.js';
import type {
    FileCreationStatus,
    InitStorageOptions,
    StorageDirTypes
} from '../../storage-base-common.js';
import {CREATION_STATUS, STORAGE} from '../../storage-base-common.js';
import {flat} from '../../util/function.js';
import {getTypeFromMicrodata} from '../../util/object.js';
import {isInteger, isString} from '../../util/type-checks-basic.js';
import type {SHA256Hash, SHA256IdHash} from '../../util/type-checks.js';
import {isHash} from '../../util/type-checks.js';
import {DEFAULT_STORAGE_LOCATION, getBaseDirOrName, setBaseDirOrName} from '../storage-base.js';
import {getArrayBuffer} from '../../util/buffer.js';

const {F_OK, O_APPEND, O_CREAT, O_WRONLY} = constants;

/**
 * Points to the subdirectories used to store data. The initStorage() method sets the concrete
 * values and prepends the parent directory received from the outside.
 * ```
 *   objects: '',
 *   tmp: '',
 *   rmaps: '',
 *   vheads: '',
 *   acache: '',
 *   private: ''
 * ```
 * @private
 * @type {object}
 */
const STORAGE_DIRS = Object.values(STORAGE).reduce(
    (accumulator, type) => {
        accumulator[type] = '';
        return accumulator;
    },
    {} as Record<StorageDirTypes, string>
);

/**
 * This is a somewhat arbitrary cutoff for the number of hash characters used to locate a
 * subdirectory for the given object file. The absolute maximum of course would be 64,
 * which would give every single file its own directory. Since we pre-create all subdirectories
 * and since having too many subdirectories with too few file in them makes no practical sense
 * we place a practical limit. Note that since the first `SUB_DIR_LVL` characters of each SHA-256
 * hex hash string are used to locate the subdirectory the number of subdirectories is
 * 16**SUB_DIR_LVL. If the first 4 characters are used that will be 65,536 subdirectories. ANy
 * value higher than that - the next one being 1,048,576 - is too much for all practical purposes.
 * @see SUB_DIR_LVL
 * @private
 * @type {number}
 */
const MAX_LEVELS = 4;

/**
 * This variable is set to the value of the initInstance() option property `nHashCharsForSubDirs`
 * to remember it for this session.
 * In "object" storage, the first `n` characters of o files name - a hexadecimal SHA-256 hash
 * string - are used to locate the file in a subdirectory of that name. For example, if a file
 * name (hash) starts with "0fe123...." and n=2, then the file will be located not in directory
 * `objects/` but in directory `objects/0f/`. This hierarchical storage option is only offered on
 * *some* platforms.
 * @see MAX_LEVELS
 * @private
 * @type {number}
 */
let SUB_DIR_LVL = 0;

/**
 * @internal
 * @static
 * @param {StorageDirTypes} type
 * @returns {string} Returns the storage directory for the given storage type
 * @throws {Error} Throws an error if the database has not yet been initialized
 */
export function getStorageDirForFileType(type: StorageDirTypes): string {
    if (STORAGE_DIRS.objects === '') {
        throw createError('SB-NO-INIT2');
    }

    return STORAGE_DIRS[type];
}

/**
 * @private
 * @param {string} file - The file or directory with the full path or a path relative to
 * whatever the current base directory is.
 * @returns {Promise<boolean>}
 */
async function fileExists(file: string): Promise<boolean> {
    // See the note at the top about the use of .catch()
    return await access(file, F_OK)
        .then(() => true)
        .catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                return false;
            }

            throw createError('SB-EXISTS', err);
        });
}

/**
 * USES MODULE-LEVEL VARIABLE `STORAGE_DIRS` (because all functions do anyway and are impure)
 * @private
 * @param {number} levels - The number from instanceInit property `nHashCharsForSubDirs` (see there)
 * @returns {Promise<undefined>}
 */
async function createStorageDirs(levels: number): Promise<void> {
    await Promise.all(
        Object.values(STORAGE_DIRS).map(dir =>
            // See the note at the top about the use of .catch()
            mkdir(dir, {recursive: true}).catch((err: NodeJS.ErrnoException) => {
                if (err.code !== 'EEXIST') {
                    throw createError('SB-MKDIRS', err);
                }
            })
        )
    );

    // On Windows only the write-permission can be changed, and the distinction among the
    // permissions of group, owner or others is not implemented.
    // https://nodejs.org/dist/latest-v12.x/docs/api/fs.html#fs_file_modes
    await chmod(STORAGE_DIRS.private, 0o700);

    // From here on it's only about the "objects" directory

    if (levels === 0) {
        return;
    }

    if (levels > MAX_LEVELS || levels < 0) {
        throw createError('SB-CRLVL1', {max: MAX_LEVELS, val: levels});
    }

    SUB_DIR_LVL = levels;

    for (let i = 0; i < 16 ** levels; i++) {
        // eslint-disable-next-line no-await-in-loop
        await mkdir(join(STORAGE_DIRS.objects, i.toString(16).padStart(levels, '0')));
    }
}

/**
 * This function is necessary because "objects" storage can be configured to have a variable
 * number of subdirectories to store hash-named object files in based on the first n characters
 * of their hash (name). If this feature is not used then the path to the file is more simple.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {string}
 */
export function normalizeFilename(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): string {
    if (STORAGE_DIRS.objects === '') {
        // Storage has not been initialized, so we don't have a directory
        throw createError('SB-NORM-FN1');
    }

    return type === STORAGE.OBJECTS && SUB_DIR_LVL > 0
        ? join(STORAGE_DIRS[type], filename.substring(0, SUB_DIR_LVL), filename)
        : join(STORAGE_DIRS[type], filename);
}

/**
 * The node.js specific storage initialization involves creation of the given directory if it
 * does not exist yet (but this is not recursive so the parent directory has to already exist).
 *
 * **Note:**
 * The `directory` parameter is declared as "optional" even though it is not because this
 * platform-specific implementation of this method is only one implementation and others don't
 * require a parameter. An application using ONE with types might get errors depending on
 * which platform specific version is in `lib/system/` so we need to keep the APIs of the
 * different platform files synchronized. That means no static typing, but there is a runtime
 * check anyway.
 * @internal
 * @static
 * @async
 * @param {object} options
 * @param {SHA256IdHash} options.instanceIdHash
 * @param {boolean} [options.wipeStorage=false] - If `true` **all files in storage will be
 * deleted** when the instance is initialized. All files means *every single file*. Storage is
 * wiped clean.
 * @param {string} [options.name] - Platform dependent optional identifier of the storage location.
 * One platform where the file system is used, such as node.js, this is a directory. In browsers
 * this is the name component of the IndexedDB database (the other component is the instance ID
 * hash).
 * If this is a directory, **independent of the platform always use "/" as path component
 * separator here.** *(We have to be flexible handling paths we get from the system, but we have
 * to standardize the paths we use in our cross-platform code.)*
 * @param {number} [options.nHashCharsForSubDirs=0] - In "object" storage, the first `n`
 * characters of o files name - a hexadecimal SHA-256 hash string - are used to locate the file in
 * a subdirectory of that name. For example, if a file name (hash) starts with "0fe123...." and
 * n=2, then the file will be located not in directory `objects/` but in directory
 * `objects/0f/`. This hierarchical storage option is only offered on *some* platforms. When
 * this option has a number higher than 0 on a platform that does not support it an error is thrown.
 * @param {boolean} [options.encryptStorage=false] - **Only if the platform supports it.**
 * If set to `true` all items in all storage spaces are encrypted. Storage space "private" is
 * always encrypted.
 * @param {string|null} [options.secretForStorageKey] - This secret is used to derive a key to be
 * used to en- and decrypt all items in all storage spaces, or only the ones in "private",
 * depending on the value of `encryptStorage`.
 * @returns {Promise<undefined>}
 * @throws {Error} Throws an `Error` if the first parameter is not a hash
 */
export async function initStorage({
    instanceIdHash,
    wipeStorage = false,
    name,
    nHashCharsForSubDirs = 0,
    encryptStorage = false,
    secretForStorageKey // eslint-disable-line @typescript-eslint/no-unused-vars
}: InitStorageOptions): Promise<void> {
    if (encryptStorage) {
        throw createError('SB-INIT5');
    }

    setBaseDirOrName(name);

    const instanceDir = join(getBaseDirOrName(), instanceIdHash);

    // Prepend the given directory to the already chosen subdirectory names. The storage space
    // for BLOBs is shared across all instances, all others are per Instance ID hash.
    // NOTE: We use the existing object already assigned to STORAGE_DIRS instead of assigning a
    // new object deliberately to avoid problems with other modules' imports of that
    // object reference.
    for (const key of Object.keys(STORAGE_DIRS)) {
        STORAGE_DIRS[key as keyof typeof STORAGE_DIRS] = join(instanceDir, key);
    }

    // Assumption: If the instance directory exists then the entire directory structure exists.
    // There will be a crash if there is one missing, but that is okay - there is no way to
    // deal with randomly missing essential files. If we dealt with such a problem silently we
    // might miss an issue of accidental file deletion!
    const instanceExists = await fileExists(instanceDir);

    if (instanceExists && wipeStorage) {
        await rm(instanceDir, {recursive: true, maxRetries: 3});
    }

    if (!instanceExists || wipeStorage) {
        await createStorageDirs(nHashCharsForSubDirs);
    }
}

/**
 * @internal
 * @static
 * @returns {undefined}
 */
export function closeStorage(): void {
    for (const key of Object.keys(STORAGE_DIRS)) {
        STORAGE_DIRS[key as keyof typeof STORAGE_DIRS] = '';
    }
}

/**
 * Deletes the storage folder by the given instanceIdHash if it exists.
 * @internal
 * @static
 * @async
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<void>}
 */
export async function deleteStorage(instanceIdHash: SHA256IdHash<Instance>): Promise<void> {
    // This check added to prevent rm() below from removing something it shouldn't.
    if (!isHash(instanceIdHash)) {
        throw createError('SB-DELST1', {instanceIdHash});
    }

    const directoryPath = getBaseDirOrName() ?? DEFAULT_STORAGE_LOCATION;

    const storage = await doesStorageExist(instanceIdHash);

    if (!storage) {
        return;
    }

    // In case we get a slash-using path string, normalize for the current platform
    const normalizedBaseDir = join(
        directoryPath.startsWith(sep) ? sep : '',
        ...directoryPath.split(sep)
    );

    const instanceDir = join(normalizedBaseDir, instanceIdHash);

    return await rm(instanceDir, {
        recursive: true,
        maxRetries: 3
    }).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    });
}

/**
 * Checks if the instance exists or not.
 * @internal
 * @static
 * @async
 * @param {SHA256IdHash<Instance>} instanceIdHash
 * @returns {Promise<boolean>}
 */
export async function doesStorageExist(instanceIdHash: SHA256IdHash<Instance>): Promise<boolean> {
    const directoryPath = getBaseDirOrName() ?? DEFAULT_STORAGE_LOCATION;

    // In case we get a slash-using path string, normalize for the current platform
    const normalizedBaseDir = join(
        directoryPath.startsWith(sep) ? sep : '',
        ...directoryPath.split(sep)
    );

    const instanceDir = join(normalizedBaseDir, instanceIdHash);

    return await fileExists(instanceDir);
}

/**
 * Promisified version of node.js method fs.readFile(). `ENOENT` errors are normalized to
 * `FileNotFound`.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<string>} Resolves with a string. The promise is rejected if the file does
 * not exist.
 * @throws {Error} Rejects with an `Error` if no filename is given
 * @throws {Error} Rejects with an Error object whose name property is set to `FileNotFoundError`
 * if the file cannot be found
 */
export async function readUTF8TextFile(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    if (filename === undefined) {
        throw createError('SB-READ1');
    }

    // By specifying an encoding we get a UTF-8 string instead of a raw buffer.
    // See the note at the top about the use of .catch()
    return await readFile(normalizeFilename(filename, type), 'utf8').catch(
        (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                throw createError('SB-READ2', {name: 'FileNotFoundError', filename, type});
            }

            throw createError('SB-READ', err);
        }
    );
}

/**
 * Read *a section* of the given UTF-8 encoded file as string. If the file has a bOM the offset
 * will be off. If a UTF-8 character used in the file uses more than one byte the offset will be
 * off. That is why unless you calculate the byte offset yourself the byte offset only matches the
 * character offset in the Javascript string representation of the file contents if the file
 * only contains characters from the ASCII-compatible section of UTF-8 codes.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {number} offset - **Byte*** offset: Where to start reading the UTF-8 encoded file. If the
 * offset is negative it is counted backwards from the end of the file. If the offset is
 * negative it is counted backwards from the end of the file.
 * @param {number} length - **Byte** length: How many bytes to read starting at the given offset
 * (always forward).
 * @returns {Promise<string>} - Returns the given section converted to a Javascript string
 * @param {StorageDirTypes} [type='objects']
 * @throws {Error} Throws an `Error` if a parameter is missing
 * @throws {Error} Throws an Error whose name property is set to `FileNotFoundError` if the file
 * cannot be found
 */
export async function readTextFileSection(
    filename: string,
    offset: number,
    length: number,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<string> {
    if (!isString(filename) || !isInteger(offset) || !isInteger(length)) {
        throw createError('SB-RASEC1', {filename, type, offset, length});
    }

    const fd = await open(normalizeFilename(filename, type), 'r').catch(err => {
        if (err.code === 'ENOENT') {
            throw createError('SB-RASEC2', {
                name: 'FileNotFoundError',
                filename,
                type,
                offset,
                length
            });
        }

        throw err;
    });

    const stats = await fd.stat();

    if (offset < 0) {
        if (-offset < length) {
            throw createError('SB-RASEC3', {filename, type, offset, length});
        }

        if (-offset > stats.size) {
            throw createError('SB-RASEC4', {filename, type, offset, length, size: stats.size});
        }
    } else if (offset + length > stats.size) {
        throw createError('SB-RASEC5', {filename, type, offset, length, size: stats.size});
    }

    const {buffer} = await fd.read(
        Buffer.alloc(length),
        0,
        length,
        offset < 0 ? stats.size + offset : offset
    );

    await fd.close();

    return buffer.toString('utf-8');
}

/**
 * **Note that existing files will NOT be overwritten!** That is because this function is
 * made for our special context, where all files are stored under their SHA-256 hash as name, so
 * overwriting a file would make no sense.
 * @internal
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIRS
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new, exists).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given
 */
export async function writeUTF8TextFile(
    contents: string,
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<FileCreationStatus> {
    if (contents === undefined) {
        throw createError('SB-WRITE1');
    }

    if (filename === undefined) {
        throw createError('SB-WRITE2');
    }

    // Flag 'wx' - Like 'w' but fails if path exists
    // See the note at the top about the use of .catch()
    return await writeFile(normalizeFilename(filename, type), contents, {flag: 'wx'})
        .then(() => CREATION_STATUS.NEW)
        .catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'EEXIST') {
                return CREATION_STATUS.EXISTS;
            }

            throw createError('SB-WRITE', err);
        });
}

/**
 * **Note that existing files will be overwritten!**
 * @internal
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename relative to STORAGE_DIRS
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string (new).
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if the 3rd
 * parameter is not "rmaps" or "vheads"
 */
export async function writeUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    if (contents === undefined) {
        throw createError('SB-WRITEM1');
    }

    if (filename === undefined) {
        throw createError('SB-WRITEM2');
    }

    if (type !== STORAGE.RMAPS && type !== STORAGE.VHEADS) {
        throw createError('SB-WRITEM3', {type});
    }

    // 'w' - Override existing file
    // See the note at the top about the use of .catch()
    return await writeFile(join(STORAGE_DIRS[type], filename), contents)
        .then(() => CREATION_STATUS.NEW)
        .catch((err: NodeJS.ErrnoException) => {
            throw createError('SB-WRITEM', err);
        });
}

/**
 * **This function is reserved for system internal version-map and reverse-map files.**
 * @see {@link
 *     system/storage-base.module:ts.writeUTF8TextFile|system/storage-base.writeUTF8TextFile}
 * @internal
 * @static
 * @async
 * @param {string} contents
 * @param {string} filename - Plain filename without directory
 * @param {('vheads'|'rmaps')} type
 * @returns {Promise<FileCreationStatus>} A promise resolving with the enum-type
 * creation status string which always is "new" to be consistent with the writeUTF8TextFile()
 * method
 * @throws {Error} Throws an `Error` if no filename and/or no contents is given, or if the 3rd
 * parameter is not "rmaps" or "vheads"
 */
export async function appendUTF8SystemMapFile(
    contents: string,
    filename: string,
    type: typeof STORAGE.RMAPS | typeof STORAGE.VHEADS
): Promise<FileCreationStatus> {
    if (contents === undefined) {
        throw createError('SB-APPEND1');
    }

    if (filename === undefined) {
        throw createError('SB-APPEND2');
    }

    if (type !== STORAGE.RMAPS && type !== STORAGE.VHEADS) {
        throw createError('SB-APPEND3', {type});
    }

    let status: FileCreationStatus = CREATION_STATUS.EXISTS;

    try {
        await appendFile(join(STORAGE_DIRS[type], filename), contents, {flag: O_APPEND | O_WRONLY});
    } catch (err) {
        if (err.code === 'ENOENT') {
            status = CREATION_STATUS.NEW;
        } else {
            throw createError('SB-APPEND4', err);
        }
    }

    if (status === CREATION_STATUS.NEW) {
        try {
            await appendFile(join(STORAGE_DIRS[type], filename), contents, {
                flag: O_APPEND | O_CREAT | O_WRONLY
            });
        } catch (err) {
            throw createError('SB-APPEND5', err);
        }
    }

    return status;
}

/**
 * Reads a binary file from storage space "private". Storage encryption is ignored, the raw file is
 * returned.
 *
 * On node.js the file's contents always is returned as `ArrayBuffer`, even if it is a UTF-8 text
 * file.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @returns {Promise<ArrayBuffer>}
 */
export async function readPrivateBinaryRaw(filename: string): Promise<ArrayBuffer> {
    if (!isString(filename)) {
        throw createError('SB-RPBR1', {filename});
    }

    // By specifying an encoding we get a UTF-8 string instead of a raw buffer.
    // See the note at the top about the use of .catch()
    return getArrayBuffer(
        await readFile(normalizeFilename(filename, STORAGE.PRIVATE)).catch(
            (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    throw createError('SB-RPBR3', {
                        name: 'FileNotFoundError',
                        filename,
                        type: STORAGE.PRIVATE
                    });
                }

                throw createError('SB-RPBR2', {err, filename});
            }
        )
    );
}

/**
 * Write a binary file from storage space "private". Storage encryption is ignored, the raw
 * ArrayBuffer is written. If the file already exists the promise is rejected with an Error.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {ArrayBufferLike | Uint8Array} contents
 * @returns {Promise<void>}
 */
export async function writePrivateBinaryRaw(
    filename: string,
    contents: ArrayBufferLike | Uint8Array
): Promise<void> {
    if (
        !(
            contents instanceof ArrayBuffer ||
            contents instanceof SharedArrayBuffer ||
            contents instanceof Uint8Array
        )
    ) {
        throw createError('SB-WPBR1', {type: typeof contents, filename});
    }

    if (!isString(filename)) {
        throw createError('SB-WPBR2', filename);
    }

    // Flag 'wx' - Like 'w' but fails if path exists
    // See the note at the top about the use of .catch()
    // Usage of Buffer.from(): "This creates a view of the ArrayBuffer without copying the
    // underlying memory" (from the node.js docs)
    // Also see https://github.com/nodejs/node/issues/42228
    await writeFile(
        normalizeFilename(filename, STORAGE.PRIVATE),
        Buffer.from(getArrayBuffer(contents)),
        {
            flag: 'wx'
        }
    ).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST') {
            // Only in "objects" storage, where the filename is the hash of the contents,
            // can this be ignored. Here, overwriting existing files is a problem.
            throw createError('SB-WPBR3', {filename});
        }

        throw createError('SB-WPBR4', {err, filename});
    });
}

/**
 * This function supports the higher-level storage function that determines a stored files type.
 * By default, the first 100 bytes are interpreted as UTF-8 characters and returned, but starting
 * position as well as the number of bytes can be adjusted.
 * If the function reads less than `length` characters it just returns what it was able to get
 * without raising an exception. If the file was shorter so be it, in the context of our main use
 * case, which is to get the beginning of the microdata string of a ONE object in storage to
 * determine the type, this is not an error condition.
 * @private
 * @static
 * @async
 * @param {string} filename
 * @param {number} [position=0]
 * @param {number} [length=100]
 * @returns {Promise<string>} Returns length characters of the contents of the given file.
 * @throws {Error} Throws an `Error` if no filename is given
 * @throws {Error} Throws an Error object whose name property is set to `FileNotFoundError` if the
 * file cannot be found
 */
function getNCharacters(
    filename: string,
    position: number = 0,
    length: number = 256
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (filename === undefined) {
            reject(createError('SB-GETN1'));
        }

        const stream = createReadStream(normalizeFilename(filename), {
            start: position,
            end: position + length
        });

        stream.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                reject(
                    createError('SB-GETN2', {
                        name: 'FileNotFoundError',
                        filename,
                        type: STORAGE.OBJECTS
                    })
                );
            } else {
                reject(createError('SB-GETN5', err));
            }
        });

        let content = '';

        stream.on('data', (chunk: Buffer | string) => {
            if (isString(chunk)) {
                content += chunk;
            } else if (isUtf8(chunk)) {
                content += chunk.toString('utf8');
            } else {
                return reject(createError('SB-RD-NOSTR', {filename}));
            }
        });

        stream.on('end', () => resolve(content));
    });
}

/**
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<boolean>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export async function exists(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<boolean> {
    if (filename === undefined) {
        throw createError('SB-EXISTS');
    }

    return await fileExists(normalizeFilename(filename, type));
}

/**
 * Uses node.js "fs.promises.stat" and the "size" property on the Stat object to get the file size.
 * @internal
 * @static
 * @async
 * @param {string} filename
 * @param {StorageDirTypes} [type='objects']
 * @returns {Promise<number>}
 * @throws {Error} Throws an `Error` if no filename is given
 */
export async function fileSize(
    filename: string,
    type: StorageDirTypes = STORAGE.OBJECTS
): Promise<number> {
    if (filename === undefined) {
        throw createError('SB-FSIZE1');
    }

    const stats = await stat(normalizeFilename(filename, type)).catch(
        (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                throw createError('SB-FSIZE2', {name: 'FileNotFoundError', filename, type});
            }

            throw createError('SB-FSIZE3', err);
        }
    );

    return stats.size;
}

/**
 * @internal
 * @static
 * @async
 * @returns {Promise<SHA256Hash[]>}
 */
export async function listAllObjectHashes(): Promise<Array<SHA256Hash<HashTypes> | SHA256IdHash>> {
    // See the note at the top about the use of .catch()

    if (SUB_DIR_LVL === 0) {
        return (await readdir(STORAGE_DIRS.objects).catch((err: NodeJS.ErrnoException) => {
            throw createError('SB-LH', err);
        })) as Array<SHA256Hash<HashTypes>>;
    }

    const subdirs = await readdir(STORAGE_DIRS.objects).catch((err: NodeJS.ErrnoException) => {
        throw createError('SB-LH', err);
    });

    const files = await Promise.all(
        subdirs.map(subdir =>
            readdir(join(STORAGE_DIRS.objects, subdir)).catch((err: NodeJS.ErrnoException) => {
                throw createError('SB-LH', err);
            })
        )
    );

    return flat(files) as Array<SHA256Hash<HashTypes>>;
}

/**
 * @internal
 * @static
 * @async
 * @returns {Promise<SHA256IdHash[]>}
 */
export async function listAllIdHashes(): Promise<SHA256IdHash[]> {
    // See the note at the top about the use of .catch()
    return (await readdir(STORAGE_DIRS[STORAGE.VHEADS]).catch((err: NodeJS.ErrnoException) => {
        throw createError('SB-LIH', err);
    })) as SHA256IdHash[];
}

/**
 * @internal
 * @static
 * @async
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
export async function listAllReverseMapNames(prefix?: string): Promise<string[]> {
    // See the note at the top about the use of .catch()
    const files = await readdir(STORAGE_DIRS[STORAGE.RMAPS]).catch((err: NodeJS.ErrnoException) => {
        throw createError('SB-LM', err);
    });

    return isString(prefix) ? files.filter(file => file.startsWith(prefix)) : files;
}

/**
 * Reads the first 100 characters of the given object and returns its type. If it is not a ONE
 * object it simply returns "BLOB".
 * @internal
 * @static
 * @async
 * @param {(SHA256Hash|SHA256IdHash)} hash - Hash identifying a ONE object in storage
 * @returns {Promise<string|'BLOB'>} The type string of the given microdata object, or 'BLOB'
 * if the given string does not look like ONE object microdata
 */
export async function getFileType(hash: SHA256Hash<HashTypes> | SHA256IdHash): Promise<string> {
    let firstChars;

    try {
        firstChars = await getNCharacters(hash);
    } catch (err) {
        if (err.code === 'SB-RD-NOSTR') {
            return 'BLOB';
        }

        throw err;
    }

    return getTypeFromMicrodata(firstChars);
}

/**
 * @internal
 * @static
 * @async
 * @param {string} _oldSecret
 * @param {string} _newSecret
 * @returns {Promise<void>}
 */
export async function changeStoragePassword(_oldSecret: string, _newSecret: string): Promise<void> {
    // This platform does not support storage encryption, so there is nothing to do.
    return;
}
