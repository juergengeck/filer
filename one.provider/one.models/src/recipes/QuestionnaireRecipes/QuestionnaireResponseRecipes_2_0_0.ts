import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import type {Questionnaire_2_1_1 as Questionnaire} from './QuestionnaireRecipes_2_1_1.js';
import {ValueRules} from './QuestionnaireRecipes_2_1_1.js';

export const QuestionnaireResponsesType = 'QuestionnaireResponses_2_0_0';
export const QuestionnaireResponseType = 'QuestionnaireResponse_2_0_0';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        QuestionnaireResponses_2_0_0: QuestionnaireResponses_2_0_0;
    }
}

/**
 * Collection of Questionnaire Responses
 */
export interface QuestionnaireResponses_2_0_0 {
    $type$: 'QuestionnaireResponses_2_0_0';
    name?: string;
    type?: string;
    response: QuestionnaireResponse_2_0_0[];
}

/**
 * An answer item in the questionnaire response
 */
export interface QuestionnaireResponseItem_2_0_0 {
    linkId: string;
    answer: Questionnaire.QuestionnaireValue[];
    item?: QuestionnaireResponseItem_2_0_0[];
}

/**
 * A single FHIR Questionnaire Response
 */
export interface QuestionnaireResponse_2_0_0 {
    resourceType: 'QuestionnaireResponse_2_0_0';
    questionnaire?: string;
    status: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
    item: QuestionnaireResponseItem_2_0_0[];
}

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireResponseRules_2_0_0: RecipeRule[] = [
    // FHIR resource type
    {
        itemprop: 'resourceType',
        itemtype: {type: 'string', regexp: /QuestionnaireResponse_2_0_0/}
    },

    // FHIR(QuestionnaireResponse): Form being answered
    // Note: This is the 'url' field of the questionnaire being answered
    {
        itemprop: 'questionnaire',
        optional: true
    },

    // FHIR(QuestionnaireResponse): in-progress | completed | amended | entered-in-error | stopped - QuestionnaireResponseStatus (Required)
    {
        itemprop: 'status',
        itemtype: {type: 'string', regexp: /in-progress|completed|amended|entered-in-error|stopped/}
    },

    // FHIR(QuestionnaireResponse): Groups and questions
    // + Rule: Nested item can't be beneath both item and answer
    {
        itemprop: 'item',
        itemtype: {
            type: 'array',
            item: {
                type: 'object',
                rules: [
                    // FHIR(QuestionnaireResponse): Pointer to specific item from Questionnaire
                    // Note: This links to the linkId of the specified questionnaire.
                    {
                        itemprop: 'linkId'
                    },

                    // FHIR(QuestionnaireResponse): The response(s) to the question
                    {
                        itemprop: 'answer',
                        itemtype: {type: 'array', item: {type: 'object', rules: ValueRules}}
                    },

                    // FHIR(QuestionnaireResponse): Nested questionnaire response items
                    {
                        itemprop: 'item',
                        inheritFrom: 'QuestionnaireResponses_2_0_0.hotfixdummy',
                        optional: true
                    }
                ]
            }
        }
    }
];

export const QuestionnaireResponsesRecipe_2_0_0: Recipe = {
    $type$: 'Recipe',
    name: 'QuestionnaireResponses_2_0_0',
    rule: [
        // Here you can give the collection of responses a name
        // Some applications might use this for users to specify a name so they can
        // more easily find it again.
        {
            itemprop: 'name',
            optional: true
        },

        // Give this collection a type.
        // This is used by applications to e.g. give certain collections a special type
        // For one project, the type is something like 'initial questions', 'follow up' ...
        {
            itemprop: 'type',
            optional: true
        },

        // The responses
        {
            itemprop: 'response',
            itemtype: {
                type: 'array',
                item: {type: 'object', rules: QuestionnaireResponseRules_2_0_0}
            }
        },

        // Hotfix for an inheritance bug in one.core. Do not use this field. Just for inheritance.
        {
            itemprop: 'hotfixdummy',
            itemtype: {
                type: 'array',
                item: {
                    type: 'object',
                    rules: [
                        // FHIR(QuestionnaireResponse): Pointer to specific item from Questionnaire
                        // Note: This links to the linkId of the specified questionnaire.
                        {
                            itemprop: 'linkId'
                        },

                        // FHIR(QuestionnaireResponse): The response(s) to the question
                        {
                            itemprop: 'answer',
                            itemtype: {type: 'array', item: {type: 'object', rules: ValueRules}}
                        },

                        // FHIR(QuestionnaireResponse): Nested questionnaire response items
                        {
                            itemprop: 'item',
                            inheritFrom: 'QuestionnaireResponses_2_0_0.hotfixdummy',
                            optional: true
                        }
                    ]
                }
            },
            optional: true
        }
    ]
};

const QuestionnaireResponsesRecipes_2_0_0: Recipe[] = [QuestionnaireResponsesRecipe_2_0_0];
export default QuestionnaireResponsesRecipes_2_0_0;
