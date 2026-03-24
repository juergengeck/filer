import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Profile} from '../Leute/Profile.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * License that declares the contained keys as trusted keys (the issuer knows that the keys belongs
 * to the person)
 *
 * [signature.issuer] asserts that keys in [profile] belong to the person referenced by the profile.
 */
export const TrustKeysLicense: License = Object.freeze({
    $type$: 'License',
    name: 'TrustKeys',
    description:
        '[signature.issuer] asserts that keys in [profile] belong to the person referenced by' +
        ' the profile.'
});

registerLicense(TrustKeysLicense, 'TrustKeysCertificate');

export interface TrustKeysCertificate {
    $type$: 'TrustKeysCertificate';
    profile: SHA256Hash<Profile>;
    license: SHA256Hash<License>;
}

export const TrustKeysCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'TrustKeysCertificate',
    rule: [
        {
            itemprop: 'profile',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['Profile'])}
        },
        {
            itemprop: 'license',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['License'])}
        }
    ]
};

export const TrustKeysCertificateReverseMap: [OneObjectTypeNames, Set<string>] = [
    'TrustKeysCertificate',
    new Set(['*'])
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        TrustKeysCertificate: TrustKeysCertificate;
    }
}
