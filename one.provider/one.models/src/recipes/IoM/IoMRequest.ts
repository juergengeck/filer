import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person, Recipe} from '@refinio/one.core/lib/recipes.js';

// #### Typescript interfaces ####

export interface IoMRequest {
    $type$: 'IoMRequest';
    timestamp: number;
    initiator: SHA256IdHash<Person>;
    mainId: SHA256IdHash<Person>;
    alternateId: SHA256IdHash<Person>;
    mode: 'full' | 'light';
}

// #### Recipes ####

export const IoMRequestRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'IoMRequest',
    rule: [
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'initiator',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'mainId',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'alternateId',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'mode',
            itemtype: {type: 'string', regexp: /^(full|light)$/}
        }
    ]
};

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        IoMRequest: IoMRequest;
    }
}

export default [IoMRequestRecipe];
