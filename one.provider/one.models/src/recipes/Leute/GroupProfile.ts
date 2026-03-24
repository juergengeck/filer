import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {BLOB, Group, Recipe} from '@refinio/one.core/lib/recipes.js';

// #### Typescript interfaces ####

export interface GroupProfile {
    $type$: 'GroupProfile';
    $versionHash$?: SHA256Hash<VersionNode>;
    group: SHA256IdHash<Group>;
    name: string;
    picture: SHA256Hash<BLOB>;
}

// #### Recipes ####

export const GroupProfileRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'GroupProfile',
    rule: [
        {
            itemprop: 'group',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Group'])},
            isId: true
        },
        {
            itemprop: 'name',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'picture',
            itemtype: {type: 'referenceToBlob'}
        }
    ]
};

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        GroupProfile: GroupProfile;
    }

    export interface OneIdObjectInterfaces {
        GroupProfile: Pick<GroupProfile, '$type$' | 'group'>;
    }
}

export default [GroupProfileRecipe];
