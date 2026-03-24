import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        CreationTime: CreationTime;
    }
}

export interface CreationTime {
    $type$: 'CreationTime';
    timestamp: number;
    data: SHA256Hash;
}

const CreationTimeRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'CreationTime',
    rule: [
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'data',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
        }
    ]
};

const MetaRecipes: Recipe[] = [CreationTimeRecipe];

export default MetaRecipes;
