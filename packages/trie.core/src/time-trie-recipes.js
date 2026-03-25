// ---------------------------------------------------------------------------
// Recipe definitions
// ---------------------------------------------------------------------------
/**
 * @deprecated TimeTrie structural recipes are for the legacy ONE-backed CRDT trie.
 * Prefer persisted ContentAddressedTrie/MultiTrie node/root recipes.
 *
 * Allowed child types for structural nodes.
 * Includes all structural levels plus use-case-specific leaf types.
 * Add new leaf types here when creating new time-trie consumers.
 */
const ALLOWED_CHILD_TYPES = new Set(['*']);
function makeTimeTrieNodeRecipe(name) {
    return {
        $type$: 'Recipe',
        name,
        rule: [
            {
                itemprop: 'key',
                isId: true,
                itemtype: { type: 'string' }
            },
            {
                itemprop: 'children',
                itemtype: {
                    type: 'set',
                    item: { type: 'referenceToId', allowedTypes: ALLOWED_CHILD_TYPES }
                }
            },
            {
                itemprop: 'tombstoned',
                optional: true,
                itemtype: { type: 'boolean' }
            }
        ]
    };
}
export const TimeTrieYearNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieYearNode');
export const TimeTrieMonthNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieMonthNode');
export const TimeTrieDayNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieDayNode');
export const TimeTrieHourNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieHourNode');
export const TimeTrieMinuteNodeRecipe = makeTimeTrieNodeRecipe('TimeTrieMinuteNode');
const TimeTrieRecipes = [
    TimeTrieYearNodeRecipe,
    TimeTrieMonthNodeRecipe,
    TimeTrieDayNodeRecipe,
    TimeTrieHourNodeRecipe,
    TimeTrieMinuteNodeRecipe
];
export default TimeTrieRecipes;
