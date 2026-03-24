import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        HeartEvent: HeartEvent;
    }
}

export const HEART_OCCURRING_EVENTS = {
    LowHeartRate: 'LowHeartRate',
    HighHeartRate: 'HighHeartRate',
    IrregularHeartRhythm: 'IrregularHeartRhythm'
} as const;

export type HeartOccurringEvents =
    (typeof HEART_OCCURRING_EVENTS)[keyof typeof HEART_OCCURRING_EVENTS];

export interface HeartEvent {
    $type$: 'HeartEvent';
    occurredHeartEvent: HeartOccurringEvents;
}

const HeartEventRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'HeartEvent',
    rule: [
        {
            itemprop: 'occurredHeartEvent',
            itemtype: {type: 'string'}
        }
    ]
};

const HeartEventRecipes: Recipe[] = [HeartEventRecipe];

export default HeartEventRecipes;
