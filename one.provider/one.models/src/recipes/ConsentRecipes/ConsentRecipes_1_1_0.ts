import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

import {cloneRule} from '../RecipeUtils.js';
import type {BlobDescriptor} from '../BlobRecipes.js';
import ConsentRecipes_1_0_0 from './ConsentRecipes_1_0_0.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Consent_1_1_0: Consent_1_1_0;
    }
}

export interface Consent_1_1_0 {
    $type$: 'Consent_1_1_0';
    fileReference?: SHA256Hash<BlobDescriptor>;
    status: 'given' | 'revoked';
    isoStringDate: string;
    text?: string;
}

const ConsentRecipeRules_1_1_0: RecipeRule[] = cloneRule(ConsentRecipes_1_0_0[0].rule);

ConsentRecipeRules_1_1_0.push({
    itemprop: 'text',
    itemtype: {type: 'string'},
    optional: true
});

const fileRefIndex = ConsentRecipeRules_1_1_0.findIndex(r => r.itemprop === 'fileReference');
ConsentRecipeRules_1_1_0[fileRefIndex].optional = true;

/**
 * @type {{name: string; rule: RecipeRule[]; $type$: string}}
 */
export const ConsentRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Consent_1_1_0',
    rule: ConsentRecipeRules_1_1_0
};

const ConsentRecipes: Recipe[] = [ConsentRecipe];

export default ConsentRecipes;
