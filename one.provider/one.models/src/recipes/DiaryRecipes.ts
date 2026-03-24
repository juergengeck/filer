import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        DiaryEntry: DiaryEntry;
    }
}

export interface DiaryEntry {
    $type$: 'DiaryEntry';
    entry: string;
}

const DiaryEntryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'DiaryEntry',
    rule: [
        {
            itemprop: 'entry',
            itemtype: {type: 'string'}
        }
    ]
};

const DiaryRecipes: Recipe[] = [DiaryEntryRecipe];

export default DiaryRecipes;
