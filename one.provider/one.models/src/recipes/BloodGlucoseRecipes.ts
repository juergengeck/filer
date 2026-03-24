import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        BloodGlucose: BloodGlucose;
    }
}

export interface BloodGlucose {
    $type$: 'BloodGlucose';
    typeDescription?: string;
    value: number;
    unit: string;
    startTimestamp?: number;
    endTimestamp?: number;
}

const BloodGlucoseRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'BloodGlucose',
    rule: [
        {
            itemprop: 'typeDescription',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'value',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'unit',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'startTimestamp',
            itemtype: {type: 'number'},
            optional: true
        },
        {
            itemprop: 'endTimestamp',
            itemtype: {type: 'number'},
            optional: true
        }
    ]
};

const BloodGlucoseRecipes: Recipe[] = [BloodGlucoseRecipe];

export default BloodGlucoseRecipes;
