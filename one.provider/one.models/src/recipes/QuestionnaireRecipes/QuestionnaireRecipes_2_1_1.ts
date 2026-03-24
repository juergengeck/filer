/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable no-redeclare */
import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';

import {
    ValueRules as ValueRules_2_0_0,
    AtachmentRules as AtachmentRules_2_0_0,
    OptionValueRules as OptionValueRules_2_0_0
} from './QuestionnaireRecipes_2_0_0.js';
import {QuestionnaireRules as QuestionnaireRules_2_1_0} from './QuestionnaireRecipes_2_1_0.js';
import type {Questionnaire_2_1_0} from './QuestionnaireRecipes_2_1_0.js';
import {cloneRule, overwriteRule, removeRule} from '../RecipeUtils.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Questionnaire_2_1_1: Questionnaire_2_1_1;
    }
}
/**
 * FHIR Questionnaire type
 */
export interface Questionnaire_2_1_1 extends Omit<Questionnaire_2_1_0, '$type$' | 'item'> {
    $type$: 'Questionnaire_2_1_1';
    item: Questionnaire_2_1_1.Question[];
}

export module Questionnaire_2_1_1 {
    /**
     * Question of a questionnaire.
     */
    export type Question = Omit<Questionnaire_2_1_0.Question, 'item' | 'initial'> & {
        item?: Question[];
        initial?: QuestionnaireValue[];
    };

    export type Attachment = {
        contentType: string; // Mime type of the content, with charset etc.
        language?: string; // Human language of the content (BCP-47)
        data: string; // Data inline, base64ed
        title?: string; // Label to display in place of the data
        creation?: string; // Date attachment was first created
    };

    export type Coding = Questionnaire_2_1_0.Coding;
    export type QuestionnaireEnableWhenAnswer = Questionnaire_2_1_0.QuestionnaireEnableWhenAnswer;
    export type QuestionnaireAnswerOptionValue = Questionnaire_2_1_0.QuestionnaireAnswerOptionValue;
    export type QuestionnaireValue = Omit<
        Questionnaire_2_1_0.QuestionnaireValue,
        'valueAttachment'
    > & {
        valueAttachment?: Attachment;
    };
    export type ExtensionMinValue = Questionnaire_2_1_0.ExtensionMinValue;
    export type ExtensionMaxValue = Questionnaire_2_1_0.ExtensionMaxValue;
    export type ExtensionEntryFormat = Questionnaire_2_1_0.ExtensionEntryFormat;
    export type ExtensionMinLength = Questionnaire_2_1_0.ExtensionMinLength;
    export type ExtensionDesignNote = Questionnaire_2_1_0.ExtensionDesignNote;
    export type ExtensionRegEx = Questionnaire_2_1_0.ExtensionRegEx;
    export type Extension = Questionnaire_2_1_0.Extension;
}

export const AtachmentRules = cloneRule(AtachmentRules_2_0_0);
removeRule(AtachmentRules, 'contentType');
AtachmentRules.push({
    itemprop: 'contentType',
    itemtype: {type: 'string'},
    optional: true
});

export const ValueRules = cloneRule(ValueRules_2_0_0);
removeRule(ValueRules, 'valueAttachment');
ValueRules.push({
    itemprop: 'valueAttachment',
    itemtype: {type: 'object', rules: AtachmentRules},
    optional: true
});

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireRules: RecipeRule[] = cloneRule(QuestionnaireRules_2_1_0);
overwriteRule(QuestionnaireRules, 'item', {
    itemprop: 'item',
    inheritFrom: 'Questionnaire_2_1_1.item',
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
    name: 'Questionnaire_2_1_1',
    rule: QuestionnaireRules
};

const QuestionnaireRecipes: Recipe[] = [QuestionnaireRecipe];
export default QuestionnaireRecipes;
