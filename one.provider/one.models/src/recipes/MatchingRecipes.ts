import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Person, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Supply: Supply;
        Demand: Demand;
        MatchResponse: MatchResponse;
    }

    export interface OneIdObjectInterfaces {
        SupplyMap: Pick<SupplyMap, '$type$' | 'name'>;
        DemandMap: Pick<DemandMap, '$type$' | 'name'>;
        MatchMap: Pick<MatchMap, '$type$' | 'name'>;
        NotifiedUsers: Pick<NotifiedUsers, '$type$' | 'name'>;
    }

    export interface OneVersionedObjectInterfaces {
        SupplyMap: SupplyMap;
        DemandMap: DemandMap;
        MatchMap: MatchMap;
        NotifiedUsers: NotifiedUsers;
    }
}

/**
 * @typedef {object} MatchResponse
 * @property {'MatchResponse'} type
 * @property {string} identity
 * @property {string} match
 */
export interface MatchResponse {
    $type$: 'MatchResponse';
    identity: string;
    match: string;
    identityOfDemand: boolean;
    creationTimestamp: number;
}

/**
 * @typedef {object} Supply
 * @property {'Supply'} type
 * @property {string} identity
 * @property {string} match
 * @property {number} timestamp
 */
export interface Supply {
    $type$: 'Supply';
    identity: string;
    match: string;
    isActive: boolean;
    timestamp: number;
}

/**
 * @typedef {object} Demand
 * @property {'Demand'} type
 * @property {string} identity
 * @property {string} match
 * @property {number} timestamp
 */
export interface Demand {
    $type$: 'Demand';
    identity: string;
    match: string;
    isActive: boolean;
    timestamp: number;
}

/**
 * @typedef {object} SupplyMap
 * @property {'SupplyMap'} type
 * @property {string} name
 * @property {Map<string, Supply>} map
 */
export interface SupplyMap {
    $type$: 'SupplyMap';
    $versionHash$?: SHA256Hash<VersionNode>;
    name: string;
    map?: Map<string, Supply[]>;
}

/**
 * @typedef {object} DemandMap
 * @property {'DemandMap'} type
 * @property {string} name
 * @property {Map<string, Demand>} map
 */
export interface DemandMap {
    $type$: 'DemandMap';
    $versionHash$?: SHA256Hash<VersionNode>;
    name: string;
    map?: Map<string, Demand[]>;
}

/**
 * @typedef {object} MatchMap
 * @property {'MatchMap'} type
 * @property {string} name
 * @property {SHA256Hash<MatchResponse>[]} array
 */
export interface MatchMap {
    $type$: 'MatchMap';
    $versionHash$?: SHA256Hash<VersionNode>;
    name: string;
    array?: SHA256Hash<MatchResponse>[];
}

/**
 * @typedef {object} NotifiedUsers
 * @property {'NotifiedUsers'} type
 * @property {string} name
 * @property {Set<string>} set
 *
 * in set we keep the identities of all notified users and
 * their match string with which the match was made
 */
export interface NotifiedUsers {
    $type$: 'NotifiedUsers';
    $versionHash$?: SHA256Hash<VersionNode>;
    name: string;
    existingMatches?: Map<SHA256IdHash<Person>, Set<SHA256Hash<MatchResponse>>>;
}

export const SupplyRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Supply',
    rule: [
        {
            itemprop: 'identity',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'match',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'isActive',
            itemtype: {type: 'boolean'}
        },
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        }
    ]
};

export const DemandRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Demand',
    rule: [
        {
            itemprop: 'identity',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'match',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'isActive',
            itemtype: {type: 'boolean'}
        },
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        }
    ]
};

export const SupplyMapRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SupplyMap',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'map',
            itemtype: {type: 'map', key: {type: 'string'}, value: {type: 'stringifiable'}}
        }
    ]
};

export const DemandMapRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'DemandMap',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'map',
            itemtype: {type: 'map', key: {type: 'string'}, value: {type: 'stringifiable'}}
        }
    ]
};

export const MatchingResponseRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'MatchResponse',
    rule: [
        {
            itemprop: 'identity',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'match',
            itemtype: {type: 'string'}
        },
        {
            // will be true if the above identity belongs to
            // the person who has send the Demand object
            itemprop: 'identityOfDemand',
            itemtype: {type: 'boolean'}
        },
        {
            itemprop: 'creationTimestamp',
            itemtype: {type: 'number'}
        }
    ]
};

export const MatchMapRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'MatchMap',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'array',
            itemtype: {
                type: 'bag',
                item: {type: 'referenceToObj', allowedTypes: new Set(['MatchResponse'])}
            }
        }
    ]
};

export const NotifiedUsersRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'NotifiedUsers',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            // map with destination person id hash as key and set
            // with hashes of sent MatchResponse objects as value
            itemprop: 'existingMatches',
            itemtype: {type: 'map', key: {type: 'string'}, value: {type: 'stringifiable'}},
            optional: true
        }
    ]
};

const MatchingRecipes: Recipe[] = [
    SupplyRecipe,
    DemandRecipe,
    SupplyMapRecipe,
    DemandMapRecipe,
    MatchingResponseRecipe,
    MatchMapRecipe,
    NotifiedUsersRecipe
];

export default MatchingRecipes;
