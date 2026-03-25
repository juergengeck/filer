/**
 * Contact creation helper - creates Profile and Someone objects for remote contacts
 * Platform-agnostic - works in both browser and Node.js
 */

import ProfileModel from '@refinio/one.models/lib/models/Leute/ProfileModel.js';
import SomeoneModel from '@refinio/one.models/lib/models/Leute/SomeoneModel.js';
import LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import { ensureIdHash, type SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { storeUnversionedObject, getObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { createDefaultKeysIfNotExist } from '@refinio/one.core/lib/keychain/keychain.js';

/**
 * Track profiles we've already attempted to process to prevent infinite loops
 * Maps personId -> timestamp of last attempt
 */
const processedProfiles = new Map<string, number>();
const PROFILE_RETRY_DELAY = 60000; // Don't retry for 60 seconds

/**
 * Creates a Profile and Someone object for a Person ID
 */
export async function createProfileAndSomeoneForPerson(
    personId: SHA256IdHash<any>,
    leuteModel: LeuteModel,
    profileOptions: { displayName?: string; descriptors?: any[] } = {}
): Promise<any> {
    console.log(`[ContactCreation] 📝 Creating new contact for Person ${personId?.substring(0, 8)}...`);

    try {
        // 1. Prepare PersonName and descriptors as objects (ProfileModel will store them)
        const personDescriptions: any[] = [];

        if (profileOptions.displayName) {
            console.log(`[ContactCreation] Creating PersonName: ${profileOptions.displayName}`);
            personDescriptions.push({
                $type$: 'PersonName',
                name: profileOptions.displayName
            });
        }

        // Create keys for the person and add SignKey descriptor to profile
        const { keys: keysHash } = await createDefaultKeysIfNotExist(personId, 'owner');
        const keysObject: any = await getObject(keysHash);
        if (keysObject?.publicSignKey) {
            personDescriptions.push({
                $type$: 'SignKey' as const,
                key: keysObject.publicSignKey
            });
            console.log(`[ContactCreation]   ├─ Created keys + SignKey for Person`);
        }

        // Add any additional descriptors
        if (profileOptions.descriptors && Array.isArray(profileOptions.descriptors)) {
            for (const descriptor of profileOptions.descriptors) {
                // Skip descriptors with undefined $type$ (invalid objects)
                if (!descriptor || !descriptor.$type$ || descriptor.$type$ === 'undefined') {
                    console.warn('[ContactCreation] Skipping invalid descriptor:', descriptor);
                    continue;
                }
                personDescriptions.push(descriptor);
            }
        }

        // 2. Create Profile using ProfileModel API with descriptor objects
        console.log('[ContactCreation]   ├─ Creating Profile object...');
        const profile = await ProfileModel.constructWithNewProfile(
            ensureIdHash(personId),
            await leuteModel.myMainIdentity(),
            [], // communicationEndpoints
            personDescriptions  // Descriptor objects (ProfileModel will store them)
        );

        await profile.saveAndLoad();
        console.log(`[ContactCreation]   ├─ Profile saved: ${profile.idHash.toString().substring(0, 8)}`);

        // 2. Create Someone using SomeoneModel API
        console.log('[ContactCreation]   ├─ Creating Someone object...');
        const someoneId = `someone-for-${personId}`;
        const someone = await SomeoneModel.constructWithNewSomeone(leuteModel, someoneId, profile);
        console.log(`[ContactCreation]   ├─ Someone created: ${someone.idHash.toString().substring(0, 8)}`);

        // 3. Add to contacts list (idempotent) - manual update to avoid frozen object error
        console.log('[ContactCreation]   ├─ Adding to contacts list...');
        const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');

        const leuteIdHash = await calculateIdHashOfObj({
            $type$: 'Leute',
            appId: 'one.leute'
        } as any);

        const leuteResult: any = await getObjectByIdHash(leuteIdHash as any);
        const updatedLeute = {
            ...leuteResult.obj,
            other: [...new Set([...leuteResult.obj.other, someone.idHash])]
        };

        await storeVersionedObject(updatedLeute as any);

        // Reload the model to reflect the updated contacts list
        if (typeof (leuteModel as any).loadLatestVersion === 'function') {
            await (leuteModel as any).loadLatestVersion();
        }
        console.log('[ContactCreation]   └─ ✅ Contact creation complete!');

        return someone;
    } catch (error) {
        console.error('[ContactCreation] Error creating Profile/Someone:', error);
        throw error;
    }
}

/**
 * Ensures a contact exists for a Person ID - creates if needed
 */
export async function ensureContactExists(
    personId: SHA256IdHash<any>,
    leuteModel: LeuteModel,
    profileOptions: { displayName?: string; descriptors?: any[] } = {}
): Promise<any> {
    console.log(`[ContactCreation] Ensuring contact for Person ${personId?.substring(0, 8)}...`);

    // Check if contact already exists
    try {
        const others = await leuteModel.others();
        if (others && Array.isArray(others) && others.length > 0) {
            for (const contact of others) {
                if (!contact) continue;

                try {
                    const contactPersonId = await contact.mainIdentity();

                    if (contactPersonId && contactPersonId.toString() === personId.toString()) {
                        console.log(`[ContactCreation] Found existing Someone ${contact.idHash.toString().substring(0, 8)} with matching Person ID`);
                        return contact;
                    }
                } catch (identityError: any) {
                    console.warn(`[ContactCreation] Error getting identity for contact:`, identityError);
                }
            }
        }
    } catch (othersError: any) {
        console.warn(`[ContactCreation] Error checking existing contacts:`, othersError);
    }

    // No existing contact found - create new one
    console.log(`[ContactCreation] No existing Someone found for Person ${personId}. Creating Profile and Someone...`);
    try {
        const someone = await createProfileAndSomeoneForPerson(personId, leuteModel, profileOptions);
        console.log(`[ContactCreation] ✅ Successfully created and added contact for Person ${personId}`);
        return someone;
    } catch (creationError: any) {
        console.error(`[ContactCreation] Failed to create Profile/Someone for Person ${personId}:`, creationError);
        throw creationError;
    }
}

/**
 * Handle Profile data received via CHUM
 * The Profile has already been stored by ONE.core CHUM sync - we just need to create Someone
 */
export async function handleReceivedProfile(
    personId: SHA256IdHash<any>,
    profileData: any,
    leuteModel: LeuteModel
): Promise<void> {
    console.log('[ContactCreation] 📦 Received Profile via CHUM for:', personId?.substring(0, 8));

    // Check if we've recently attempted to process this profile
    const lastAttempt = processedProfiles.get(personId.toString());
    if (lastAttempt && (Date.now() - lastAttempt) < PROFILE_RETRY_DELAY) {
        console.log('[ContactCreation] ⏸️  Skipping - recently attempted processing this profile');
        return;
    }

    // Mark as being processed
    processedProfiles.set(personId.toString(), Date.now());

    // Check if Someone already exists for this Person FIRST
    // (avoids trying to load locally-created Profiles that trigger onNewVersion)
    const others = await leuteModel.others();
    if (others && Array.isArray(others)) {
        for (const contact of others) {
            if (!contact) continue;
            const contactPersonId = await contact.mainIdentity();
            if (contactPersonId && contactPersonId.toString() === personId.toString()) {
                console.log('[ContactCreation] Someone already exists for this Profile - skipping');
                processedProfiles.delete(personId.toString());
                return;
            }
        }
    }

    // Someone doesn't exist - this is a Profile from CHUM sync or other source
    // Ensure Profile has a PersonName before storing
    if (!profileData.personDescriptions || !Array.isArray(profileData.personDescriptions)) {
        profileData.personDescriptions = [];
    }

    // Do NOT store fake "Contact {hash}" as PersonName — it poisons all downstream caches.
    // Display layers handle missing names at render time.

    // Store to ensure vheads exist (CHUM sends object data but not version nodes)
    console.log('[ContactCreation] Creating Someone for Profile from CHUM/external source...');
    const { storeVersionedObject } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
    const storedResult = await storeVersionedObject(profileData);
    console.log('[ContactCreation] Stored Profile via CHUM - hash:', storedResult.hash.substring(0, 8), 'idHash:', storedResult.idHash.substring(0, 8));

    // Load the Profile
    console.log('[ContactCreation] Loading Profile for personId:', personId.substring(0, 8), 'owner:', personId.substring(0, 8));
    const profile = await ProfileModel.constructFromLatestVersionByIdFields(
        personId,
        personId
    );
    console.log('[ContactCreation] ✅ Loaded Profile idHash:', profile.idHash.substring(0, 8));

    // Create Someone object
    const someoneId = `someone-for-${personId}`;
    const someone = await SomeoneModel.constructWithNewSomeone(leuteModel, someoneId, profile);
    console.log('[ContactCreation] ✅ Someone created:', someone.idHash.toString().substring(0, 8));

    // Add to contacts list
    const { getObjectByIdHash } = await import('@refinio/one.core/lib/storage-versioned-objects.js');
    const leuteIdHash = await calculateIdHashOfObj({
        $type$: 'Leute',
        appId: 'one.leute'
    } as any);

    const leuteResult: any = await getObjectByIdHash(leuteIdHash as any);
    const updatedLeute = {
        ...leuteResult.obj,
        other: [...new Set([...leuteResult.obj.other, someone.idHash])]
    };

    await storeVersionedObject(updatedLeute as any);

    // Reload the model to reflect the updated contacts list
    if (typeof (leuteModel as any).loadLatestVersion === 'function') {
        await (leuteModel as any).loadLatestVersion();
    }
    console.log('[ContactCreation] ✅ Someone added to contacts list');

    // Success - remove from processed profiles
    processedProfiles.delete(personId.toString());
}
