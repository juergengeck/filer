import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Questionnaire: Questionnaire;
    }
}
/**
 * FHIR Questionnaire type
 */
export interface Questionnaire {
    $type$: 'Questionnaire';
    resourceType: 'Questionnaire';
    language?: string;
    url?: string;
    name?: string;
    title?: string;
    status: 'draft' | 'active' | 'retired' | 'unknown';
    item: Questionnaire.Question[];
}

export module Questionnaire {
    /**
     * FHIR Coding type for encoding coded values.
     */
    export type Coding = {
        system?: string;
        version?: string;
        code?: string;
        display?: string;
        userSelected?: boolean;
    };

    /**
     * Type for the enable when compare value of questionnaires.
     */
    export type QuestionnaireEnableWhenAnswer = {
        answerBoolean?: boolean;
        answerDecimal?: string;
        answerInteger?: string;
        answerDate?: string;
        answerDateTime?: string;
        answerTime?: string;
        answerString?: string;
        answerCoding?: Coding;
        //answerQuantity?: Coding;
        //answerReference?: string;
    };

    /**
     * Type for answer option values of questionnaires.
     */
    export type QuestionnaireAnswerOptionValue = {
        valueInteger?: string;
        valueDate?: string;
        valueTime?: string;
        valueString?: string;
        valueCoding?: Coding;
        //valueReference?: string;
    };

    /**
     * Type of questionnaire answers and initial values.
     */
    export type QuestionnaireValue = {
        valueBoolean?: boolean;
        valueDecimal?: string;
        valueInteger?: string;
        valueDate?: string;
        valueDateTime?: string;
        valueTime?: string;
        valueString?: string;
        valueUri?: string;
        //valueAttachment?: string;
        valueCoding?: Coding;
        //valueQuantity?: Coding;
        //valueReference?: string;
    };

    /**
     * Question of a questionnaire.
     */
    export type Question = {
        linkId: string;
        prefix?: string;
        text?: string;
        type:
            | 'group'
            | 'display'
            | 'question'
            | 'boolean'
            | 'decimal'
            | 'integer'
            | 'date'
            | 'dateTime'
            | 'time'
            | 'string'
            | 'text'
            | 'url'
            | 'choice'
            | 'open-choice'
            | 'attachment'
            | 'reference'
            | 'quantity'
            | 'slider';
        enableWhen?: (QuestionnaireEnableWhenAnswer & {
            question: string;
            operator: 'exists' | '=' | '!=' | '>' | '<' | '>=' | '<=';
        })[];
        enableBehavior?: 'all' | 'any';
        required?: boolean;
        repeats?: boolean;
        readOnly?: boolean;
        minLength?: number;
        maxLength?: number;
        answerOption?: QuestionnaireAnswerOptionValue[];
        initial?: QuestionnaireValue[];
        item?: Question[];
    };
}

export const CodingRules: RecipeRule[] = [
    {
        itemprop: 'system',
        optional: true
    },
    {
        itemprop: 'version',
        optional: true
    },
    {
        itemprop: 'code',
        optional: true
    },
    {
        itemprop: 'display',
        optional: true
    },
    {
        itemprop: 'userSelected',
        itemtype: {type: 'boolean'},
        optional: true
    }
];

/**
 * The rules for answers in item.enableWhen
 *
 * FHIR(Questionnaire): Value for question comparison based on operator - Questionnaire Answer Codes (Example)
 */
