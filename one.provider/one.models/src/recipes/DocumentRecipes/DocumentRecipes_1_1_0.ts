import type {Recipe} from '@refinio/one.core/lib/recipes.js';
import type {DocumentInfo} from './DocumentRecipes_1_0_0.js';

export enum AcceptedMimeType {
    JPEG = 'image/jpeg',
    PNG = 'image/png',
    PDF = 'application/pdf'
}

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        DocumentInfo_1_1_0: DocumentInfo_1_1_0;
    }
}

export interface DocumentInfo_1_1_0 extends Omit<DocumentInfo, '$type$'> {
    $type$: 'DocumentInfo_1_1_0';
    mimeType: string;
    documentName: string;
}

const DocumentInfoRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'DocumentInfo_1_1_0',
    rule: [
        {
            itemprop: 'document',
            itemtype: {type: 'referenceToBlob'}
        },
        {
            itemprop: 'mimeType',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'documentName',
            itemtype: {type: 'string'}
        }
    ]
};

// Export recipes

const DocumentRecipes: Recipe[] = [DocumentInfoRecipe];

export default DocumentRecipes;
