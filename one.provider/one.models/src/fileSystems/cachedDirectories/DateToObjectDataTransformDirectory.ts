import {ensureHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ObjectData, QueryOptions} from '../../models/ChannelManager.js';
import type {CreationTime} from '../../recipes/MetaRecipes.js';
import {CachedDirectory} from './utils/CachedDirectory.js';
import type {ChannelIterator} from './utils/ChannelIterator.js';

type DateToObjectDataTransformDirectoryParams =
    | {year?: number; month?: number; day?: number}
    | {year: number; month?: number; day?: number}
    | {year: number; month: number; day?: number};

/**
 * This directory takes a (partial) date as input and loads the ObjectData objects for those dates.
 */
export class DateToObjectDataTransformDirectory<T = unknown> extends CachedDirectory<{
    data: ObjectData<T>;
}> {
    private readonly iterator: ChannelIterator<T>;
    private readonly params: DateToObjectDataTransformDirectoryParams;
    private readonly objectDataCache: Map<SHA256Hash<CreationTime>, ObjectData<T>>;

    constructor(iterator: ChannelIterator<T>, params: DateToObjectDataTransformDirectoryParams) {
        super(true);
        this.iterator = iterator;
        this.params = params;
        this.objectDataCache = new Map();
    }

    async *valueIterator(): AsyncIterableIterator<string> {
        let queryOptions: QueryOptions | undefined;

        if (this.params.year === undefined) {
            queryOptions = undefined;
        } else if (this.params.month === undefined) {
            queryOptions = {
                from: new Date(this.params.year, 0, 1, 0, 0, 0, 0),
                to: new Date(this.params.year, 11, 31, 23, 59, 59, 999)
            };
        } else if (this.params.day === undefined) {
            queryOptions = {
                from: new Date(this.params.year, this.params.month - 1, 1, 0, 0, 0, 0),
                // To get the last day of the month we pass 0 as day. This is allowed by the
                // standard:
                // https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-date-constructor
                // 21.4.2.1 Date ( ...values )
                // https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-makeday
                // 21.4.1.15 MakeDay ( year, month, date )
                to: new Date(this.params.year, this.params.month, 0, 23, 59, 59, 999)
            };
        } else {
            queryOptions = {
                from: new Date(
                    this.params.year,
                    this.params.month - 1,
                    this.params.day,
                    0,
                    0,
                    0,
                    0
                ),
                to: new Date(
                    this.params.year,
                    this.params.month - 1,
                    this.params.day,
                    23,
                    59,
                    59,
                    999
                )
            };
        }

        for await (const data of this.iterator(queryOptions)) {
            this.objectDataCache.set(data.creationTimeHash, data);
            yield data.creationTimeHash;
        }
    }

    transformCacheValueToSubDirectoryParams(creationTimeHash: string): {
        data: ObjectData<T>;
    } {
        const data = this.objectDataCache.get(ensureHash<CreationTime>(creationTimeHash));
        if (data === undefined) {
            throw new Error('Internal error: A cached hash is not in the cache!');
        }
        return {data};
    }

    needsUpdate(_creationTimeHash: string, _timeOfEarliestChange: Date): boolean {
        // A hash always points to the same information, so it never needs an update.
        return false;
    }
}