export const AnswerRules: RecipeRule[] = [
    // FHIR Type: boolean
    {
        itemprop: 'answerBoolean',
        itemtype: {type: 'boolean'},
        optional: true
    },

    // FHIR Type: decimal
    {
        itemprop: 'answerDecimal',
        itemtype: {type: 'string', regexp: /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/},
        optional: true
    },

    // FHIR Type: integer
    {
        itemprop: 'answerInteger',
        itemtype: {type: 'string', regexp: /[0]|[-+]?[1-9][0-9]*/},
        optional: true
    },

    // FHIR Type: date
    {
        itemprop: 'answerDate',
        itemtype: {
            type: 'string',
            regexp: /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?/
        },
        optional: true
    },

    // FHIR Type: dateTime
    {
        itemprop: 'answerDateTime',
        itemtype: {
            type: 'string',
            regexp: /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?/
        },
        optional: true
    },

    // FHIR Type: time
    {
        itemprop: 'answerTime',
        itemtype: {
            type: 'string',
            regexp: /([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?/
        },
        optional: true
    },

    // FHIR Type: string
    {
        itemprop: 'answerString',
        optional: true
    },

    // FHIR Type: Coding
    {
        itemprop: 'answerCoding',
        itemtype: {type: 'object', rules: CodingRules},
        optional: true
    }

    // FHIR Type: Quantity
    // TODO: implement me correctly
    /*{
        itemprop: 'answerQuantity',
        optional: true
    },*/

    // FHIR Type: Reference(Any)
    // TODO: implement me correctly
    /*{
        itemprop: 'valueReference',
        optional: true
    }*/
];

/**
 * The value rules for values in item.answerOption
 *
 * FHIR(Questionnaire): Answer value - Questionnaire Answer Codes (Example)
 */
export const OptionValueRules: RecipeRule[] = [
    // FHIR Type: integer
    {
        itemprop: 'valueInteger',
        itemtype: {type: 'string', regexp: /[0]|[-+]?[1-9][0-9]*/},
        optional: true
    },

    // FHIR Type: date
    {
        itemprop: 'valueDate',
        itemtype: {
            type: 'string',
            regexp: /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1]))?)?/
        },
        optional: true
    },

    // FHIR Type: time
    {
        itemprop: 'valueTime',
        itemtype: {
            type: 'string',
            regexp: /([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?/
        },
        optional: true
    },

    // FHIR Type: string
    {
        itemprop: 'valueString',
        optional: true
    },

    // FHIR Type: Coding
    {
        itemprop: 'valueCoding',
        itemtype: {type: 'object', rules: CodingRules},
        optional: true
    }

    // FHIR Type: Reference(Any)
    // TODO: implement me correctly
    /*{
        itemprop: 'valueReference',
        optional: true
    }*/
];

/**
 * The value rules for values in item.initial
 *
 * FHIR(Questionnaire): Actual value for initializing the question - Questionnaire Answer Codes (Example)
 */
export const ValueRules: RecipeRule[] = [
    ...OptionValueRules,
    // FHIR Type: boolean
    {
        itemprop: 'valueBoolean',
        itemtype: {type: 'boolean'},
        optional: true
    },

    // FHIR Type: decimal
    {
        itemprop: 'valueDecimal',
        itemtype: {type: 'string', regexp: /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/},
        optional: true
    },

    // FHIR Type: dateTime
    {
        itemprop: 'valueDateTime',
        itemtype: {
            type: 'string',
            regexp: /([0-9]([0-9]([0-9][1-9]|[1-9]0)|[1-9]00)|[1-9]000)(-(0[1-9]|1[0-2])(-(0[1-9]|[1-2][0-9]|3[0-1])(T([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)(\.[0-9]+)?(Z|(\+|-)((0[0-9]|1[0-3]):[0-5][0-9]|14:00)))?)?)?/
        },
        optional: true
    },

    // FHIR Type: uri
    {
        itemprop: 'valueUri',
        optional: true
    }

    // FHIR Type: Attachment
    // TODO: implement me correctly
    /*{
        itemprop: 'valueAttachment',
        optional: true
    }*/

    // FHIR Type: Quantity
    // TODO: implement me correctly
    /*{
        itemprop: 'valueQuantity',
        optional: true
    }*/
];

/**
 * The rules to build a questionnaire based on FHIR
 */
export const QuestionnaireRules: RecipeRule[] = [
    // FHIR ressource type
    {
        itemprop: 'resourceType',
        itemtype: {type: 'string', regexp: /Questionnaire/}
    },

    // FHIR(Resource): Language of the resource content - Common Languages (Preferred but limited to AllLanguages)
    // Note: We use this to store in which language this questionnaire is formulated.
    {
        itemprop: 'language',
        optional: true
    },

    // FHIR(Questionnaire): Canonical identifier for this questionnaire, represented as a URI (globally unique)
    // Note: This is used as reference from the questionnaireResponse object
    {
        itemprop: 'url',
        optional: true
    },

    // FHIR(Questionnaire): Name for this questionnaire (computer friendly)
    // Note: we use this as identifier from the URL, because it is shorter and easier to encode in the app
    // url than the url above.
    {
        itemprop: 'name',
        optional: true
    },

    // FHIR(Questionnaire): Name for this questionnaire (human friendly)
    // Note: We use this to display a text for the whole questionnaire
    {
        itemprop: 'title',
        optional: true
    },

    // FHIR(Questionnaire): draft | active | retired | unknown - PublicationStatus (Required)
    {
        itemprop: 'status',
        itemtype: {type: 'string', regexp: /draft|active|retired|unknown/}
    },

    // FHIR(Questionnaire): Questions and sections within the Questionnaire
    // + Rule: Group items must have nested items, display items cannot have nested items
    // + Rule: Display items cannot have a "code" asserted
    // + Rule: A question cannot have both answerOption and answerValueSet
    // + Rule: Only 'choice' and 'open-choice' items can have answerValueSet
    // + Rule: Required and repeat aren't permitted for display items
    // + Rule: Initial values can't be specified for groups or display items
    // + Rule: Read-only can't be specified for "display" items
    // + Rule: Maximum length can only be declared for simple question types
    // + Rule: If one or more answerOption is present, initial[x] must be missing
    // + Rule: If there are more than one enableWhen, enableBehavior must be specified
    // + Rule: Can only have multiple initial values for repeating items
    {
        itemprop: 'item',
        itemtype: {
            type: 'array',
            item: {
                type: 'object',
                rules: [
                    // FHIR(Questionnaire): Unique id for item in questionnaire
                    // Note: This is used for the questionnaire responses to link to the correct answer.
                    {
                        itemprop: 'linkId'
                    },

                    // FHIR(Questionnaire): E.g. "1(a)", "2.5.3"
                    // Note: This is shown as prefix in questions, so that users can reference it easily
                    {
                        itemprop: 'prefix',
                        optional: true
                    },

                    // FHIR(Questionnaire): Primary text for the item
                    // Note: This is the question to display
                    {
                        itemprop: 'text',
                        optional: true
                    },

                    // FHIR(Questionnaire): group | display | boolean | decimal | integer | date | dateTime + - QuestionnaireItemType (Required)
                    {
                        itemprop: 'type',
                        itemtype: {
                            type: 'string',
                            regexp: /group|display|question|boolean|decimal|integer|date|dateTime|time|string|text|url|choice|open-choice|attachment|reference|quantity|slider/
                        }
                    },

                    // FHIR(Questionnaire): Only allow data when
                    // + Rule: If the operator is 'exists', the value must be a boolean
                    {
                        itemprop: 'enableWhen',
                        itemtype: {
                            type: 'array',
                            item: {
                                type: 'object',
                                rules: [
                                    // FHIR(Questionnaire): Question that determines whether item is enabled
                                    {
                                        itemprop: 'question'
                                    },

                                    // FHIR(Questionnaire): exists | = | != | > | < | >= | <=
                                    {
                                        itemprop: 'operator',
                                        itemtype: {type: 'string', regexp: /exists|=|!=|>|<|>=|<=/}
                                    },

                                    // FHIR(Questionnaire): Value for question comparison based on operator - Questionnaire Answer Codes (Example)
                                    ...AnswerRules
                                ]
                            }
                        },
                        optional: true
                    },

                    // FHIR(Questionnaire): all | any - EnableWhenBehavior (Required)
                    {
                        itemprop: 'enableBehavior',
                        itemtype: {type: 'string', regexp: /all|any/},
                        optional: true
                    },

                    // FHIR(Questionnaire): Whether the item must be included in data results
                    {
                        itemprop: 'required',
                        itemtype: {type: 'boolean'},
                        optional: true
                    },

                    // FHIR(Questionnaire): Whether the item may repeat
                    {
                        itemprop: 'repeats',
                        itemtype: {type: 'boolean'},
                        optional: true
                    },

                    // FHIR(Questionnaire): Don't allow human editing
                    {
                        itemprop: 'readOnly',
                        itemtype: {type: 'boolean'},
                        optional: true
                    },

                    // Extension: At least more than this many characters
                    {
                        itemprop: 'minLength',
                        itemtype: {type: 'number'},
                        optional: true
                    },

                    // FHIR(Questionnaire): No more than this many characters
                    {
                        itemprop: 'maxLength',
                        itemtype: {type: 'number'},
                        optional: true
                    },

                    // FHIR(Questionnaire): Initial value(s) when item is first rendered
                    {
                        itemprop: 'answerOption',
                        itemtype: {
                            type: 'array',
                            item: {
                                type: 'object',
                                rules: [
                                    ...OptionValueRules,
                                    {
                                        itemprop: 'initialSelected',
                                        itemtype: {type: 'boolean'},
                                        optional: true
                                    }
                                ]
                            }
                        },
                        optional: true
                    },

                    // FHIR(Questionnaire): Initial value(s) when item is first rendered
                    {
                        itemprop: 'initial',
                        itemtype: {
                            type: 'bag',
                            item: {
                                type: 'object',
                                rules: ValueRules
                            }
                        },
                        optional: true
                    },
                    {
                        itemprop: 'item',
                        inheritFrom: 'Questionnaire.item',
                        optional: true
                    }
                ]
            }
        }
    }
];

/**
 * Recipe for questionnaires based upon FHIR standard.
 *
 * @type {{name: string; rule: RecipeRule[]; $type$: string}}
 */
export const QuestionnaireRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Questionnaire',
    rule: QuestionnaireRules
};

const QuestionnaireRecipes: Recipe[] = [QuestionnaireRecipe];
export default QuestionnaireRecipes;
