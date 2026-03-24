import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        BodyTemperature: BodyTemperature;
    }
}

export interface BodyTemperature {
    $type$: 'BodyTemperature';
    temperature: number;
}

export const BodyTemperatureRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'BodyTemperature',
    rule: [
        {
            itemprop: 'temperature',
            itemtype: {type: 'number'}
        }
    ]
};

const BodyTemperatureRecipes: Recipe[] = [BodyTemperatureRecipe];

export default BodyTemperatureRecipes;
