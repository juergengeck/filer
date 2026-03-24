import type {OneUnversionedObjectTypes, Person} from '@refinio/one.core/lib/recipes.js';
import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * License for giving somebody else access to data.
 */
export const AccessUnversionedObjectLicense: License = Object.freeze({
    $type$: 'License',
    name: 'AccessUnversionedObject',
    description: '[signature.issuer] gives permission to share [data] with [person].'
});

registerLicense(AccessUnversionedObjectLicense, 'AccessUnversionedObjectCertificate');

export interface AccessUnversionedObjectCertificate {
    $type$: 'AccessUnversionedObjectCertificate';
    person: SHA256IdHash<Person>;
    data: SHA256Hash<OneUnversionedObjectTypes>;
    license: SHA256Hash<License>;
}

export const AccessUnversionedObjectCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'AccessUnversionedObjectCertificate',
    rule: [
        {
            itemprop: 'person',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
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

export const AccessUnversionedObjectCertificateReverseMap: [OneObjectTypeNames, Set<string>] = [
    'AccessUnversionedObjectCertificate',
    new Set(['*'])
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        AccessUnversionedObjectCertificate: AccessUnversionedObjectCertificate;
    }
}
