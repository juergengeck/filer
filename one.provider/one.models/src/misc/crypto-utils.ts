/**
 * Crypto utilities for one.models
 * Uses tweetnacl for random byte generation
 */

import tweetnacl from 'tweetnacl';

/**
 * Get random bytes using tweetnacl
 * Requires PRNG to be properly initialized
 */
export function getRandomBytes(length: number): Uint8Array {
    return tweetnacl.randomBytes(length);
}


/**
 * Get a single random byte (common use case)
 */
export function getRandomByte(): number {
    return getRandomBytes(1)[0];
}

