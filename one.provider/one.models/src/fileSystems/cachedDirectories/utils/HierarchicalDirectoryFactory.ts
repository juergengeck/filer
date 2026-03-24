import type {EasyDirectoryContent} from '../../utils/EasyFileSystem.js';
import type {ExtractSubDirectoryParamsT} from './CachedDirectory.js';
import type {IDirectory} from './IDirectory.js';

/**
 * A directory factory is used to create instances of directories when they are needed.
 *
 * In this case it is hierarchical because we can specify factory functions for several levels
 * of a hierarchy.
 *
 * In order to spawn a new directory instance, use the createDirectory call.
 */
export default class HierarchicalDirectoryFactory<DirectoryParamsT> {
    private directoryFactoryFunction?: (subDirectoryParams: DirectoryParamsT) => IDirectory;
    private subDirectoryFactoryInstance?: HierarchicalDirectoryFactory<any>;

    /**
     * Sets the factory for the sub directory level.
     *
     * The returned value can be used to set the factory for the sub sub directory level.
     *
     * @param subDirectoryFactory
     */
    setSubDirectory<DirectoryT extends IDirectory>(
        subDirectoryFactory: (subDirectoryParams: DirectoryParamsT) => DirectoryT
    ): HierarchicalDirectoryFactory<ExtractSubDirectoryParamsT<DirectoryT>> {
        if (this.directoryFactoryFunction) {
            throw new Error('You cannot change the subfolder after it was assigned.');
        }

        this.directoryFactoryFunction = subDirectoryFactory;
        const subDirectoryFactoryNext = new HierarchicalDirectoryFactory<
            ExtractSubDirectoryParamsT<DirectoryT>
        >();
        this.subDirectoryFactoryInstance = subDirectoryFactoryNext;
        return subDirectoryFactoryNext;
    }

    /**
     * Sets the factory for the sub directory level as a function instead of an IDirectory.
     *
     * This is a convenience function for cases where you do not have an IDirectory implementation.
     * Usually this is used at the innermost level of the cached directories.
     *
     * The drawback is, that chaining directories doesn't work after this call.
     *
     * @param subDirectoryFactory
     */
    setSubDirectoryAsFunction(
        subDirectoryFactory: (
            subDirectoryParams: DirectoryParamsT
        ) => EasyDirectoryContent | Promise<EasyDirectoryContent>
    ): void {
        this.setSubDirectory(p => ({
            createDirectoryContent: async () => {
                return subDirectoryFactory(p);
            }
        }));
    }

    /**
     * This creates the DynamicDirectory instance, so this is the main purpose of this class.
     * @param subDirectoryParams
     */
    createDirectory(subDirectoryParams: DirectoryParamsT): IDirectory | undefined {
        return this.directoryFactoryFunction?.(subDirectoryParams);
    }

    /**
     * Get the sub-directory factory instance, so that it can be passed on to the next file
     * system level.
     */
    getSubDirectoryFactoryInstance(): HierarchicalDirectoryFactory<any> | undefined {
        return this.subDirectoryFactoryInstance;
    }
}
