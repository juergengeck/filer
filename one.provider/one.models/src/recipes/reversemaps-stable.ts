import type {
    OneObjectTypeNames,
    OneVersionedObjectTypeNames
} from '@refinio/one.core/lib/recipes.js';

export const ReverseMapsStable: [OneObjectTypeNames, Set<string>][] = [
    ['Assertion', new Set(['target'])]
];
export const ReverseMapsForIdObjectsStable: [OneVersionedObjectTypeNames, Set<string>][] = [];
