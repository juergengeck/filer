import LeuteRecipesCE from './CommunicationEndpoints.js';
import LeuteRecipesLeute from './Leute.js';
import LeuteRecipesPD from './PersonDescriptions.js';
import LeuteRecipesProfile from './Profile.js';
import LeuteRecipesSomeone from './Someone.js';
import LeuteRecipesGroupProfile from './GroupProfile.js';

const LeuteRecipes = [
    ...LeuteRecipesCE,
    ...LeuteRecipesLeute,
    ...LeuteRecipesPD,
    ...LeuteRecipesProfile,
    ...LeuteRecipesSomeone,
    ...LeuteRecipesGroupProfile
];

export default LeuteRecipes;
