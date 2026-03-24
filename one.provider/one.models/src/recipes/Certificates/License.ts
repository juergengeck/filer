import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';

/**
 * The license that is granted by issuing a certificate.
 *
 * There are many ideas going forward:
 * 1) We could make Licenses versioned (e.g. GPLv2. GPLv3 ...) or we could add a version field
 * 2) We could store who invented the license / is responsible for the text (e.g. EFF ...)
 * ... but at the moment the name and a description is enough.
 *
 * Conventions:
 * - The license text should reference the values that are stored in the certificate in
 * brackets []
 *
 * Example of a license text:
 * "The [signature.issuer] affirms that the content of [data] is valid"
 *
 * The corresponding certificate would then look like this:
 *
 * type AffirmationCertificate {
 *     $type$: 'AffirmationCertificate',
 *     data: SHA256Hash;
 *     license: SHA256Hash<License>;
 * }
 */
export interface License {
    $type$: 'License';
    name: string;
    description: string;
}

export const LicenseRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'License',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'description',
            itemtype: {type: 'string'}
        }
    ]
};

export const LicenseReverseMap: [OneObjectTypeNames, Set<string>] = ['License', new Set(['*'])];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        License: License;
    }
}
