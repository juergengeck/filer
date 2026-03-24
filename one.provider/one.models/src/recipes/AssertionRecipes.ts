import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {Person, Instance} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Assertion: Assertion;
    }
}

export interface Assertion {
    $type$: 'Assertion';
    target: SHA256Hash | SHA256IdHash;
    assertedBy: SHA256IdHash<Person>;
    instanceId: SHA256IdHash<Instance>;
    signature?: string;
    createdAt: number;
    expiresAt?: number;
}

export const AssertionRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Assertion',
    rule: [
        {
            itemprop: 'target',
            itemtype: {
                type: 'string',
                regexp: /^[0-9a-f]{64}$/
            },
            isId: true
        },
        {
            itemprop: 'assertedBy',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person'])
            }
        },
        {
            itemprop: 'instanceId',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Instance'])
            }
        },
        {
            itemprop: 'signature',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'createdAt',
            itemtype: {type: 'integer'}
        },
        {
            itemprop: 'expiresAt',
            itemtype: {type: 'integer'},
            optional: true
        }
    ]
};

const AssertionRecipes: Recipe[] = [AssertionRecipe];

export default AssertionRecipes;