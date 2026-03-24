import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Person, Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Profile} from './Profile.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

// #### Typescript interfaces ####

export interface Someone {
    $type$: 'Someone';
    $versionHash$?: SHA256Hash<VersionNode>;
    someoneId: string;
    mainProfile: SHA256IdHash<Profile>;
    identities: Map<SHA256IdHash<Person>, Set<SHA256IdHash<Profile>>>;
}

// #### Recipes ####

export const SomeoneRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Someone',
    crdtConfig: new Map(),
    rule: [
        {
            itemprop: 'someoneId',
            isId: true
        },
        {
            itemprop: 'mainProfile',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Profile'])}
        },
        {
            itemprop: 'identities',
            itemtype: {
                type: 'map',
                key: {
                    type: 'referenceToId',
                    allowedTypes: new Set(['Person'])
                },
                value: {
                    type: 'set',
                    item: {type: 'referenceToId', allowedTypes: new Set(['Profile'])}
                }
            }
        }
    ]
};

// #### Reverse maps ####

export const SomeoneReverseMaps: [OneObjectTypeNames, Set<string>][] = [
    ['Someone', new Set(['*'])]
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        Someone: Someone;
    }

    export interface OneIdObjectInterfaces {
        Someone: Pick<Someone, '$type$' | 'someoneId'>;
    }
}

export default [SomeoneRecipe];
