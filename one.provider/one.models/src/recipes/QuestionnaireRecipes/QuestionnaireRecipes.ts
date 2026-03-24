/* eslint-disable @typescript-eslint/no-namespace */
import QuestionnaireRecipes_1_0_0 from './QuestionnaireRecipes_1_0_0.js';
import QuestionnaireRecipes_1_1_0 from './QuestionnaireRecipes_1_1_0.js';
import QuestionnaireRecipes_1_2_0 from './QuestionnaireRecipes_1_2_0.js';
import QuestionnaireRecipes_2_0_0 from './QuestionnaireRecipes_2_0_0.js';
import QuestionnaireRecipes_2_1_0 from './QuestionnaireRecipes_2_1_0.js';
import QuestionnaireRecipes_2_1_1 from './QuestionnaireRecipes_2_1_1.js';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';

const QuestionnaireRecipes: Recipe[] = [
    ...QuestionnaireRecipes_1_0_0,
    ...QuestionnaireRecipes_1_1_0,
    ...QuestionnaireRecipes_1_2_0,
    ...QuestionnaireRecipes_2_0_0,
    ...QuestionnaireRecipes_2_1_0,
    ...QuestionnaireRecipes_2_1_1
];
export default QuestionnaireRecipes;

export type {Questionnaire_2_1_1 as Questionnaire} from './QuestionnaireRecipes_2_1_1.js';
