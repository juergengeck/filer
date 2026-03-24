import type {EasyDirectoryContent} from '../utils/EasyFileSystem.js';
import type {ExtractSubDirectoryParamsT} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';
import type HierarchicalDirectoryFactory from './utils/HierarchicalDirectoryFactory.js';
import type {IDirectory} from './utils/IDirectory.js';
import {DaysDirectory} from './DaysDirectory.js';
import {MonthsDirectory} from './MonthsDirectory.js';
import {YearsDirectory} from './YearsDirectory.js';

/**
 * This directory generates three levels of directories:
 * <year>/<month>/<day>
 */
export class DateDirectories<T = unknown> implements IDirectory {
    private readonly subDirectoryFactory: HierarchicalDirectoryFactory<
        ExtractSubDirectoryParamsT<DaysDirectory>
    >;
    private readonly yearsDirectory: YearsDirectory;

    constructor(iterator: ChannelIterator<T>) {
        this.yearsDirectory = new YearsDirectory(iterator);
        this.subDirectoryFactory = this.yearsDirectory
            .setSubDirectory(p => new MonthsDirectory(iterator, p))
            .setSubDirectory(p => new DaysDirectory(iterator, p));
    }

    setSubDirectory<DirT extends IDirectory>(
        subDirectoryFactory: (subDirectoryParams: ExtractSubDirectoryParamsT<DaysDirectory>) => DirT
    ): HierarchicalDirectoryFactory<ExtractSubDirectoryParamsT<DirT>> {
        return this.subDirectoryFactory.setSubDirectory(subDirectoryFactory);
    }

    setSubDirectoryAsFunction(
        subDirectoryFactory: (
            subDirectoryParams: ExtractSubDirectoryParamsT<DaysDirectory>
        ) => EasyDirectoryContent | Promise<EasyDirectoryContent>
    ) {
        return this.subDirectoryFactory.setSubDirectoryAsFunction(subDirectoryFactory);
    }

    async createDirectoryContent(): Promise<EasyDirectoryContent> {
        return this.yearsDirectory.createDirectoryContent();
    }
}
