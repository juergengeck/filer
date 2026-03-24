import type {Recipe, OneObjectTypeNames, Person} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * This license gives somebody the right to declare trusted keys for this instance.
 *
 * The trust is given by creating a "TrustKeysCertificate" pointing to a profile that contains keys.
 *
 * Attention: This is a very very powerful right. Somebody with this right can impersonate
 * everybody else by just issuing new keys for that person.
 */
export const RightToDeclareTrustedKeysForEverybodyLicense: License = Object.freeze({
    $type$: 'License',
    name: 'RightToDeclareTrustedKeysForEverybodyLicense',
    description:
        '[signature.issuer] gives [beneficiary] the right to declare any keys in profiles as' +
        ' trusted by issuing TrustKeys certificates.'
});

registerLicense(
    RightToDeclareTrustedKeysForEverybodyLicense,
    'RightToDeclareTrustedKeysForEverybodyCertificate'
);

export interface RightToDeclareTrustedKeysForEverybodyCertificate {
    $type$: 'RightToDeclareTrustedKeysForEverybodyCertificate';
    beneficiary: SHA256IdHash<Person>;
    license: SHA256Hash<License>;
}

export const RightToDeclareTrustedKeysForEverybodyCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'RightToDeclareTrustedKeysForEverybodyCertificate',
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

export const RightToDeclareTrustedKeysForEverybodyCertificateReverseMap: [
    OneObjectTypeNames,
    Set<string>
] = ['RightToDeclareTrustedKeysForEverybodyCertificate', new Set(['*'])];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        RightToDeclareTrustedKeysForEverybodyCertificate: RightToDeclareTrustedKeysForEverybodyCertificate;
    }
}
