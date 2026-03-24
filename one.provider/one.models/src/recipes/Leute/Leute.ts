import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Group, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Someone} from './Someone.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

// #### Typescript interfaces ####

/**
 * This is a global collection of all people known to the user.
 */
export interface Leute {
    $type$: 'Leute';
    $versionHash$?: SHA256Hash<VersionNode>;
    appId: 'one.leute';
    me: SHA256IdHash<Someone>;
    other: SHA256IdHash<Someone>[];
    group: SHA256IdHash<Group>[];
}

// #### Recipes ####

export const LeuteRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Leute',
    rule: [
        {
            itemprop: 'appId',
            itemtype: {type: 'string', regexp: /^one.leute$/},
            isId: true
        },
        {
            itemprop: 'me',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Someone'])}
        },
        {
            itemprop: 'other',
            itemtype: {
                type: 'bag',
                item: {type: 'referenceToId', allowedTypes: new Set(['Someone'])}
            }
        },
        {
            itemprop: 'group',
            itemtype: {
                type: 'bag',
                item: {type: 'referenceToId', allowedTypes: new Set(['GroupProfile'])}
            }
        }
    ]
};

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        Leute: Leute;
    }

    export interface OneIdObjectInterfaces {
        Leute: Pick<Leute, '$type$' | 'appId'>;
    }
}

export default [LeuteRecipe];
