import type {ObjectData, QueryOptions} from '../../../models/ChannelManager.js';

export type ChannelIterator<T = unknown> = (
    queryOptions?: QueryOptions
) => AsyncIterableIterator<ObjectData<T>>;
