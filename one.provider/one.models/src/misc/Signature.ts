import type {PublicSignKey} from '@refinio/one.core/lib/crypto/sign.js';
import {ensurePublicSignKey} from '@refinio/one.core/lib/crypto/sign.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Person} from '@refinio/one.core/lib/recipes.js';
import {getInstanceOwnerIdHash} from '@refinio/one.core/lib/instance.js';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import tweetnacl from 'tweetnacl';
import type {Signature} from '../recipes/SignatureRecipes.js';
import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {
    getObjectWithType,
    storeUnversionedObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {HexString} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {
    hexToUint8Array,
    uint8arrayToHexString
} from '@refinio/one.core/lib/util/arraybuffer-to-and-from-hex-string.js';
import {createCryptoApiFromDefaultKeys} from '@refinio/one.core/lib/keychain/keychain.js';

/**
 * Sign an object with my own key.
 *
 * @param data - The data which to sign.
 * @param issuer - the issuer of the signature
 */
export async function sign(
    data: SHA256Hash,
    issuer?: SHA256IdHash<Person>
): Promise<UnversionedObjectResult<Signature>> {
    // If not issuer specified use the instance owner
    if (issuer === undefined) {
        issuer = getInstanceOwnerIdHash();
        if (issuer === undefined) {
            throw new Error('Instance is not initialized');
        }
    }

    // Sign the data hash with the crypto API
    const cryptoAPI = await createCryptoApiFromDefaultKeys(issuer);
    const signatureBinary = cryptoAPI.sign(new TextEncoder().encode(data));
    const signatureString = uint8arrayToHexString(signatureBinary);

    return await storeUnversionedObject({
        $type$: 'Signature',
        issuer: issuer,
        data: data,
        signature: signatureString
    });
}

/**
 * Get all signatures that exist for the passed object.
 *
 * @param data - signatures for this object are returned.
 * @param issuer - If specified only return signatures for this issuer.
 */
export async function getSignatures(
    data: SHA256Hash,
    issuer?: SHA256IdHash<Person>
): Promise<Signature[]> {
    const signatureObjectHashes = await getAllEntries(data, 'Signature');
    const signatureObjects = await Promise.all(
        signatureObjectHashes.map(hash => getObjectWithType(hash))
    );
    if (issuer === undefined) {
        return signatureObjects;
    } else {
        return signatureObjects.filter(sig => sig.issuer === issuer);
    }
}

export function verifySignatureWithMultipleKeys(
    keys: PublicSignKey[],
    signature: Signature
): PublicSignKey | undefined {
    for (const key of keys) {
        if (verifySignatureWithSingleKey(key, signature)) {
            return key;
        }
    }

    return undefined;
}

export function verifySignatureWithMultipleHexKeys<KeyT extends PublicSignKey | HexString>(
    keys: HexString[],
    signature: Signature
): HexString | undefined {
    const binaryKeys = keys.map(k => ensurePublicSignKey(hexToUint8Array(k)));

    const matchedKey = verifySignatureWithMultipleKeys(binaryKeys, signature);

    if (matchedKey === undefined) {
        return undefined;
    }

    return keys[binaryKeys.findIndex(k => k === matchedKey)];
}

export function verifySignatureWithSingleKey(key: PublicSignKey, signature: Signature): boolean {
    return tweetnacl.sign.detached.verify(
        new TextEncoder().encode(signature.data), // string -> utf8 UInt8Array
        hexToUint8Array(signature.signature), // hex string -> UInt8Array (binary)
        key
    );
}
