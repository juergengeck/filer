/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable no-redeclare */
import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';

import {QuestionnaireRules as QuestionnaireRules_2_0_0} from './QuestionnaireRecipes_2_0_0.js';
import type {Questionnaire_2_0_0} from './QuestionnaireRecipes_2_0_0.js';
import {addRule, cloneRule, overwriteRule} from '../RecipeUtils.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Questionnaire_2_1_0: Questionnaire_2_1_0;
    }
}
/**
 * FHIR Questionnaire type
 */
export interface Questionnaire_2_1_0 extends Omit<Questionnaire_2_0_0, '$type$' | 'item'> {
    $type$: 'Questionnaire_2_1_0';
    item: Questionnaire_2_1_0.Question[];
}

export module Questionnaire_2_1_0 {
    /**
     * Question of a questionnaire.
     */
    export type Question = Omit<Questionnaire_2_0_0.Question, 'item'> & {
        disabledDisplay: 'hidden' | 'protected';
        item?: Question[];
    };

    export type Coding = Questionnaire_2_0_0.Coding;
    export type QuestionnaireEnableWhenAnswer = Questionnaire_2_0_0.QuestionnaireEnableWhenAnswer;
    export type QuestionnaireAnswerOptionValue = Questionnaire_2_0_0.QuestionnaireAnswerOptionValue;
    export type QuestionnaireValue = Questionnaire_2_0_0.QuestionnaireValue;
    export type Attachment = Questionnaire_2_0_0.Attachment;
    export type ExtensionMinValue = Questionnaire_2_0_0.ExtensionMinValue;
    export type ExtensionMaxValue = Questionnaire_2_0_0.ExtensionMaxValue;
    export type ExtensionEntryFormat = Questionnaire_2_0_0.ExtensionEntryFormat;
    export type ExtensionMinLength = Questionnaire_2_0_0.ExtensionMinLength;
    export type ExtensionDesignNote = Questionnaire_2_0_0.ExtensionDesignNote;
    export type ExtensionRegEx = Questionnaire_2_0_0.ExtensionRegEx;
    export type Extension = Questionnaire_2_0_0.Extension;
}

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireRules: RecipeRule[] = cloneRule(QuestionnaireRules_2_0_0);
overwriteRule(QuestionnaireRules, 'item', {
    itemprop: 'item',
    inheritFrom: 'Questionnaire_2_1_0.item',
    optional: true
});

addRule(QuestionnaireRules, 'item', {
    itemprop: 'disabledDisplay',
    itemtype: {type: 'string', regexp: /protected|hidden/},
    optional: false
});

/**
 * Recipe for questionnaires based upon FHIR standard.
 *
 * @type {{name: string; rule: RecipeRule[]; $type$: string}}
 */
export const QuestionnaireRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Questionnaire_2_1_0',
    rule: QuestionnaireRules
};

const QuestionnaireRecipes: Recipe[] = [QuestionnaireRecipe];
export default QuestionnaireRecipes;
