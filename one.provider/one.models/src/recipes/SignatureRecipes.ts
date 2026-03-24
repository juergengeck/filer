import type {Person, Recipe, OneObjectTypeNames} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {HexStringRegex} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';

// #### Typescript interfaces ####

/**
 * TS interface for SignatureRecipe.
 */
export interface Signature {
    $type$: 'Signature';
    issuer: SHA256IdHash<Person>;
    data: SHA256Hash;
    signature: HexString;
}

// #### Recipes ####

/**
 * Represents a digital signature.
 *
 * Note: We omitted the algorithm and the public key from this object because they have security implications:
 * 1) algorithm: Can be misused by an attacker - the public key was generated for a specific algorithm, so if different
 *              algorithms shall be supported, then the algorithm needs to be paired with the public key
 * 2) public key: Developers might think, that it is enough to test the signature against the public key stored here.
 *                But the key is not trustworthy, until cleared by the key- / identity management.
 *                Drawback is, that you need to test all available keys for this identity, because you do not know
 *                which key was used. This can be made better by a hint (giving keys unique ids and using this id here
 *                instead of storing the whole public key)
 * The issuer is also not trustworthy, until you checked the signature and know that the person uses this key. We could
 * also omit the issuer, but then we would need to test all known keys of all persons and this would take too much time.
 */
export const SignatureRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Signature',
    rule: [
        {
            itemprop: 'issuer',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'data',
            itemtype: {type: 'referenceToObj', allowedTypes: new Set(['*'])}
        },
        {
            itemprop: 'signature',
            itemtype: {type: 'string', regexp: HexStringRegex}
        }
    ]
};

// #### Reverse maps ####

export const SignatureReverseMaps: [OneObjectTypeNames, Set<string>][] = [
    ['Signature', new Set(['issuer', 'data'])]
];

// #### one.core interfaces ####

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        Signature: Signature;
    }
}

export default [SignatureRecipe];
