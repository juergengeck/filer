import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';
import {
    CodingRules,
    QuestionnaireRules as QuestionnaireRules_1_0_0
} from './QuestionnaireRecipes_1_0_0.js';
import type {Questionnaire} from './QuestionnaireRecipes_1_0_0.js';
import {addRule, cloneRule, overwriteRule} from '../RecipeUtils.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Questionnaire_1_1_0: Questionnaire_1_1_0;
    }
}
/**
 * FHIR Questionnaire type
 */
export interface Questionnaire_1_1_0 extends Omit<Questionnaire, '$type$' | 'item'> {
    $type$: 'Questionnaire_1_1_0';
    item: Questionnaire_1_1_0.Question[];
}

export module Questionnaire_1_1_0 {
    /**
     * Question of a questionnaire.
     */
    export type Question = Omit<Questionnaire.Question, 'item'> & {
        answerRestriction?: AnswerRestriction;
        item?: Question[];
    };

    /**
     * Used to specify min and max value for an answer.
     */
    export type QuestionnaireAnswerMinMaxValue = {
        valueInteger?: string;
        valueDate?: string; // can also be 'now'
        valueTime?: string;
        valueString?: string;
        valueCoding?: Coding;
    };

    /**
     * Represents the restriction that will be applied to an answer.
     */
    export type AnswerRestriction = {
        minValue?: QuestionnaireAnswerMinMaxValue;
        minInclusive?: boolean; // default = true
        maxValue?: QuestionnaireAnswerMinMaxValue;
        maxInclusive?: boolean; // default = true
    };

    /**
     * FHIR Coding type for encoding coded values.
     */
    export type Coding = Questionnaire.Coding;

    /**
     * Type for the enable when compare value of questionnaires.
     */
    export type QuestionnaireEnableWhenAnswer = Questionnaire.QuestionnaireEnableWhenAnswer;

    /**
     * Type for answer option values of questionnaires.
     */
    export type QuestionnaireAnswerOptionValue = Questionnaire.QuestionnaireEnableWhenAnswer;

    /**
     * Type of questionnaire answers and initial values.
     */
    export type QuestionnaireValue = Questionnaire.QuestionnaireValue;
}

/**
 * Values for custom extension to specify restrictions on answers
 */
export const QuestionnaireAnswerMinMaxValueRule: RecipeRule[] = [
    {
        itemprop: 'valueInteger',
        itemtype: {type: 'string', regexp: /[0]|[-+]?[1-9][0-9]*/},
        optional: true
    },
    {
        itemprop: 'valueDate',
        itemtype: {
            type: 'string',
            regexp: /(([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?)|(^now$)/
        },
        optional: true
    },
    {
        itemprop: 'valueTime',
        itemtype: {
            type: 'string',
            regexp: /([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?/
        },
        optional: true
    },
    {
        itemprop: 'valueString',
        optional: true
    },
    {
        itemprop: 'valueCoding',
        itemtype: {type: 'object', rules: CodingRules},
        optional: true
    }
];

/**
 * Custom extension to specify restrictions on answers
 */
export const AnswerRestrictionRule: RecipeRule[] = [
    {
        itemprop: 'minValue',
        itemtype: {type: 'object', rules: QuestionnaireAnswerMinMaxValueRule},
        optional: true
    },
    {
        itemprop: 'minInclusive',
        itemtype: {type: 'boolean'},
        optional: true
    },
    {
        itemprop: 'maxValue',
        itemtype: {type: 'object', rules: QuestionnaireAnswerMinMaxValueRule},
        optional: true
    },
    {
        itemprop: 'maxInclusive',
        itemtype: {type: 'boolean'},
        optional: true
    }
];

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireRules: RecipeRule[] = cloneRule(QuestionnaireRules_1_0_0);
overwriteRule(QuestionnaireRules, 'item', {
    itemprop: 'item',
    inheritFrom: 'Questionnaire_1_1_0.item',
    optional: true
});

addRule(QuestionnaireRules, 'item', {
    itemprop: 'answerRestriction',
    itemtype: {type: 'object', rules: AnswerRestrictionRule},
    optional: true
});

/**
 * Recipe for questionnaires based upon FHIR standard.
 *
 * @type {{name: string; rule: RecipeRule[]; $type$: string}}
 */
export const QuestionnaireRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Questionnaire_1_1_0',
    rule: QuestionnaireRules
};

const QuestionnaireRecipes: Recipe[] = [QuestionnaireRecipe];
export default QuestionnaireRecipes;
