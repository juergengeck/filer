import type {BLOB, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        DocumentInfo: DocumentInfo;
    }
}
export interface DocumentInfo {
    $type$: 'DocumentInfo';
    document: SHA256Hash<BLOB>;
}

const DocumentInfoRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'DocumentInfo',
    rule: [
        {
            itemprop: 'document',
            itemtype: {type: 'referenceToBlob'}
        }
    ]
};

// Export recipes

const DocumentRecipes: Recipe[] = [DocumentInfoRecipe];

export default DocumentRecipes;
