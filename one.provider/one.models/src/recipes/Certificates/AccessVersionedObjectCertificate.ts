import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * License for giving somebody else access to all versions of data.
 */
export const AccessVersionedObjectLicense: License = Object.freeze({
    $type$: 'License',
    name: 'AccessVersionedObject',
    description:
        '[signature.issuer] gives permission to share all versions of [data] with [person].'
});

registerLicense(AccessVersionedObjectLicense, 'AccessVersionedObjectCertificate');

export interface AccessVersionedObjectCertificate {
    $type$: 'AccessVersionedObjectCertificate';
    person: SHA256IdHash<Person>;
    data: SHA256IdHash;
    license: SHA256Hash<License>;
}

export const AccessVersionedObjectCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'AccessVersionedObjectCertificate',
    rule: [
        {
            itemprop: 'person',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'data',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['*'])}
        },
        {
            itemprop: 'license',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['License'])}
        }
    ]
};

export const AccessVersionedObjectCertificateReverseMap: [OneObjectTypeNames, Set<string>] = [
    'AccessVersionedObjectCertificate',
    new Set(['*'])
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        AccessVersionedObjectCertificate: AccessVersionedObjectCertificate;
    }
}
