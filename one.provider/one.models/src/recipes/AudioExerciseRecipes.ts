import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        AudioExercise: AudioExercise;
    }
}

export interface AudioExercise {
    $type$: 'AudioExercise';
    name: string;
}

export const AudioExerciseRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'AudioExercise',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'}
        }
    ]
};

const AudioExerciseRecipes: Recipe[] = [AudioExerciseRecipe];

export default AudioExerciseRecipes;
