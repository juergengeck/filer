import {CachedDirectory} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';

/**
 * This directory generates day folders.
 */
export class DaysDirectory extends CachedDirectory<{
    year: number;
    month: number;
    day: number;
}> {
    private readonly iterator: ChannelIterator;
    private readonly params: {year: number; month: number};

    constructor(iterator: ChannelIterator, params: {year: number; month: number}) {
        super();
        this.iterator = iterator;
        this.params = params;
    }

    async *valueIterator(): AsyncIterableIterator<string> {
        const it = this.iterator({
            omitData: true,
            from: new Date(this.params.year, this.params.month - 1, 1),
            to: new Date(this.params.year, this.params.month, 0, 23, 59, 59)
        });

        let previousValue: number | undefined = undefined;
        for await (const data of it) {
            const value = data.creationTime.getDate();
            if (value !== previousValue) {
                yield String(value).padStart(2, '0');
            }
            previousValue = value;
        }
    }

    transformCacheValueToSubDirectoryParams(day: string): {
        year: number;
        month: number;
        day: number;
    } {
        return {year: this.params.year, month: this.params.month, day: parseInt(day, 10)};
    }

    needsUpdate(day: string, timeOfEarliestChange: Date): boolean {
        return parseInt(day, 10) >= timeOfEarliestChange.getDay() + 1;
    }
}
