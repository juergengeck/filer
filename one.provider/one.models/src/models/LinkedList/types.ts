import type {OneObjectTypes} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {LinkedListEntry} from '../../recipes/ChannelRecipes.js';
import type {CreationTime} from '../../recipes/MetaRecipes.js';

/**
 * This type is returned by the raw channel iterator
 */
export type LinkedListRawEntry = {
    linkedListEntryHash: SHA256Hash<LinkedListEntry>;
    creationTimeHash: SHA256Hash<CreationTime>;
    creationTime: number;
    dataHash: SHA256Hash<OneObjectTypes>;
    metaDataHashes?: Array<SHA256Hash>;
};

/**
 * This type is returned by the raw channel iterator
 */
export type LinkedListNewEntry = {
    creationTimeHash: SHA256Hash<CreationTime>;
    creationTime: number;
    metaDataHashes?: Array<SHA256Hash>;
};

export function isLinkedListNewEntry(
    entry: LinkedListRawEntry | LinkedListNewEntry
): entry is LinkedListNewEntry {
    return !Object.hasOwn(entry, 'linkedListEntryHash');
}

export function isLinkedListRawEntry(
    entry: LinkedListRawEntry | LinkedListNewEntry
): entry is LinkedListRawEntry {
    return Object.hasOwn(entry, 'linkedListEntryHash');
}
