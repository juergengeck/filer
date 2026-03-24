import type {BLOB, OneObjectTypeNames, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';

/**
 * This represents a description of a communication partner
 * examples:
 * - name
 * - profile image
 * - status
 */
export interface PersonName {
    $type$: 'PersonName';
    name: string;
}

/**
 * Image used to represent the person.
 */
export interface ProfileImage {
    $type$: 'ProfileImage';
    image: SHA256Hash<BLOB>;
}

/**
 * Status as text
 */
export interface PersonStatus {
    $type$: 'PersonStatus';
    value: string;
    timestamp: number;
    location: string;
}

/**
 * Image used as status in profiles
 */
export interface PersonImage {
    $type$: 'PersonImage';
    image: SHA256Hash<BLOB>;
    timestamp: number;
    location: string;
}

export interface SignKey {
    $type$: 'SignKey';
    key: HexString;
}

export interface EncryptionKey {
    $type$: 'EncryptionKey';
    key: HexString;
}

export interface OrganisationName {
    $type$: 'OrganisationName';
    name: string;
}

// #### type check magic ####

export type PersonDescriptionInterfaces = {
    PersonName: PersonName;
    ProfileImage: ProfileImage;
    PersonStatus: PersonStatus;
    PersonImage: PersonImage;
    SignKey: SignKey;
    EncryptionKey: EncryptionKey;
    OrganisationName: OrganisationName;
};
export type PersonDescriptionTypes = PersonDescriptionInterfaces[keyof PersonDescriptionInterfaces];
export type PersonDescriptionTypeNames = keyof PersonDescriptionInterfaces;

export const PersonDescriptionTypeNameSet = new Set<OneObjectTypeNames | '*'>([
    'PersonName',
    'ProfileImage',
    'PersonStatus',
    'PersonImage',
    'SignKey',
    'EncryptionKey',
    'OrganisationName'
]);

/**
 * Checks if the description is of a specific description type.
 *
 * @param description
 * @param type
 */
export function isDescriptionOfType<T extends PersonDescriptionTypeNames>(
    description: PersonDescriptionTypes,
    type: T
): description is PersonDescriptionInterfaces[T] {
    return description.$type$ === type;
}

// #### Recipes ####

export const PersonNameRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersonName',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'}
        }
    ]
};

export const PersonStatusRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersonStatus',
    rule: [
        {
            itemprop: 'value',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'location',
            itemtype: {type: 'string'}
        }
    ]
};

export const PersonImageRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'PersonImage',
    rule: [
        {
            itemprop: 'image',
            itemtype: {type: 'referenceToBlob'}
        },
        {
            itemprop: 'timestamp',
            itemtype: {type: 'number'}
        },
        {
            itemprop: 'location',
            itemtype: {type: 'string'}
        }
    ]
};

export const ProfileImageRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ProfileImage',
    rule: [
        {
            itemprop: 'image',
            itemtype: {type: 'referenceToBlob'}
        }
    ]
};

export const SignKeyRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'SignKey',
    rule: [
        {
            itemprop: 'key',
            itemtype: {type: 'string', regexp: /^[A-Za-z0-9+/]{64}$/}
        }
    ]
};

export const EncryptionKeyRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'EncryptionKey',
    rule: [
        {
            itemprop: 'key',
            itemtype: {type: 'string', regexp: /^[A-Za-z0-9+/]{64}$/}
        }
    ]
};

export const OrganisationNameRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'OrganisationName',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'}
        }
    ]
};

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        PersonName: PersonName;
        ProfileImage: ProfileImage;
        PersonStatus: PersonStatus;
        PersonImage: PersonImage;
        SignKey: SignKey;
        EncryptionKey: EncryptionKey;
        OrganisationName: OrganisationName;
    }
}

export default [
    PersonNameRecipe,
    ProfileImageRecipe,
    PersonStatusRecipe,
    PersonImageRecipe,
    SignKeyRecipe,
    EncryptionKeyRecipe,
    OrganisationNameRecipe
];
