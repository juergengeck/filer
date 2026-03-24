import type {Recipe} from '@refinio/one.core/lib/recipes.js';

export interface ElectrocardiogramReadings {
    timeSinceSampleStart: number;
    leadVoltage: number;
}

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Electrocardiogram: Electrocardiogram;
    }
}

export interface Electrocardiogram {
    $type$: 'Electrocardiogram';
    typeDescription?: string;
    voltageMeasurements: number;
    startTimestamp?: number;
    samplingFrequencyHz?: number;
    endTimestamp?: number;
    classification?: string;
    averageHeartRateBPM?: number;
    symptoms?: string;
    readings?: ElectrocardiogramReadings[];
}

const ECGRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Electrocardiogram',
    rule: [
        {
            itemprop: 'typeDescription',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'voltageMeasurements',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'startTimestamp',
            itemtype: {type: 'number'},
            optional: true
        },
        {
            itemprop: 'samplingFrequencyHz',
            itemtype: {type: 'number'},
            optional: true
        },
        {
            itemprop: 'endTimestamp',
            itemtype: {type: 'number'},
            optional: true
        },
        {
            itemprop: 'classification',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'averageHeartRateBPM',
            itemtype: {type: 'number'},
            optional: true
        },
        {
            itemprop: 'symptoms',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'readings',
            itemtype: {type: 'stringifiable'}
        }
    ]
};

const ECGRecipes: Recipe[] = [ECGRecipe];

export default ECGRecipes;
