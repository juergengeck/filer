import ConsentRecipes_1_0_0 from './ConsentRecipes_1_0_0.js';
import ConsentRecipes_1_1_0 from './ConsentRecipes_1_1_0.js';
import type {Recipe} from '@refinio/one.core/lib/recipes.js';

const ConsentRecipes: Recipe[] = [...ConsentRecipes_1_0_0, ...ConsentRecipes_1_1_0];
export default ConsentRecipes;
