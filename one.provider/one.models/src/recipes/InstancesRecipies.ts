import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Instance, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

declare module '@OneObjectInterfaces' {
    export interface OneIdObjectInterfaces {
        LocalInstancesList: Pick<LocalInstancesList, 'id' | '$type$'>;
    }

    export interface OneVersionedObjectInterfaces {
        LocalInstancesList: LocalInstancesList;
    }
}

export interface LocalInstancesList {
    $type$: 'LocalInstancesList';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: string;
    instances: {instance: SHA256IdHash<Instance>}[];
}

const LocalInstancesListRecipie: Recipe = {
    $type$: 'Recipe',
    name: 'LocalInstancesList',
    rule: [
        {
            itemprop: 'id',
            itemtype: {type: 'string', regexp: /^LocalInstancesList$/},
            isId: true
        },
        {
            itemprop: 'instances',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        {
                            itemprop: 'instance',
                            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Instance'])}
                        }
                    ]
                }
            }
        }
    ]
};

const InstancesRecipes: Recipe[] = [LocalInstancesListRecipie];

export default InstancesRecipes;
