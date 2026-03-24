export enum QuestionType {
    Display = 0,
    Group = 1,
    Choice = 2,
    String = 3,
    Date = 4,
    Integer = 5,
    OpenChoice = 6,
    OpenChoiceGroup = 7,
    Slider = 8
}

export type Questionnaire = {
    // the unique identifier of a Questionnaire
    identifier: string;
    // an array of questions
    item: Question[];
};

export type Question = {
    // the unique identifier of a Question
    questionIdentifier: string;
    // a set of conditions which specify when the question becomes available
    enableWhen?: EnableWhen[];
    // specify if an answer it's mandatory for the question,
    // by setting it to false a question can be passed without any answer
    required?: boolean;
    // the string of the question that will be displayed in UI
    question: string;
    // type of the Question
    questionType: QuestionType;
    // possible answers of the question
    answerValue?: string[];
    // for QuestionType.String - this field specify the maximum numbers of characters
    //                         that can be entered as an answer
    // for QuestionType.Integer - this represents the maximum value that can be entered in the input field - end of the interval
    maxLength?: number;
    // for QuestionType.String - this field specify the minimum numbers of characters
    //                         that are required to be entered as an answer
    // for QuestionType.Integer - this represents the lowest value that can be entered in the input field
    minLength?: number;
    // a regex for checking the entered values for questions whose answer is provided within an input field
    regEx?: string;
    // a list of a sub-questions
    item?: Question[];
    // this influence the operation that is made between enableWhen conditions of a question,
    // if it's not specified will be an OR operation
    enableWhenOperator?: Operator;
};

export type EnableWhen = {
    question: string;
    // implemented and supported operators: "=", "!=", "exists", "!exists"
    operator: string;
    answer: string;
};

export enum Operator {
    AND = 'AND',
    OR = 'OR'
}

/**
 * Short explanation of each Question type:
 *
 * 1. QuestionType.Display - is recommended to be used when you want to declare a question
 *                          which doesn't have any answer and it's just a sentence
 *                          that inform the user about what questions will follow.
 *
 * 2. QuestionType.Group - this one should be used when you want to have a question
 *                        which contains subquestions. The state of subquestions depends
 *                        on the condition of the group question but also depends on the
 *                        enable when condition of the subquestion (e.g. AEK6.1 from AEK questionnaire).
 *
 * 3. QuestionType.Choice - this one is the most used question type in our questionnaires because the answers are
 *                         considered radio buttons - so you can have only one active answer at a time.
 *
 * 4. QuestionType.String - is recommended to use this type of question when you want to have as an answer for the question,
 *                         an input which allows the user to enter what string he want. You can restrict the strings
 *                         that are allowed to be entered in the input by specifying the regex properties for the question,
 *                         but also you can specify a minimum number of characters that are allowed with minLength
 *                         and a maximum amount of characters that are allowed with maxLength.
 *
 * 5. QuestionType.Date - should be used when you want to have an input field as a date picker as an answer for the question.
 *
 * 6. QuestionType.Integer - this type of question should be used when you want to declare a question
 *                          whose answer is an input field of type number. You can restrict what kind of numbers
 *                          can be entered in the input field by adding the minLength which will be the interval start
 *                          and maxLength which will be the interval end for that input. These fields are required!
 *
 * 7. QuestionType.OpenChoice - should be used when you want to have as an answer a single value represented in UI as a checkbox.
 *                             The value of the answer needs to be specified in the answerValue property.
 *                             The string from the question property will be not displayed in the UI.
 *                             This type is mostly used so far when you want to have an additional answer for a question of type String.
 *
 * 8. QuestionType.OpenChoiceGroup - this one is derived from the OpenChoice type, but because of the representation
 *                                  it should be used only as a subquestion in a Group question.
 */
