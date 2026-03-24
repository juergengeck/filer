import type {Person} from '@refinio/one.core/lib/recipes.js';
import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {License} from './License.js';
import {registerLicense} from '../../misc/Certificates/LicenseRegistry.js';

/**
 * License affirms that a person has a specific relation to another person (or organization).
 *
 * Examples:
 * - Person1 is a doctor at a clinic(Person2)
 * - Person1 is related to Person2
 * - Person1 is a patient at doctor(Person2)
 *
 * This stuff is application specific, so the application has to decide which relations make sense.
 */
export const RelationLicense: License = Object.freeze({
    $type$: 'License',
    name: 'Relation',
    description:
        '[signature.issuer] affirms that [person1] has [relation] to [person2] in context of' +
        ' application [app].'
});

registerLicense(RelationLicense, 'RelationCertificate');

export interface RelationCertificate {
    $type$: 'RelationCertificate';
    app: string;
    relation: string;
    person1: SHA256IdHash<Person>;
    person2: SHA256IdHash<Person>;
    license: SHA256Hash<License>;
}

export const RelationCertificateRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'RelationCertificate',
    rule: [
        {
            itemprop: 'app'
        },
        {
            itemprop: 'relation'
        },
        {
            itemprop: 'person1',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'person2',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'license',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['License'])}
        }
    ]
};

export const RelationCertificateReverseMap: [OneObjectTypeNames, Set<string>] = [
    'RelationCertificate',
    new Set(['*'])
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneCertificateInterfaces {
        RelationCertificate: RelationCertificate;
    }

    export interface OneUnversionedObjectInterfaces {
        RelationCertificate: RelationCertificate;
    }
}
