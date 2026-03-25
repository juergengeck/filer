import type {Recipe} from '@refinio/one.core/lib/recipes.js';

/**
 * Stores input history entries per topic.
 * Identity is topicId - one versioned object per topic.
 * The entries field stores the history as a JSON string array.
 */
export const InputHistoryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'InputHistory',
    rule: [
        {
            itemprop: '$type$',
            itemtype: {type: 'string', regexp: /^InputHistory$/}
        },
        {
            itemprop: 'topicId',
            itemtype: {type: 'string'},
            isId: true
        },
        {
            itemprop: 'entriesJson',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'updatedAt',
            itemtype: {type: 'number'}
        }
    ]
};
