import type {EasyDirectoryContent} from '../../utils/EasyFileSystem.js';
import type {IDirectory} from './IDirectory.js';
import HierarchicalDirectoryFactory from './HierarchicalDirectoryFactory.js';
import {IteratorValueCache} from './IteratorValueCache.js';

/**
 * Extracts the SubDirectoryParamsT from a CachedDirectory.
 */
export type ExtractSubDirectoryParamsT<GenericDirectoryT> =
    GenericDirectoryT extends CachedDirectory<infer SubDirectoryParamsT>
        ? SubDirectoryParamsT
        : never;

/**
 * This implements a directory folder whose content is cached and only updated when needed.
 *
 * This cache takes its input values from an iterator over data stored in a channel.
 *
 * This class takes care of those things:
 * - cache the values that the iterator returns, so that the iterator only has to run when
 *   values are outdated
 * - Build the EasyDirectoryContent that represents the cached iterator values as directories
 * (createDirectory)
 * - Forward the content of the sub-folders to other directory implementations (setSubDirectory)
 *
 * The sub-classes that use this abstract class have to do the following:
 * - provide the directory content as iterator (by implementing the valueIterator)
 * - define the parameters that shall be forwarded to the next folder level (by setting the
 *   SubDirectoryParamsT parameter)
 * - define how to convert from the cached/iterator value to the parameters that shall be
 *   forwarded to the next folder level (by implementing the transformCacheValueToSubDirectoryParams)
 */
export abstract class CachedDirectory<SubDirectoryParamsT> implements IDirectory {
    private subDirectoryFactory = new HierarchicalDirectoryFactory<SubDirectoryParamsT>();
    private readonly subDirectoryCache = new IteratorValueCache<string>(
        this.valueIterator.bind(this)
    );
    private readonly subDirectories = new Map<string, IDirectory>();
    private readonly skipDirectoryLevel: boolean;

    constructor(skipDirectoryLevel = false) {
        this.skipDirectoryLevel = skipDirectoryLevel;
    }

    /**
     * Sets how the sub-folder content shall be generated.
     *
     * This works by specifying a factory, that spawns a new object for each subdirectory.
     * You can chain those calls to set the content of sub-sub-folder and sub-sub-sub folders if
     * the SubDirectoryT implementation supports chaining.
     *
     * @param subDirectoryFactory
     */
    setSubDirectory<SubDirectoryT extends IDirectory>(
        subDirectoryFactory: (subDirectoryParams: SubDirectoryParamsT) => SubDirectoryT
    ): HierarchicalDirectoryFactory<ExtractSubDirectoryParamsT<SubDirectoryT>> {
        return this.subDirectoryFactory.setSubDirectory(subDirectoryFactory);
    }

    /**
     * Mark all cached values out of date that happened after the timeOfEarliestChange.
     *
     * Note: The individual implementations decide whether to invalidate the content of a
     * folder. At the moment all implementations adhere to the >= timeOfEarliestChange rule, but
     * this might change.
     *
     * @param timeOfEarliestChange
     */
    markCachesAsOutOfDate(timeOfEarliestChange: Date) {
        this.subDirectoryCache.markAsOutOfDate();

        for (const [value, directory] of this.subDirectories.entries()) {
            if (
                !this.needsUpdate(value, timeOfEarliestChange) &&
                directory instanceof CachedDirectory
            ) {
                directory.markCachesAsOutOfDate(timeOfEarliestChange);
            }
        }
    }

    // #### IDirectory implementation ####

    /**
     * Creates the directory content by creating a folder for each entry.
     *
     * @returns
     */
    async createDirectoryContent(): Promise<EasyDirectoryContent> {
        const subDirectoryNames = await this.subDirectoryCache.getValues();
        const directoryContent = new Map();

        for (const subDirectoryName of subDirectoryNames) {
            let subDirectory = this.subDirectories.get(subDirectoryName);

            if (subDirectory === undefined) {
                subDirectory = this.subDirectoryFactory.createDirectory(
                    this.transformCacheValueToSubDirectoryParams(subDirectoryName)
                );

                if (subDirectory !== undefined) {
                    if (subDirectory instanceof CachedDirectory) {
                        subDirectory.subDirectoryFactory =
                            this.subDirectoryFactory.getSubDirectoryFactoryInstance() as HierarchicalDirectoryFactory<any>;
                    }

                    this.subDirectories.set(subDirectoryName, subDirectory);
                }
            }

            if (this.skipDirectoryLevel) {
                const subDirectoryContent = subDirectory
                    ? await subDirectory.createDirectoryContent()
                    : new Map();
                for (const [fileName, content] of subDirectoryContent.entries()) {
                    directoryContent.set(fileName, content);
                }
            } else {
                directoryContent.set(subDirectoryName, {
                    type: 'directory',
                    content: subDirectory
                        ? subDirectory.createDirectoryContent.bind(subDirectory)
                        : new Map()
                });
            }
        }

        return directoryContent;
    }

    // #### Abstract interface ####

    /**
     * This iterator needs to return the names of the sub folders.
     */
    protected abstract valueIterator(): AsyncIterableIterator<string>;

    /**
     * This implementation needs to return the parameters that are forwarded to the sub-directory
     * based on the value that was initially returned by the iterator.
     *
     * @param iteratorValue
     */
    protected abstract transformCacheValueToSubDirectoryParams(
        iteratorValue: string
    ): SubDirectoryParamsT;

    /**
     * Needs to return whether the content of a sub-directories has to be updated (cache needs
     * to be invalidated).
     *
     * @param iteratorValue
     * @param timeOfEarliestChange
     */
    protected abstract needsUpdate(iteratorValue: string, timeOfEarliestChange: Date): boolean;
}
