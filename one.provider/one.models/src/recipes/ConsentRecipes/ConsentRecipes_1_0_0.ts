import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {BlobDescriptor} from '../BlobRecipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Consent: Consent;
    }
}

export interface Consent {
    $type$: 'Consent';
    fileReference: SHA256Hash<BlobDescriptor>;
    status: 'given' | 'revoked';
    isoStringDate: string;
}

const ConsentRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Consent',
    rule: [
        {
            itemprop: 'fileReference',
            itemtype: {
                type: 'referenceToObj',
                allowedTypes: new Set(['BlobDescriptor'])
            },
            optional: true
        },
        {
            itemprop: 'status',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'isoStringDate',
            itemtype: {type: 'string'}
        }
    ]
};

const ConsentRecipes: Recipe[] = [ConsentRecipe];

export default ConsentRecipes;
