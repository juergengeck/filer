import type {Recipe, OneObjectTypeNames, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * This license gives somebody the right to declare trusted keys for himself.
 *
 * The trust is given by creating an "AffirmationCertificate" pointing to a profile that contains
 * keys.
 */
export const RightToDeclareTrustedKeysForSelfLicense: License = Object.freeze({
    $type$: 'License',
    name: 'RightToDeclareTrustedKeysForSelf',
    description:
        '[signature.issuer] gives [beneficiary] the right to declare keys in his own profiles as' +
        ' trusted by issuing Affirmation certificates.'
});

registerLicense(
    RightToDeclareTrustedKeysForSelfLicense,
    'RightToDeclareTrustedKeysForSelfCertificate'
);

export interface RightToDeclareTrustedKeysForSelfCertificate {
    $type$: 'RightToDeclareTrustedKeysForSelfCertificate';
    beneficiary: SHA256IdHash<Person>;
    license: SHA256Hash<License>;
}

export const RightToDeclareTrustedKeysForSelfCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'RightToDeclareTrustedKeysForSelfCertificate',
    rule: [
        {
            itemprop: 'beneficiary',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'license',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['License'])}
        }
    ]
};

export const RightToDeclareTrustedKeysForSelfCertificateReverseMap: [
    OneObjectTypeNames,
    Set<string>
] = ['RightToDeclareTrustedKeysForSelfCertificate', new Set(['*'])];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        RightToDeclareTrustedKeysForSelfCertificate: RightToDeclareTrustedKeysForSelfCertificate;
    }
}
