import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {IoMRequest} from './IoMRequest.js';

// #### Typescript interfaces ####

/**
 * This is a global collection of all people known to the user.
 */
export interface IoMRequestsRegistry {
    $type$: 'IoMRequestsRegistry';
    $versionHash$?: SHA256Hash<VersionNode>;
    appId: 'one.iom';
    requests: Set<SHA256Hash<IoMRequest>>;
}

// #### Recipes ####

export const IoMRequestsRegistryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'IoMRequestsRegistry',
    rule: [
        {
            itemprop: 'appId',
            itemtype: {type: 'string', regexp: /^one.iom$/},
            isId: true
        },
        {
            itemprop: 'requests',
            itemtype: {
                type: 'set',
                item: {type: 'referenceToObj', allowedTypes: new Set(['IoMRequest'])}
            }
        }
    ]
};

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneVersionedObjectInterfaces {
        IoMRequestsRegistry: IoMRequestsRegistry;
    }

    export interface OneIdObjectInterfaces {
        IoMRequestsRegistry: Pick<IoMRequestsRegistry, '$type$' | 'appId'>;
    }
}

export default [IoMRequestsRegistryRecipe];
