import type {EasyDirectoryContent} from '../utils/EasyFileSystem.js';
import {DateToObjectDataTransformDirectory} from './DateToObjectDataTransformDirectory.js';
import type {ExtractSubDirectoryParamsT} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';
import type HierarchicalDirectoryFactory from './utils/HierarchicalDirectoryFactory.js';
import type {IDirectory} from './utils/IDirectory.js';
import {DateDirectories} from './DateDirectories.js';

/**
 * This directory generates three levels of directories:
 * <year>/<month>/<day> and outputs the data object of the channel
 */
export class DateObjectDataDirectories<T = unknown> implements IDirectory {
    private readonly subDirectoryFactory: HierarchicalDirectoryFactory<
        ExtractSubDirectoryParamsT<DateToObjectDataTransformDirectory<T>>
    >;
    private readonly dateDirectories: DateDirectories;

    constructor(iterator: ChannelIterator<T>) {
        this.dateDirectories = new DateDirectories(iterator);
        this.subDirectoryFactory = this.dateDirectories.setSubDirectory(
            p => new DateToObjectDataTransformDirectory<T>(iterator, p)
        );
    }

    setSubDirectory<DirT extends IDirectory>(
        subDirectoryFactory: (
            subDirectoryParams: ExtractSubDirectoryParamsT<DateToObjectDataTransformDirectory<T>>
        ) => DirT
    ): HierarchicalDirectoryFactory<ExtractSubDirectoryParamsT<DirT>> {
        return this.subDirectoryFactory.setSubDirectory(subDirectoryFactory);
    }

    setSubDirectoryAsFunction(
        subDirectoryFactory: (
            subDirectoryParams: ExtractSubDirectoryParamsT<DateToObjectDataTransformDirectory<T>>
        ) => EasyDirectoryContent | Promise<EasyDirectoryContent>
    ) {
        return this.subDirectoryFactory.setSubDirectoryAsFunction(subDirectoryFactory);
    }

    async createDirectoryContent(): Promise<EasyDirectoryContent> {
        return this.dateDirectories.createDirectoryContent();
    }
}
