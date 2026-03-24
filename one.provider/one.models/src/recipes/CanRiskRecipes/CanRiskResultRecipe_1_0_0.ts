import type {Person, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {QuestionnaireResponsesHash} from '../QuestionnaireRecipes/QuestionnaireResponseRecipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        CanRiskResult: CanRiskResult;
    }
}

export interface CanRiskResult {
    $type$: 'CanRiskResult';
    result: string;
    ownerIdHash: SHA256IdHash<Person>;
    questionnaireResponsesHash?: QuestionnaireResponsesHash;
}

export const CanRiskResultRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'CanRiskResult',
    rule: [
        {
            itemprop: 'ownerIdHash', // patientId
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'questionnaireResponsesHash',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['QuestionnaireResponses'])},
            optional: true
        },
        {
            itemprop: 'result',
            itemtype: {type: 'string'}
        }
    ]
};

const CanRiskRecipes: Recipe[] = [CanRiskResultRecipe];

export default CanRiskRecipes;
