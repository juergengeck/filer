import DocumentRecipes_1_0_0 from './DocumentRecipes_1_0_0.js';
import DocumentRecipes_1_1_0 from './DocumentRecipes_1_1_0.js';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';
const DocumentRecipes: Recipe[] = [...DocumentRecipes_1_0_0, ...DocumentRecipes_1_1_0];
export default DocumentRecipes;
