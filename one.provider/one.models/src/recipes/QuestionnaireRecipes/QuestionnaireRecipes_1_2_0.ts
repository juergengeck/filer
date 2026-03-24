import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import {
    QuestionnaireRules as QuestionnaireRules_1_0_0,
    ValueRules as ValueRules_1_0_0
} from './QuestionnaireRecipes_1_0_0.js';
import type {Questionnaire_1_1_0} from './QuestionnaireRecipes_1_1_0.js';
import {cloneRule, overwriteRule} from '../RecipeUtils.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Questionnaire_1_2_0: Questionnaire_1_2_0;
    }
}

/**
 * FHIR Questionnaire type
 */
export interface Questionnaire_1_2_0 extends Omit<Questionnaire_1_1_0, '$type$' | 'item'> {
    $type$: 'Questionnaire_1_2_0';
    item: Questionnaire_1_2_0.Question[];
}

export module Questionnaire_1_2_0 {
    /**
     * Question of a questionnaire.
     */
    export type Question = Omit<Questionnaire_1_1_0.Question, 'item' | 'initial'> & {
        initial?: QuestionnaireValue[];
        item?: Question[];
    };

    /**
     * Used to specify min and max value for an answer.
     */
    export type QuestionnaireAnswerMinMaxValue = Questionnaire_1_1_0.QuestionnaireAnswerMinMaxValue;

    /**
     * Represents the restriction that will be applied to an answer.
     */
    export type AnswerRestriction = Questionnaire_1_1_0.AnswerRestriction;

    /**
     * FHIR Coding type for encoding coded values.
     */
    export type Coding = Questionnaire_1_1_0.Coding;

    /**
     * Type for the enable when compare value of questionnaires.
     */
    export type QuestionnaireEnableWhenAnswer = Questionnaire_1_1_0.QuestionnaireEnableWhenAnswer;

    /**
     * Type for answer option values of questionnaires.
     */
    export type QuestionnaireAnswerOptionValue = Questionnaire_1_1_0.QuestionnaireEnableWhenAnswer;

    /**
     * Type of questionnaire answers and initial values.
     */
    export type QuestionnaireValue = Questionnaire_1_1_0.QuestionnaireValue & {
        valueAttachment?: Attachment;
    };
}

export type Attachment = {
    contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; // Mime type of the content, with charset etc.
    language?: string; // Human language of the content (BCP-47)
    data: string; // Data inline, base64ed
    // url?: string; // Uri where the data can be found
    // size?: bigint; // Number of bytes of content (if url provided)
    // hash?: string; // Hash of the data (sha-1, base64ed)
    title?: string; // Label to display in place of the data
    creation?: string; // Date attachment was first created
};

export const AtachmentRules: RecipeRule[] = [
    {
        itemprop: 'contentType',
        itemtype: {type: 'string', regexp: /^(image\/png|image\/jpeg|image\/webp|image\/gif)$/},
        optional: false
    },
    {
        itemprop: 'language',
        optional: true
    },
    {
        itemprop: 'data',
        optional: false
    },
    {
        itemprop: 'title',
        optional: true
    },
    {
        itemprop: 'creation',
        itemtype: {
            type: 'string',
            regexp: /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?/
        },
        optional: true
    }
];

export const ValueRules = cloneRule(ValueRules_1_0_0);
// FHIR Type: Attachment
ValueRules.push({
    itemprop: 'valueAttachment',
    itemtype: {type: 'object', rules: AtachmentRules},
    optional: true
});

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireRules: RecipeRule[] = cloneRule(QuestionnaireRules_1_0_0);
overwriteRule(QuestionnaireRules, 'item', {
    itemprop: 'item',
    inheritFrom: 'Questionnaire_1_2_0.item',
    optional: true
});
overwriteRule(QuestionnaireRules, 'item', {
    itemprop: 'initial',
    itemtype: {
        type: 'bag',
        item: {
            type: 'object',
            rules: ValueRules
        }
    },
    optional: true
});

/**
 * Recipe for questionnaires based upon FHIR standard.
 *
 * @type {{name: string; rule: RecipeRule[]; $type$: string}}
 */
export const QuestionnaireRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Questionnaire_1_2_0',
    rule: QuestionnaireRules
};

const QuestionnaireRecipes: Recipe[] = [QuestionnaireRecipe];
export default QuestionnaireRecipes;
