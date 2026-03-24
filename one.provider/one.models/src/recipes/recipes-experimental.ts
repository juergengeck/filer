import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import BodyTemperatureRecipes from './BodyTemperatureRecipe.js';
import BlobRecipes from './BlobRecipes.js';
import MatchingRecipes from './MatchingRecipes.js';
import WbcRecipes from './WbcDiffRecipes.js';
import ECGRecipes from './ECGRecipes.js';
import BloodGlucoseRecipes from './BloodGlucoseRecipes.js';
import PersistentFileSystemRecipes from './PersistentFileSystemRecipes.js';
import AudioExerciseRecipes from './AudioExerciseRecipes.js';
import LeuteRecipes from './Leute/recipes.js';
import Certificates from './Certificates/CertificateRecipes.js';
import SignatureRecipes from './SignatureRecipes.js';
import ChatRecipes from './ChatRecipes.js';
import ConsentRecipes_1_1_0 from './ConsentRecipes/ConsentRecipes_1_1_0.js';
import IoMRequestRecipes from './IoM/IoMRequest.js';
import IoMRequestsRegistryRecipes from './IoM/IoMRequestsRegistry.js';
import CanRiskRecipes from './CanRiskRecipes/CanRiskResultRecipes.js';

const RecipesExperimental: Recipe[] = [
    ...BodyTemperatureRecipes,
    ...BlobRecipes,
    ...MatchingRecipes,
    ...WbcRecipes,
    ...ECGRecipes,
    ...BloodGlucoseRecipes,
    ...PersistentFileSystemRecipes,
    ...AudioExerciseRecipes,
    ...Certificates,
    ...ChatRecipes,
    ...LeuteRecipes,
    ...SignatureRecipes,
    ...ConsentRecipes_1_1_0,
    ...IoMRequestRecipes,
    ...IoMRequestsRegistryRecipes,
    ...CanRiskRecipes
];

export default RecipesExperimental;
