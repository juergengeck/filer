import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Person, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {CreationTime} from './MetaRecipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        LinkedListEntry: LinkedListEntry;
    }

    export interface OneIdObjectInterfaces {
        ChannelInfo: Pick<ChannelInfo, 'id' | 'owner' | '$type$'>;
        ChannelRegistry: Pick<ChannelRegistry, 'id' | '$type$'>;
    }

    export interface OneVersionedObjectInterfaces {
        ChannelInfo: ChannelInfo;
        ChannelRegistry: ChannelRegistry;
    }
}

export interface LinkedListEntry {
    $type$: 'LinkedListEntry';
    data: SHA256Hash<CreationTime>;
    metadata?: Array<SHA256Hash>;
    previous?: SHA256Hash<LinkedListEntry>;
}

export interface ChannelInfo {
    $type$: 'ChannelInfo';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    owner?: SHA256IdHash<Person>;
    head?: SHA256Hash<LinkedListEntry>;
}

export interface ChannelRegistry {
    $type$: 'ChannelRegistry';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: 'ChannelRegistry';
    channels: Set<SHA256IdHash<ChannelInfo>>;
}

export const ChannelEntryRecipie: Recipe = {
    $type$: 'Recipe',
    name: 'LinkedListEntry',
    rule: [
        {
            itemprop: 'data',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['CreationTime'])}
        },
        {
            itemprop: 'metadata',
            itemtype: {
                type: 'bag',
                item: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
            },
            optional: true
        },
        {
            itemprop: 'previous',
            optional: true,
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['LinkedListEntry'])}
        }
    ]
};

export const ChannelInfoRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ChannelInfo',
    crdtConfig: new Map([['head#referenceToObj', 'LinkedListCrdtAlgorithm']]),
    rule: [
        {
            itemprop: 'id',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'owner',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])},
            isId: true,
            optional: true
        },
        {
            itemprop: 'head',
            optional: true,
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['LinkedListEntry'])}
        }
    ]
};

export const ChannelRegistryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ChannelRegistry',
    rule: [
        {
            itemprop: 'id',
            itemtype: {type: 'string', regexp: /^ChannelRegistry$/},
            isId: true
        },
        {
            itemprop: 'channels',
            itemtype: {
                type: 'set',
                item: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['ChannelInfo'])
                }
            }
        }
    ]
};

const ChannelRecipes: Recipe[] = [ChannelEntryRecipie, ChannelInfoRecipe, ChannelRegistryRecipe];

export default ChannelRecipes;
