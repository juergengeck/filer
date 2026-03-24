import {CachedDirectory} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';

/**
 * This directory generates month folders.
 */
export class MonthsDirectory extends CachedDirectory<{year: number; month: number}> {
    private readonly iterator: ChannelIterator;

    private readonly params: {year: number};

    constructor(iterator: ChannelIterator, params: {year: number}) {
        super();
        this.iterator = iterator;
        this.params = params;
    }

    async *valueIterator(): AsyncIterableIterator<string> {
        const it = this.iterator({
            omitData: true,
            from: new Date(this.params.year, 0),
            to: new Date(this.params.year, 11, 31, 23, 59, 59)
        });

        let previousValue: number | undefined = undefined;
        for await (const data of it) {
            const value = data.creationTime.getMonth() + 1;
            if (value !== previousValue) {
                yield String(value).padStart(2, '0');
            }
            previousValue = value;
        }
    }

    transformCacheValueToSubDirectoryParams(month: string): {year: number; month: number} {
        return {year: this.params.year, month: parseInt(month, 10)};
    }

    needsUpdate(month: string, timeOfEarliestChange: Date): boolean {
        return parseInt(month, 10) >= timeOfEarliestChange.getMonth() + 1;
    }
}
