import type {OneCertificateInterfaces} from '@OneObjectInterfaces';
import type {Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import {
    AccessUnversionedObjectCertificateRecipe,
    AccessUnversionedObjectCertificateReverseMap
} from './AccessUnversionedObjectCertificate.js';
import {
    AccessVersionedObjectCertificateRecipe,
    AccessVersionedObjectCertificateReverseMap
} from './AccessVersionedObjectCertificate.js';
import {
    AffirmationCertificateRecipe,
    AffirmationCertificateReverseMap
} from './AffirmationCertificate.js';
import {LicenseRecipe, LicenseReverseMap} from './License.js';
import {RelationCertificateRecipe, RelationCertificateReverseMap} from './RelationCertificate.js';
import {
    RightToDeclareTrustedKeysForEverybodyCertificateRecipe,
    RightToDeclareTrustedKeysForEverybodyCertificateReverseMap
} from './RightToDeclareTrustedKeysForEverybodyCertificate.js';
import {
    RightToDeclareTrustedKeysForSelfCertificateRecipe,
    RightToDeclareTrustedKeysForSelfCertificateReverseMap
} from './RightToDeclareTrustedKeysForSelfCertificate.js';
import {
    TrustKeysCertificateRecipe,
    TrustKeysCertificateReverseMap
} from './TrustKeysCertificate.js';

export const CertificateReverseMaps: [OneObjectTypeNames, Set<string>][] = [
    AccessUnversionedObjectCertificateReverseMap,
    AccessVersionedObjectCertificateReverseMap,
    AffirmationCertificateReverseMap,
    LicenseReverseMap,
    RelationCertificateReverseMap,
    RightToDeclareTrustedKeysForEverybodyCertificateReverseMap,
    RightToDeclareTrustedKeysForSelfCertificateReverseMap,
    TrustKeysCertificateReverseMap
];

const Certificates: Recipe[] = [
    AccessUnversionedObjectCertificateRecipe,
    AccessVersionedObjectCertificateRecipe,
    AffirmationCertificateRecipe,
    LicenseRecipe,
    RelationCertificateRecipe,
    RightToDeclareTrustedKeysForEverybodyCertificateRecipe,
    RightToDeclareTrustedKeysForSelfCertificateRecipe,
    TrustKeysCertificateRecipe
];

export type OneCertificateTypes = OneCertificateInterfaces[keyof OneCertificateInterfaces];
export type OneCertificateTypeNames = keyof OneCertificateInterfaces;

export default Certificates;
