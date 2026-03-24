import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import type {Questionnaire} from './QuestionnaireRecipes_1_0_0.js';
import {ValueRules} from './QuestionnaireRecipes_1_0_0.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        QuestionnaireResponses: QuestionnaireResponses;
    }
}

/**
 * Collection of Questionnaire Responses
 */
export interface QuestionnaireResponses {
    $type$: 'QuestionnaireResponses';
    name?: string;
    type?: string;
    response: QuestionnaireResponse[];
}

/**
 * An answer item in the questionnaire response
 */
export interface QuestionnaireResponseItem {
    linkId: string;
    answer: Questionnaire.QuestionnaireValue[];
    item?: QuestionnaireResponseItem[];
}

/**
 * A single FHIR Questionnaire Response
 */
export interface QuestionnaireResponse {
    resourceType: 'QuestionnaireResponse';
    questionnaire?: string;
    status: 'in-progress' | 'completed' | 'amended' | 'entered-in-error' | 'stopped';
    item: QuestionnaireResponseItem[];
}

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireResponseRules: RecipeRule[] = [
    // FHIR resource type
    {
        itemprop: 'resourceType',
        itemtype: {type: 'string', regexp: /QuestionnaireResponse/}
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
                        inheritFrom: 'QuestionnaireResponses.hotfixdummy',
                        optional: true
                    }
                ]
            }
        }
    }
];

export const QuestionnaireResponsesRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'QuestionnaireResponses',
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
            itemtype: {type: 'array', item: {type: 'object', rules: QuestionnaireResponseRules}}
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
                            inheritFrom: 'QuestionnaireResponses.hotfixdummy',
                            optional: true
                        }
                    ]
                }
            },
            optional: true
        }
    ]
};

const QuestionnaireResponsesRecipes: Recipe[] = [QuestionnaireResponsesRecipe];
export default QuestionnaireResponsesRecipes;
