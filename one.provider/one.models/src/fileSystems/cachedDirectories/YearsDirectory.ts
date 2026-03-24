import {CachedDirectory} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';

/**
 * This directory generates years folders.
 */
export class YearsDirectory extends CachedDirectory<{year: number}> {
    private readonly iterator: ChannelIterator;

    constructor(iterator: ChannelIterator) {
        super();
        this.iterator = iterator;
    }

    async *valueIterator(): AsyncIterableIterator<string> {
        const it = this.iterator({
            omitData: true
        });

        let previousValue: number | undefined = undefined;
        for await (const data of it) {
            const value = data.creationTime.getFullYear();
            if (value !== previousValue) {
                yield String(value).padStart(4, '0');
            }
            previousValue = value;
        }
    }

    transformCacheValueToSubDirectoryParams(year: string): {year: number} {
        return {year: parseInt(year, 10)};
    }

    needsUpdate(year: string, timeOfEarliestChange: Date): boolean {
        return parseInt(year, 10) >= timeOfEarliestChange.getFullYear();
    }
}
