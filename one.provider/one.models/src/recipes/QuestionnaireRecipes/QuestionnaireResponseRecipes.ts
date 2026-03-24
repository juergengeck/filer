import type {OneUnversionedObjectInterfaces} from '@OneObjectInterfaces';
import type {QuestionnaireResponses} from './QuestionnaireResponseRecipes_1_0_0.js';
import QuestionnaireResponseRecipes_1_0_0 from './QuestionnaireResponseRecipes_1_0_0.js';
import type {QuestionnaireResponses_2_0_0} from './QuestionnaireResponseRecipes_2_0_0.js';
import QuestionnaireResponseRecipes_2_0_0 from './QuestionnaireResponseRecipes_2_0_0.js';
import type {OneObjectTypeNames, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

const QuestionnaireResponseRecipes: Recipe[] = [
    ...QuestionnaireResponseRecipes_1_0_0,
    ...QuestionnaireResponseRecipes_2_0_0
];
export default QuestionnaireResponseRecipes;

export type {QuestionnaireResponses_2_0_0 as LatestQuestionnaireResponses} from './QuestionnaireResponseRecipes_2_0_0.js';

export const latestQuestionnaireResponsesVersion = 'QuestionnaireResponses_2_0_0';
export const latestQuestionnaireResponseVersion = 'QuestionnaireResponse_2_0_0';

const supportedResponses = ['QuestionnaireResponses', 'QuestionnaireResponses_2_0_0'] as const;
export const QuestionnaireResponsesVersions: (keyof OneUnversionedObjectInterfaces)[] = [
    ...supportedResponses
];
export const QuestionnaireResponsesVersionsTypes: OneObjectTypeNames[] = [...supportedResponses];
export type QuestionnaireResponsesVersionsType = (typeof supportedResponses)[number];
export type QuestionnaireResponsesHash = SHA256Hash<
    QuestionnaireResponses | QuestionnaireResponses_2_0_0
>;

export type {QuestionnaireResponse_2_0_0 as LatestQuestionnaireResponse} from './QuestionnaireResponseRecipes_2_0_0.js';

const supportedResponse = ['QuestionnaireResponse', 'QuestionnaireResponse_2_0_0'] as const;
export type QuestionnaireResponseVersionsType = (typeof supportedResponse)[number];

export type {QuestionnaireResponseItem_2_0_0 as LatestQuestionnaireResponseItem} from './QuestionnaireResponseRecipes_2_0_0.js';
