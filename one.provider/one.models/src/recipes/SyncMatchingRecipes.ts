import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Instance, Person, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

export type SyncTrustLevel = 'public' | 'known-key' | 'affirmed' | 'delegated' | 'inner-circle';

export type SyncTrieName = 'sync' | 'time' | 'subject' | 'devices';

export type SyncSelectorKind = 'exact' | 'prefix' | 'subject' | 'topic' | 'device' | 'path';

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        ScopedTrieRoot: Pick<ScopedTrieRoot, '$type$' | 'id'>;
        SyncDemand: Pick<SyncDemand, '$type$' | 'id'>;
        SyncSupply: Pick<SyncSupply, '$type$' | 'id'>;
        SyncMatch: Pick<SyncMatch, '$type$' | 'id'>;
    }

    export interface OneVersionedObjectInterfaces {
        ScopedTrieRoot: ScopedTrieRoot;
        SyncDemand: SyncDemand;
        SyncSupply: SyncSupply;
        SyncMatch: SyncMatch;
    }
}

export type ScopedTrieRoot = {
    $type$: 'ScopedTrieRoot';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    owner: SHA256IdHash<Person>;
    contentType: string;
    selectorKind: SyncSelectorKind;
    selector: string;
    trie: SyncTrieName;
    subjectId?: string;
    root?: string;
    rootId?: string;
};

export type SyncDemand = {
    $type$: 'SyncDemand';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    owner: SHA256IdHash<Person>;
    instanceId: SHA256IdHash<Instance>;
    contentType: string;
    selectorKind: SyncSelectorKind;
    selector: string;
    trie: SyncTrieName;
    subjectId?: string;
    minTrustLevel: SyncTrustLevel;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
};

export type SyncSupply = {
    $type$: 'SyncSupply';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    owner: SHA256IdHash<Person>;
    instanceId: SHA256IdHash<Instance>;
    contentType: string;
    selectorKind: SyncSelectorKind;
    selector: string;
    trie: SyncTrieName;
    subjectId?: string;
    scopedRoot: SHA256IdHash<ScopedTrieRoot>;
    minTrustLevel: SyncTrustLevel;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
};

export type SyncMatch = {
    $type$: 'SyncMatch';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    demand: SHA256IdHash<SyncDemand>;
    supply: SHA256IdHash<SyncSupply>;
    scopedRoot: SHA256IdHash<ScopedTrieRoot>;
    grantedBy: SHA256IdHash<Person>;
    grantedTo: SHA256IdHash<Person>;
    trustLevel: SyncTrustLevel;
    createdAt: number;
};

const TRUST_LEVEL_REGEXP = /^(public|known-key|affirmed|delegated|inner-circle)$/;
const TRIE_NAME_REGEXP = /^(sync|time|subject|devices)$/;
const SELECTOR_KIND_REGEXP = /^(exact|prefix|subject|topic|device|path)$/;
const HEX_64_REGEXP = /^[0-9a-f]{64}$/;

export const ScopedTrieRootRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ScopedTrieRoot',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'owner',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'contentType',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'selectorKind',
            itemtype: {type: 'string', regexp: SELECTOR_KIND_REGEXP}
        },
        {
            itemprop: 'selector',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'trie',
            itemtype: {type: 'string', regexp: TRIE_NAME_REGEXP}
        },
        {
            itemprop: 'subjectId',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'root',
            itemtype: {type: 'string', regexp: HEX_64_REGEXP},
            optional: true
        },
        {
            itemprop: 'rootId',
            itemtype: {type: 'string', regexp: HEX_64_REGEXP},
            optional: true
        }
    ]
};

export const SyncDemandRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SyncDemand',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'owner',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'instanceId',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Instance'])}
        },
        {
            itemprop: 'contentType',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'selectorKind',
            itemtype: {type: 'string', regexp: SELECTOR_KIND_REGEXP}
        },
        {
            itemprop: 'selector',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'trie',
            itemtype: {type: 'string', regexp: TRIE_NAME_REGEXP}
        },
        {
            itemprop: 'subjectId',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'minTrustLevel',
            itemtype: {type: 'string', regexp: TRUST_LEVEL_REGEXP}
        },
        {
            itemprop: 'isActive',
            itemtype: {type: 'boolean'}
        },
        {
            itemprop: 'createdAt',
            itemtype: {type: 'integer'}
        },
        {
            itemprop: 'updatedAt',
            itemtype: {type: 'integer'}
        }
    ]
};

export const SyncSupplyRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SyncSupply',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'owner',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'instanceId',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Instance'])}
        },
        {
            itemprop: 'contentType',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'selectorKind',
            itemtype: {type: 'string', regexp: SELECTOR_KIND_REGEXP}
        },
        {
            itemprop: 'selector',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'trie',
            itemtype: {type: 'string', regexp: TRIE_NAME_REGEXP}
        },
        {
            itemprop: 'subjectId',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'scopedRoot',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['ScopedTrieRoot'])}
        },
        {
            itemprop: 'minTrustLevel',
            itemtype: {type: 'string', regexp: TRUST_LEVEL_REGEXP}
        },
        {
            itemprop: 'isActive',
            itemtype: {type: 'boolean'}
        },
        {
            itemprop: 'createdAt',
            itemtype: {type: 'integer'}
        },
        {
            itemprop: 'updatedAt',
            itemtype: {type: 'integer'}
        }
    ]
};

export const SyncMatchRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SyncMatch',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'demand',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['SyncDemand'])}
        },
        {
            itemprop: 'supply',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['SyncSupply'])}
        },
        {
            itemprop: 'scopedRoot',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['ScopedTrieRoot'])}
        },
        {
            itemprop: 'grantedBy',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'grantedTo',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'trustLevel',
            itemtype: {type: 'string', regexp: TRUST_LEVEL_REGEXP}
        },
        {
            itemprop: 'createdAt',
            itemtype: {type: 'integer'}
        }
    ]
};

const SyncMatchingRecipes: Recipe[] = [
    ScopedTrieRootRecipe,
    SyncDemandRecipe,
    SyncSupplyRecipe,
    SyncMatchRecipe
];

export default SyncMatchingRecipes;
