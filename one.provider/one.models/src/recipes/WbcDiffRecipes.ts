/**
 * This represents a Wbc Measurement.
 *
 * Q: Why would we use string for encoding the value?
 * A: - float would probably change the value if the value is not representable
 *    - number does not support decimal places
 *    - the communication / storage is string based, so why convert the value
 *      to a number / ... and then convert it back to a string with potential
 *      modifications?
 *    - This is medically relevant information, so try not to modify values,
 *      keep them as-is from start to end.
 */

import type {Recipe, RecipeRule} from '@refinio/one.core/lib/recipes.js';

export interface WbcMeasurement {
    value: string;
    unit: string;
    unsafe?: boolean;
}

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        WbcObservation: WbcObservation;
    }
}

export interface WbcObservation {
    $type$: 'WbcObservation';
    acquisitionTime: string; // time the measurement took place e.g. '2020-09-04T12:10:01+01:00';
    Leukocytes: WbcMeasurement;
    Neutrophils?: WbcMeasurement;
    Lymphocytes?: WbcMeasurement;
    Monocytes?: WbcMeasurement;
    Eosinophils?: WbcMeasurement;
    Basophils?: WbcMeasurement;
}

const WbcMeasurementRules: RecipeRule[] = [
    {
        itemprop: 'value',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'unit',
        itemtype: {type: 'string'}
    },
    {
        itemprop: 'unsafe',
        itemtype: {type: 'boolean'},
        optional: true
    }
];

const WbcObservationRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'WbcObservation',
    rule: [
        {
            itemprop: 'acquisitionTime',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'Leukocytes',
            itemtype: {type: 'object', rules: WbcMeasurementRules}
        },
        {
            itemprop: 'Neutrophils',
            itemtype: {type: 'object', rules: WbcMeasurementRules},
            optional: true
        },
        {
            itemprop: 'Lymphocytes',
            itemtype: {type: 'object', rules: WbcMeasurementRules},
            optional: true
        },
        {
            itemprop: 'Monocytes',
            itemtype: {type: 'object', rules: WbcMeasurementRules},
            optional: true
        },
        {
            itemprop: 'Eosinophils',
            itemtype: {type: 'object', rules: WbcMeasurementRules},
            optional: true
        },
        {
            itemprop: 'Basophils',
            itemtype: {type: 'object', rules: WbcMeasurementRules},
            optional: true
        }
    ]
};

// Export recipes

const WbcRecipes: Recipe[] = [WbcObservationRecipe];

export default WbcRecipes;
