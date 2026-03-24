/**
 * Assertion Verifier for Group and Access Objects
 *
 * This module provides verification of assertions/certificates for Group and Access objects,
 * enabling secure sharing of these objects during chum synchronization.
 */

import type {Group, Access, IdAccess, Instance, Person} from '@refinio/one.core/lib/recipes.js';
import {getObject, storeUnversionedObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getIdObject} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {getAllEntries} from '@refinio/one.core/lib/reverse-map-query.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import {createMessageBus} from '@refinio/one.core/lib/message-bus.js';
import type {Assertion} from '../recipes/AssertionRecipes.js';

// Re-export Assertion type for convenience
export type {Assertion} from '../recipes/AssertionRecipes.js';

const MessageBus = createMessageBus('AssertionVerifier');


/**
 * Configuration for assertion verification
 */
export interface AssertionVerifierConfig {
    /** Instance owner who can make valid assertions */
    instanceOwner: SHA256IdHash<Person>;

    /** Instance ID for verification */
    instanceId: SHA256IdHash<Instance>;

    /** Whether to require signatures (future enhancement) */
    requireSignature?: boolean;

    /** Whether to check expiration dates */
    checkExpiration?: boolean;

    /** Allow assertions from other trusted instances */
    trustedInstances?: SHA256IdHash<Instance>[];
}

/**
 * Verifies assertions for Group and Access objects
 */
export class AssertionVerifier {
    private config: AssertionVerifierConfig;

    constructor(config: AssertionVerifierConfig) {
        this.config = config;
    }

    /**
     * Creates an object filter function for use with chum sync
     * This is the main entry point for apps to use
     */
    public createObjectFilter(): (hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean> {
        return async (hash: SHA256Hash | SHA256IdHash, type: string) => {
            // Only filter Group, Access, and IdAccess objects
            if (type !== 'Group' && type !== 'Access' && type !== 'IdAccess') {
                return true; // Allow all other object types
            }

            MessageBus.send('debug', `Checking assertion for ${type} object: ${hash}`);

            try {
                const hasAssertion = await this.hasValidAssertion(hash, type);

                if (hasAssertion) {
                    MessageBus.send('log', `✓ Allowing ${type} object ${hash} (valid assertion found)`);
                } else {
                    MessageBus.send('log', `✗ Blocking ${type} object ${hash} (no valid assertion)`);
                }

                return hasAssertion;
            } catch (error) {
                MessageBus.send('error', `Error checking assertion for ${hash}: ${error}`);
                return false; // Fail closed - block if we can't verify
            }
        };
    }

    /**
     * Checks if an object has a valid assertion
     */
    public async hasValidAssertion(
        objectHash: SHA256Hash | SHA256IdHash,
        objectType: string
    ): Promise<boolean> {
        try {
            // Look for assertions referencing this object
            // Note: This assumes Assertion objects have been defined in recipes
            // and reverse maps are set up for them
            const assertions = await this.getAssertionsForObject(objectHash);

            for (const assertionHash of assertions) {
                if (await this.isAssertionValid(assertionHash, objectHash, objectType)) {
                    return true;
                }
            }

            return false;
        } catch (error) {
            MessageBus.send('debug', `No assertions found for ${objectHash}: ${error}`);
            return false;
        }
    }

    /**
     * Get all assertions for a specific object
     */
    private async getAssertionsForObject(
        objectHash: SHA256Hash | SHA256IdHash
    ): Promise<SHA256Hash<Assertion>[]> {
        try {
            // Query using reverse maps for Assertion objects that reference this target
            const assertions = await getAllEntries(objectHash, 'Assertion');
            return assertions as SHA256Hash<Assertion>[];
        } catch (error) {
            MessageBus.send('debug', `Error getting assertions for ${objectHash}: ${error}`);
            return [];
        }
    }

    /**
     * Validates a specific assertion
     */
    private async isAssertionValid(
        assertionHash: SHA256Hash<Assertion>,
        targetHash: SHA256Hash | SHA256IdHash,
        objectType: string
    ): Promise<boolean> {
        try {
            const assertion = await getObject(assertionHash) as Assertion;

            // Check that assertion targets the correct object
            if (assertion.target !== targetHash) {
                return false;
            }

            // Check that assertion is from instance owner or trusted instance
            const isFromOwner = assertion.assertedBy === this.config.instanceOwner;
            const isFromTrustedInstance = this.config.trustedInstances?.includes(assertion.instanceId) ?? false;

            if (!isFromOwner && !isFromTrustedInstance) {
                MessageBus.send('debug', `Assertion from untrusted source: ${assertion.assertedBy}`);
                return false;
            }

            // Check expiration if configured
            if (this.config.checkExpiration && assertion.expiresAt) {
                if (Date.now() > assertion.expiresAt) {
                    MessageBus.send('debug', `Assertion expired: ${assertionHash}`);
                    return false;
                }
            }

            // Future: Check signature if required
            if (this.config.requireSignature && !assertion.signature) {
                MessageBus.send('debug', `Assertion missing required signature: ${assertionHash}`);
                return false;
            }

            return true;
        } catch (error) {
            MessageBus.send('debug', `Failed to validate assertion ${assertionHash}: ${error}`);
            return false;
        }
    }

    /**
     * Creates and stores an assertion for an object (for instance owners to use)
     */
    public async createAssertion(
        targetHash: SHA256Hash | SHA256IdHash,
        expiresAt?: number
    ): Promise<SHA256Hash<Assertion>> {
        const assertion: Assertion = {
            $type$: 'Assertion',
            target: targetHash,
            assertedBy: this.config.instanceOwner,
            instanceId: this.config.instanceId,
            createdAt: Date.now(),
            expiresAt
        };

        const result = await storeUnversionedObject(assertion);
        MessageBus.send('log', `Created assertion ${result.hash} for ${targetHash}`);

        return result.hash;
    }
}

/**
 * Factory function to create a simple assertion verifier
 * Apps can use this for quick setup
 */
export function createAssertionVerifier(
    instanceOwner: SHA256IdHash<Person>,
    instanceId: SHA256IdHash<Instance>,
    options?: Partial<AssertionVerifierConfig>
): AssertionVerifier {
    return new AssertionVerifier({
        instanceOwner,
        instanceId,
        ...options
    });
}