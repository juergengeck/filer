import type {
    OneObjectTypeNames,
    OneVersionedObjectTypeNames
} from '@refinio/one.core/lib/recipes.js';
import {SomeoneReverseMaps} from './Leute/Someone.js';
import {SignatureReverseMaps} from './SignatureRecipes.js';
import {CertificateReverseMaps} from './Certificates/CertificateRecipes.js';
import {ProfileReverseMaps, ProfileReverseMapsForIdObjects} from './Leute/Profile.js';
import {CommunicationEndpointReverseMaps} from './Leute/CommunicationEndpoints.js';

export const ReverseMapsExperimental: [OneObjectTypeNames, Set<string>][] = [
    ...SignatureReverseMaps,
    ...CertificateReverseMaps,
    ...ProfileReverseMaps,
    ...SomeoneReverseMaps,
    ...CommunicationEndpointReverseMaps
];

export const ReverseMapsForIdObjectsExperimental: [OneVersionedObjectTypeNames, Set<string>][] = [
    ...ProfileReverseMapsForIdObjects
];
