import type {OneUnversionedObjectInterfaces} from '@OneObjectInterfaces';
import CanRiskCanRiskResultRecipe_1_0_0 from './CanRiskResultRecipe_1_0_0.js';
import type {OneObjectTypeNames, Recipe} from '@refinio/one.core/lib/recipes.js';

const QuestionnaireRecipes: Recipe[] = [...CanRiskCanRiskResultRecipe_1_0_0];
export default QuestionnaireRecipes;

export const latestVersionCanRiskResult: keyof OneUnversionedObjectInterfaces = 'CanRiskResult';

export type {CanRiskResult} from './CanRiskResultRecipe_1_0_0.js';

const supported = ['CanRiskResult'] as const;
export const canRiskResultVersions: (keyof OneUnversionedObjectInterfaces)[] = [...supported];
export const canRiskResultVersionsTypes: OneObjectTypeNames[] = [...supported];
export type CanRiskResultVersionsType = (typeof supported)[number];
