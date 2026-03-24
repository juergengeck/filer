import type {EasyDirectoryContent} from '../../utils/EasyFileSystem.js';

/**
 * This ia a generic interface for all classes that have the task to generate the content of a
 * directory.
 */
export interface IDirectory {
    createDirectoryContent(): Promise<EasyDirectoryContent>;
}
