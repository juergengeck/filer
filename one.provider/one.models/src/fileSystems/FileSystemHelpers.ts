import {createError} from '@refinio/one.core/lib/errors.js';
import {FS_ERRORS} from './FileSystemErrors.js';

/**
 * @type {{permissions: {rwx: number, rNN: number, NwN: number, rwN: number, NNx: number, rNx: number, Nwx: number}, fileType: {file: string, symlink: string, dir: string}}}
 */
const fileOptions: FileOptions = {
    fileType: {file: '0100', dir: '0040', symlink: '0120'},
    permissions: {NNN: 0, NNx: 1, NwN: 2, Nwx: 3, rNN: 4, rNx: 5, rwN: 6, rwx: 7}
};

/**
 * This type represents the current file options that we're supporting.
 */
type FileOptions = {
    fileType: {[K in 'file' | 'dir' | 'symlink']: string};
    permissions: {[key: string]: number};
};

/**
 * This type represents the return value structure for {@link FileSystemHelpers.retrieveFileMode()}.
 */
type FileMode = {
    type: 'file' | 'dir' | 'symlink';
    permissions: {
        [K in AccessEntity]: {write: boolean; read: boolean; exe: boolean};
    };
};

/**
 * This type represents the user types.
 */
type AccessEntity = 'owner' | 'group' | 'public';

export default class FileSystemHelpers {
    /**
     * This function will parse the given octal (mode) and return the file modes in json format.
     * @param {number} mode
     * @returns {FileMode}
     * @static
     */
    public static retrieveFileMode(mode: number): FileMode {
        /** initial parsed mode **/
        const parsedMode: FileMode = {
            type: 'file',
            permissions: {
                owner: {write: false, read: false, exe: false},
                group: {write: false, read: false, exe: false},
                public: {write: false, read: false, exe: false}
            }
        };
        /** convert the given octals to an array of numbers **/
        const modeAsArray = FileSystemHelpers.numberToArrayOfNumbers(mode);
        /** the file type is represent from this interval of indexes [modeAsArray[0],modesAsArray[4]] **/
        const type = FileSystemHelpers.getFileType(modeAsArray.slice(0, 4).join(''));
        if (!type) {
            throw createError('FSE-WRM1', {message: FS_ERRORS['FSE-WRM1'].message, mode: mode});
        }
        parsedMode.type = type;
        /** the file type is represent from this interval of indexes [modeAsArray[4],modesAsArray[7]] **/
        const permissions = FileSystemHelpers.getFilePermission(modeAsArray.slice(4, 7));
        if (!permissions) {
            throw createError('FSE-WRM2', {message: FS_ERRORS['FSE-WRM2'].message, mode: mode});
        }
        parsedMode.permissions = permissions;
        return parsedMode;
    }

    /**
     * This function converts the octal into an array of numbers. If the length its not 7, unshift with 0.
     * This may happen when zeros are in the front of the octal number.
     * @private
     * @static
     * @param {number} mode
     * @returns {number[]}
     */
    private static numberToArrayOfNumbers(mode: number): number[] {
        const modeAsArray = mode
            .toString(8)
            .split('')
            .map(asString => parseInt(asString, 8));
        while (modeAsArray.length < 7) {
            modeAsArray.unshift(0);
        }
        return modeAsArray;
    }

    /**
     * This function retrieves the file type by comparing the values of fileOptions.fileType with the given type.
     * @private
     * @static
     * @param {string} type
     * @returns {"file" | "dir" | "symlink" | undefined}
     */
    private static getFileType(type: string): FileMode['type'] | undefined {
        for (const key of Object.keys(fileOptions.fileType)) {
            const typeKey = key as keyof (typeof fileOptions)['fileType'];
            if (fileOptions.fileType[typeKey] === type) {
                return typeKey;
            }
        }
        return undefined;
    }

    /**
     * This function retrieves the files perms by checking each value if it is equal to 'N' ('N' - not set).
     * @private
     * @static
     * @param {number[]} perms
     * @returns {{owner: {write: boolean, read: boolean, exe: boolean}, group: {write: boolean, read: boolean, exe: boolean}, public: {write: boolean, read: boolean, exe: boolean}} | undefined}
     */
    private static getFilePermission(perms: number[]): FileMode['permissions'] | undefined {
        const accessEntities: AccessEntity[] = ['owner', 'group', 'public'];
        let found = 0;
        const res: FileMode['permissions'] = {
            owner: {write: false, read: false, exe: false},
            group: {write: false, read: false, exe: false},
            public: {write: false, read: false, exe: false}
        };
        for (let i = 0; i < perms.length; i++) {
            for (const key of Object.keys(fileOptions.permissions)) {
                if (fileOptions.permissions[key] === perms[i]) {
                    const splitKey = key.split('');
                    found++;
                    res[accessEntities[i]] = {
                        write: splitKey[0] !== 'N',
                        read: splitKey[1] !== 'N',
                        exe: splitKey[2] !== 'N'
                    };
                }
            }
        }
        /** ensured that the perms number array was not malformed / values ∈ [0,6] **/
        if (found === 3) {
            return res;
        }
        return undefined;
    }

    /**
     * Get full path of the last directory's parent
     * E.g /dir1/dir2/dir3. Call this function will result in /dir1/dir2.
     * @static
     * @param {string} givenPath
     * @returns {string}
     */
    public static getParentDirectoryFullPath(givenPath: string): string {
        const regex = new RegExp('/[^/]*$');
        const res = givenPath.replace(regex, '/');
        if (res !== '/') {
            return res.substring(0, res.length - 1);
        }
        return res;
    }

    /**
     * Retrieves the last item of path.
     * @static
     * @param {string} path
     */
    public static getLastItem(path: string) {
        return path.substring(path.lastIndexOf('/') + 1);
    }

    /**
     * Append paths.
     * @static
     * @param {string} pathToJoin
     * @param {string} path
     * @returns {string}
     */
    public static pathJoin(pathToJoin: string, path: string): string {
        return pathToJoin === '/' ? `${pathToJoin}${path}` : `${pathToJoin}/${path}`;
    }
}
