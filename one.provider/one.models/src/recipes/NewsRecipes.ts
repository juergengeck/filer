import type {Recipe} from '@refinio/one.core/lib/recipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        News: News;
    }
}

export interface News {
    $type$: 'News';
    content: string;
}

export const NewsRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'News',
    rule: [
        {
            itemprop: 'content',
            itemtype: {type: 'string'}
        }
    ]
};

const NewsRecipes: Recipe[] = [NewsRecipe];

export default NewsRecipes;
