import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * License that affirms that referenced data contains accurate information.
 */
export const AffirmationLicense: License = Object.freeze({
    $type$: 'License',
    name: 'Affirmation',
    description: '[signature.issuer] affirms that content of [data] is correct.'
});

registerLicense(AffirmationLicense, 'AffirmationCertificate');

export interface AffirmationCertificate {
    $type$: 'AffirmationCertificate';
    data: SHA256Hash;
    license: SHA256Hash<License>;
}

export const AffirmationCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'AffirmationCertificate',
    rule: [
        {
            itemprop: 'data',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
        },
        {
            itemprop: 'license',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['License'])}
        }
    ]
};

export const AffirmationCertificateReverseMap: [OneObjectTypeNames, Set<string>] = [
    'AffirmationCertificate',
    new Set(['*'])
];

/*function createAffirmationCertificate(data: SHA256Hash): AffirmationCertificate {
    return {
        $type$: 'AffirmationCertificate',
        data,
        license: SHA256Hash<License>;
    };
}*/

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        AffirmationCertificate: AffirmationCertificate;
    }
    export interface OneLicenseInterfaces {
        Affirmation: AffirmationCertificate;
    }
}
