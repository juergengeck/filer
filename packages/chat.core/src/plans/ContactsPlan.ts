/**
 * Contacts Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for contact management operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api architecture.
 */

import { Group, Person, HashGroup } from '@refinio/one.core/lib/recipes.js';
import {
  storeVersionedObject,
  getObjectByIdHash,
  getIdObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
  storeUnversionedObject,
  getObject
} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { ensureIdHash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { getDefaultKeys } from '@refinio/one.core/lib/keychain/keychain.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js';
// StoryFactory type (defined locally to avoid moduleResolution issues)
interface StoryFactory {
  recordExecution(context: any, operation: () => Promise<any>): Promise<{ result: any; storyId?: any; assemblyId?: any }>;
}

export interface Contact {
  id: string;
  personId: string;
  name: string;
  email?: string;
  avatarBlobHash?: string;
  isAI: boolean;
  modelId?: string;
  canMessage: boolean;
  isConnected: boolean;
  status?: 'owner' | 'connected' | 'disconnected';
}

export interface ContactWithTrust extends Contact {
  trustLevel: string;
  canSync: boolean;
  discoverySource: string;
  discoveredAt: number;
}

export interface GetContactsResponse {
  success: boolean;
  data?: Contact[];
  error?: string;
}

export interface GetContactsWithTrustResponse {
  success: boolean;
  data?: ContactWithTrust[];
  error?: string;
}

/**
 * ContactsPlan - Pure business logic for contact operations
 *
 * Dependencies are injected via constructor to support both platforms:
 * - nodeOneCore: Platform-specific ONE.core instance
 */
export class ContactsPlan {
  static get planName(): string { return 'Contacts'; }
  static get description(): string { return 'Manages contacts, groups, and trust relationships'; }
  static get version(): string { return '1.0.0'; }

  // Stable Plan ID for Story/Assembly tracking
  static get planId(): SHA256IdHash<any> {
    // TODO: Generate proper Plan ID hash
    return 'plan-contacts-core-v1' as SHA256IdHash<any>;
  }

  private nodeOneCore: any;
  private storyFactory?: StoryFactory;

  constructor(nodeOneCore: any, storyFactory?: StoryFactory) {
    this.nodeOneCore = nodeOneCore;
    this.storyFactory = storyFactory;
  }

  /**
   * Set StoryFactory after initialization (for gradual adoption)
   */
  setStoryFactory(factory: StoryFactory): void {
    this.storyFactory = factory;
  }

  /**
   * Get current instance version hash for Story/Assembly tracking
   */
  private getCurrentInstanceVersion(): string {
    // Try to get from nodeOneCore, fallback to timestamp if not available
    return this.nodeOneCore.instanceVersion || `instance-${Date.now()}`;
  }

  /**
   * Invalidate the contacts cache (deprecated - no-op)
   */
  invalidateCache(): void {
    // No-op - we don't cache locally
  }

  /**
   * Get all contacts
   */
  async getContacts(): Promise<GetContactsResponse> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const me = await this.nodeOneCore.leuteModel.me();
      const others = await this.nodeOneCore.leuteModel.others();
      const allContacts: Contact[] = [];

      // Process all contacts in parallel instead of sequential for-loop
      const processedPersonIds = new Set<string>();

      const processContact = async (someone: any, isOwner: boolean): Promise<Contact | null> => {
        try {
          const personId: any = await someone.mainIdentity();
          if (!personId) return null;

          // Skip duplicates
          if (processedPersonIds.has(personId)) return null;
          processedPersonIds.add(personId);

          const profile: any = await someone.mainProfile();

          let displayName = '';
          let email: string | undefined;
          let avatarBlobHash: string | undefined;

          if (profile) {
            try {
              const personNames = profile.descriptionsOfType?.('PersonName');
              if (personNames?.length > 0) {
                displayName = (personNames[0] as any).name || '';
              }
            } catch {
              if (profile.personDescriptions && Array.isArray(profile.personDescriptions)) {
                const nameDesc = profile.personDescriptions.find((d: any) => d.$type$ === 'PersonName');
                if (nameDesc && 'name' in nameDesc) displayName = nameDesc.name;
              }
            }

            try {
              const emails = profile.descriptionsOfType?.('Email');
              if (emails?.length > 0) email = (emails[0] as any).email || '';
            } catch { /* no email */ }

            try {
              const profileImages = profile.descriptionsOfType?.('ProfileImage');
              if (profileImages?.length > 0) {
                avatarBlobHash = (profileImages[profileImages.length - 1] as any).image;
              }
            } catch { /* no avatar */ }
          }

          // Check AI status (sync lookups, no await needed)
          let isAI = false;
          let modelId: string | undefined;
          let aiDisplayName: string | undefined;
          if (this.nodeOneCore.aiAssistantModel) {
            isAI = this.nodeOneCore.aiAssistantModel.isAIPerson(personId);
            if (isAI) {
              const ai = this.nodeOneCore.aiAssistantModel.getAI(personId);
              if (ai) {
                aiDisplayName = ai.displayName;
                modelId = ai.modelId;
              } else {
                modelId = this.nodeOneCore.aiAssistantModel.getModelIdForPersonId(personId);
              }
            }
          }

          if (!displayName) {
            if (isAI && aiDisplayName) displayName = aiDisplayName;
            else if (isAI && modelId) displayName = modelId;
            else {
              // mainProfile had no PersonName — check additional profiles
              // This handles the case where the stub profile from pairing is
              // still mainProfile but the real synced profile has the actual name
              try {
                const allProfiles = await someone.profiles();
                for (const p of allProfiles) {
                  try {
                    const pNames = p.descriptionsOfType?.('PersonName');
                    if (pNames && pNames.length > 0) {
                      displayName = (pNames[0] as any).name || '';
                      if (displayName) break;
                    }
                  } catch {
                    // Skip this profile
                  }
                }
              } catch {
                // profiles() not available
              }

              if (!displayName) {
                console.log(`[ContactsPlan] NO NAME for ${String(personId).substring(0, 12)}: profile=${!!profile}, descriptionsOfType=${typeof profile?.descriptionsOfType}, personDescriptions=${profile?.personDescriptions?.length}`);
                displayName = `Contact ${String(personId).substring(0, 8)}`;
              }
            }
          }

          return {
            id: someone.idHash,
            personId,
            name: displayName,
            email,
            avatarBlobHash,
            isAI,
            modelId,
            canMessage: true,
            isConnected: isAI,
            status: isOwner ? 'owner' : undefined
          };
        } catch (contactError) {
          console.error('[ContactsPlan] Failed to process contact, skipping:', contactError);
          return null;
        }
      };

      // Process "me" first (needs isOwner=true), then all others in parallel
      const meContact = await processContact(me, true);
      if (meContact) allContacts.push(meContact);

      const otherResults = await Promise.all(others.map((s: any) => processContact(s, false)));
      for (const contact of otherResults) {
        if (contact) allContacts.push(contact);
      }

      console.log(`[ContactsPlan] ✅ Returning ${allContacts.length} contacts (${allContacts.filter(c => c.isAI).length} AI)`);

      return {
        success: true,
        data: allContacts
      };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get contacts:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get all contacts with trust information using trust.core
   * Platform-agnostic: Uses TrustModel only, no transport dependencies
   */
  async getContactsWithTrust(): Promise<GetContactsWithTrustResponse> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      // Get basic contacts first
      const basicResult = await this.getContacts();
      if (!basicResult.success || !basicResult.data) {
        return { success: false, error: basicResult.error || 'Failed to get contacts' };
      }

      // Build source map from "source:*" groups
      const sourceMap = await this.buildSourceMap();

      // Enhance with trust information using trust.core (platform-agnostic)
      const contactsWithTrust: ContactWithTrust[] = await Promise.all(
        basicResult.data.map(async (contact: Contact): Promise<ContactWithTrust> => {
          let trustLevel = 'unknown';
          let canMessage = true;  // Default permissive
          let canSync = false;

          // Get trust info from trust.core TrustModel (platform-agnostic)
          if (this.nodeOneCore.trustModel) {
            try {
              // Get trust status from TrustRelationship objects
              const trustStatus = await this.nodeOneCore.trustModel.getTrustStatus(contact.personId);

              if (trustStatus) {
                trustLevel = trustStatus;  // 'trusted', 'untrusted', 'pending', 'revoked'

                // Evaluate trust to get communication permissions
                const evaluation = await this.nodeOneCore.trustModel.evaluateTrust(contact.personId, 'communication');
                canMessage = evaluation.level > 0.3;  // Threshold for messaging
                canSync = evaluation.level > 0.7;     // Higher threshold for data sync
              }
            } catch (err) {
              console.warn(`[ContactsPlan] Could not get trust info for ${contact.name}:`, err);
              // Keep defaults if trust unavailable
            }
          }

          return {
            ...contact,
            trustLevel,
            canSync,
            discoverySource: sourceMap.get(contact.personId) || 'leute',
            discoveredAt: Date.now()
          };
        })
      );

      return { success: true, data: contactsWithTrust };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get contacts with trust:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Build a map of personId → source name from "source:*" groups.
   * Groups named "source:glue", "source:molt", etc. categorize contacts by origin.
   */
  private async buildSourceMap(): Promise<Map<string, string>> {
    const sourceMap = new Map<string, string>();

    try {
      const groups = await this.nodeOneCore.leuteModel.groups();
      for (const group of groups) {
        const name = group.internalGroupName;
        if (name?.startsWith('source:')) {
          const sourceName = name.substring(7); // strip "source:"
          for (const personId of group.persons) {
            sourceMap.set(personId, sourceName);
          }
        }
      }
    } catch (err) {
      console.warn('[ContactsPlan] Could not load source groups:', err);
    }

    return sourceMap;
  }

  /**
   * Get pending contacts (contacts awaiting acceptance)
   */
  async getPendingContacts(): Promise<{ success: boolean; pendingContacts?: any[]; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: true, pendingContacts: [] };
      }

      const pendingContacts = this.nodeOneCore.quicTransport.leuteModel.getPendingContacts();
      return { success: true, pendingContacts };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get pending contacts:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get specific pending contact details
   */
  async getPendingContact(pendingId: string): Promise<{ success: boolean; pendingContact?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      const pendingContact = this.nodeOneCore.quicTransport.leuteModel.getPendingContact(pendingId);
      if (!pendingContact) {
        return { success: false, error: 'Pending contact not found' };
      }

      return { success: true, pendingContact };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get pending contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Accept a pending contact (update trust level)
   */
  async acceptContact(personId: string, options: any = {}): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.trustManager) {
        return { success: false, error: 'Trust manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.trustManager.acceptContact(personId, options);
      return result;
    } catch (error) {
      console.error('[ContactsPlan] Failed to accept contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Block a contact
   */
  async blockContact(personId: string, reason: string): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.trustManager) {
        return { success: false, error: 'Trust manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.trustManager.blockContact(personId, reason);
      return result;
    } catch (error) {
      console.error('[ContactsPlan] Failed to block contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Reject a pending contact
   */
  async rejectContact(pendingId: string, reason: string): Promise<{ success: boolean; error?: string; [key: string]: any }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      const result = await this.nodeOneCore.quicTransport.leuteModel.rejectContact(pendingId, reason);
      return result;
    } catch (error) {
      console.error('[ContactsPlan] Failed to reject contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Add a new contact
   * Creates Person, Profile, and Someone objects
   *
   * ASSEMBLY TRIGGER: Case #5 - Store Someone/Profile (Identity Domain)
   */
  async addContact(personInfo: { name: string; email: string; modelId?: string }): Promise<{ success: boolean; contact?: any; error?: string }> {
    const userId = this.nodeOneCore.ownerId || this.nodeOneCore.leuteModel?.myMainIdentity();

    // Wrap operation with Story + Assembly recording
    if (this.storyFactory) {
      try {
        const result = await this.storyFactory.recordExecution(
          {
            title: `Contact "${personInfo.name}" added`,
            description: `Creating contact: ${personInfo.name} (${personInfo.email})`,
            planId: ContactsPlan.planId,
            owner: userId || 'unknown',
            domain: 'identity',
            instanceVersion: this.getCurrentInstanceVersion(),

            // TRIGGER ASSEMBLY CREATION (case #5: Store Someone/Profile)
            supply: {
              domain: 'identity',
              keywords: ['profile', 'contact', 'someone'],
              ownerId: userId || 'unknown',
              subjects: []
            },
            demand: {
              domain: 'identity',
              keywords: ['contact-management', 'identity-storage'],
              trustLevel: 'me'
            },
            matchScore: 1.0
          },
          async () => {
            return await this.addContactInternal(personInfo);
          }
        );

        return result.result!;
      } catch (error) {
        console.error('[ContactsPlan] Error adding contact:', error);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    }

    // Fallback if no StoryFactory (gradual adoption)
    return await this.addContactInternal(personInfo);
  }

  /**
   * Internal implementation of addContact (wrapped by Story+Assembly recording)
   */
  private async addContactInternal(personInfo: { name: string; email: string; modelId?: string }): Promise<{ success: boolean; contact?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        throw new Error('Leute model not initialized');
      }

      // AI contact: modelId means "create an AI person backed by this LLM substrate".
      // AI = person (contact identity), LLM = substrate (interchangeable model).
      // Delegates to AIAssistantPlan which creates Person/Profile/Someone and
      // registers in AIManager (aiByPerson cache) and LLMObjectManager (llmObjects cache).
      if (personInfo.modelId && this.nodeOneCore.aiAssistantModel) {
        console.log(`[ContactsPlan] Creating AI contact via AIAssistantPlan: ${personInfo.name} (${personInfo.modelId})`);

        // ensureAIForModel creates Person/Profile/Someone AND registers in AIManager
        const personIdHash = await this.nodeOneCore.aiAssistantModel.ensureAIForModel(
          personInfo.modelId,
          personInfo.name,
          personInfo.email
        );

        console.log(`[ContactsPlan] AI contact created: ${personIdHash.toString().substring(0, 8)}...`);

        return {
          success: true,
          contact: {
            personHash: personIdHash,
            isAI: true,
            modelId: personInfo.modelId
          }
        };
      }

      // Regular contact: create Person/Profile/Someone manually
      // Create Person object with proper type
      const personData: { $type$: 'Person'; email: string; name: string } = {
        $type$: 'Person' as const,
        email: personInfo.email,
        name: personInfo.name
      };

      const personResult = await storeVersionedObject(personData);
      const personIdHash = ensureIdHash(typeof personResult === 'object' && personResult?.idHash ? personResult.idHash : personResult);

      // Get my identity
      const myId = await this.nodeOneCore.leuteModel.myMainIdentity();

      // Store PersonName object first (personDescription contains hash-links)
      const personNameObj = {
        $type$: 'PersonName' as const,
        name: personInfo.name
      };
      const personNameResult = await storeUnversionedObject(personNameObj);
      const personNameHash = personNameResult.hash;

      // Create Profile object directly (following AIContactManager pattern)
      const profileObj: {
        $type$: 'Profile';
        personId: any;
        owner: any;
        personDescription: any[];
        communicationEndpoint: any[];
      } = {
        $type$: 'Profile' as const,
        personId: personIdHash,
        owner: myId,
        personDescription: [personNameHash],
        communicationEndpoint: []
      };

      const profileResult = await storeVersionedObject(profileObj);
      const profileIdHash = ensureIdHash(typeof profileResult === 'object' && profileResult?.idHash ? profileResult.idHash : profileResult);

      // Create Someone object with identities Map
      const someoneData: {
        $type$: 'Someone';
        someoneId: string;
        mainProfile: any;
        identities: Map<any, Set<any>>;
      } = {
        $type$: 'Someone' as const,
        someoneId: personInfo.email,
        mainProfile: profileIdHash,
        identities: new Map([[personIdHash, new Set([profileIdHash])]])
      };

      const someoneResult = await storeVersionedObject(someoneData);
      const someoneIdHash = ensureIdHash(typeof someoneResult === 'object' && someoneResult?.idHash ? someoneResult.idHash : someoneResult);

      // Add to LeuteModel using addProfile
      await (this.nodeOneCore.leuteModel as any).addProfile(profileIdHash);

      return {
        success: true,
        contact: {
          personHash: personIdHash,
          profileHash: profileIdHash,
          someoneHash: someoneIdHash,
          person: personData,
          isAI: false
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Ensure a contact exists for a given Person ID
   * Used by discovery/trust flows that already have a personId
   * Returns existing Someone if found, creates new one if not
   *
   * @param personId - The Person ID hash (derived from email)
   * @param displayName - Display name for the contact
   * @returns The Someone model for this person
   */
  async ensureContactForPerson(personId: string, displayName: string): Promise<{ success: boolean; someone?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const leuteModel = this.nodeOneCore.leuteModel;
      const myPersonId = await leuteModel.myMainIdentity();

      // Don't create contact for owner - they're already in Leute.me
      if (personId === myPersonId?.toString()) {
        console.log('[ContactsPlan] ensureContactForPerson: Skipping owner');
        return { success: true, someone: await leuteModel.me() };
      }

      // Check if contact already exists in others
      const others = await leuteModel.others();
      for (const someone of others) {
        try {
          const contactPersonId = await someone.mainIdentity();
          if (contactPersonId?.toString() === personId) {
            console.log(`[ContactsPlan] ensureContactForPerson: Found existing contact for ${personId.substring(0, 8)}`);
            return { success: true, someone };
          }
        } catch {
          continue;
        }
      }

      // Create new contact using ProfileModel and SomeoneModel
      console.log(`[ContactsPlan] ensureContactForPerson: Creating contact for ${personId.substring(0, 8)}`);

      const ProfileModel = (await import('@refinio/one.models/lib/models/Leute/ProfileModel.js')).default;
      const SomeoneModel = (await import('@refinio/one.models/lib/models/Leute/SomeoneModel.js')).default;
      const { ensureIdHash } = await import('@refinio/one.core/lib/util/type-checks.js');

      // Create Profile
      const profile = await ProfileModel.constructWithNewProfile(
        ensureIdHash(personId),
        myPersonId,
        [],
        []
      );

      // Add display name
      profile.personDescriptions.push({
        $type$: 'PersonName',
        name: displayName
      });
      await profile.saveAndLoad();

      // Create Someone
      const someoneId = `someone-for-${personId}`;
      const someone = await SomeoneModel.constructWithNewSomeone(leuteModel, someoneId, profile);

      // Add to contacts via LeuteModel
      await leuteModel.addSomeoneElse(someone.idHash);

      console.log(`[ContactsPlan] ensureContactForPerson: Created contact ${someone.idHash?.toString().substring(0, 8)}`);
      return { success: true, someone };
    } catch (error) {
      console.error('[ContactsPlan] ensureContactForPerson failed:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Remove a contact
   */
  async removeContact(contactId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      await this.nodeOneCore.leuteModel.removeSomeoneElse(contactId as any);
      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to remove contact:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Revoke contact's VC
   */
  async revokeContactVC(personId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.nodeOneCore.quicTransport?.leuteModel) {
        return { success: false, error: 'Contact manager not initialized' };
      }

      await this.nodeOneCore.quicTransport.leuteModel.revokeContactVC(personId);
      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to revoke contact VC:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  // ===== Group Management (using core Group objects) =====

  /**
   * Get all groups using core Group objects
   */
  async getGroups(): Promise<{ success: boolean; groups?: any[]; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      // Get all groups via LeuteModel (returns GroupModel[] - we extract Group data)
      const groupModels = await this.nodeOneCore.leuteModel.groups();
      const groupList = [];

      for (const groupModel of groupModels) {
        // Extract core Group data (avoid GroupModel abstractions)
        const groupData = {
          id: groupModel.groupIdHash,  // Core Group ID hash
          name: groupModel.internalGroupName,
          memberCount: groupModel.persons?.length || 0
        };
        groupList.push(groupData);
      }

      return { success: true, groups: groupList };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get groups:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create a new group using core Group object
   *
   * ASSEMBLY TRIGGER: Case #5 - Create a group (Identity Domain)
   */
  async createGroup(name: string, memberIds?: string[]): Promise<{ success: boolean; group?: any; error?: string }> {
    const userId = this.nodeOneCore.ownerId || this.nodeOneCore.leuteModel?.myMainIdentity();

    // Wrap operation with Story + Assembly recording
    if (this.storyFactory) {
      try {
        const result = await this.storyFactory.recordExecution(
          {
            title: `Group "${name}" created`,
            description: `Creating group: ${name} with ${memberIds?.length || 0} members`,
            planId: ContactsPlan.planId,
            owner: userId || 'unknown',
            domain: 'identity',
            instanceVersion: this.getCurrentInstanceVersion(),

            // TRIGGER ASSEMBLY CREATION (case #5: Create group)
            supply: {
              domain: 'identity',
              keywords: ['group', 'membership', 'collaboration'],
              ownerId: userId || 'unknown',
              subjects: []
            },
            demand: {
              domain: 'identity',
              keywords: ['group-creation', 'team-management'],
              trustLevel: 'group'
            },
            matchScore: 1.0
          },
          async () => {
            return await this.createGroupInternal(name, memberIds);
          }
        );

        return result.result!;
      } catch (error) {
        console.error('[ContactsPlan] Error creating group:', error);
        return {
          success: false,
          error: (error as Error).message
        };
      }
    }

    // Fallback if no StoryFactory (gradual adoption)
    return await this.createGroupInternal(name, memberIds);
  }

  /**
   * Internal implementation of createGroup (wrapped by Story+Assembly recording)
   */
  private async createGroupInternal(name: string, memberIds?: string[]): Promise<{ success: boolean; group?: any; error?: string }> {
    try {
      const ownerId = this.nodeOneCore.ownerId ?? await this.nodeOneCore.leuteModel?.myMainIdentity?.();
      if (!ownerId) {
        throw new Error('Cannot create group without an owner identity');
      }

      // Create core Group object directly
      // Create HashGroup with members first (HashGroup.person is a Set in new one.core)
      const memberArray: SHA256IdHash<Person>[] = memberIds ? memberIds.map(id => ensureIdHash<Person>(id)) : [];
      const hashGroupObj: HashGroup = {
        $type$: 'HashGroup',
        person: new Set(memberArray)
      };
      const hashGroup = await storeUnversionedObject(hashGroupObj);

      // Create Group referencing HashGroup
      const group: Group = {
        $type$: 'Group',
        name: name || `group-${Date.now()}`,
        owner: ownerId,
        hashGroup: hashGroup.hash
      };

      // Store using one.core API
      const result = await storeVersionedObject(group);

      // Grant access via HashGroup - members of this group can receive the Group object via CHUM
      console.log(`[ContactsPlan] Granting access to Group ${String(result.idHash).substring(0, 8)} via HashGroup ${String(hashGroup.hash).substring(0, 8)}`);
      await createAccess([{
        id: result.idHash,
        person: [],
        hashGroup: [hashGroup.hash],  // Access tied to HashGroup membership
        mode: SET_ACCESS_MODE.ADD
      }]);

      return {
        success: true,
        group: {
          id: result.idHash,
          name: group.name,
          memberCount: memberArray.length
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Add contacts to a group (core Group pattern)
   */
  async addContactsToGroup(groupId: string, contactIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current Group object
      const groupIdHash = ensureIdHash(groupId) as SHA256IdHash<Group>;
      const groupResult = await getObjectByIdHash(groupIdHash);
      const group: Group = groupResult.obj;

      // Resolve HashGroup to get current members
      const hashGroupResult = await getObject(group.hashGroup);
      const members = new Set(hashGroupResult.person);

      // Add new members
      for (const contactId of contactIds) {
        const personIdHash = ensureIdHash(contactId) as SHA256IdHash<Person>;
        members.add(personIdHash);
      }

      // Create new HashGroup with updated members
      const newHashGroup = await storeUnversionedObject<HashGroup<Person>>({
        $type$: 'HashGroup',
        person: members
      });

      // Update Group to reference new HashGroup
      await storeVersionedObject({
        $type$: 'Group',
        $versionHash$: (group as any).$versionHash$,
        name: group.name,
        owner: group.owner,
        hashGroup: newHashGroup.hash,
        participants: group.participants
      });

      // Grant access via the new HashGroup (contains all members including new ones)
      console.log(`[ContactsPlan] Granting access to Group ${String(groupIdHash).substring(0, 8)} via updated HashGroup ${String(newHashGroup.hash).substring(0, 8)}`);
      await createAccess([{
        id: groupIdHash,
        person: [],
        hashGroup: [newHashGroup.hash],  // Access tied to updated HashGroup membership
        mode: SET_ACCESS_MODE.ADD
      }]);

      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to add contacts to group:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Remove contacts from a group (core Group pattern)
   */
  async removeContactsFromGroup(groupId: string, contactIds: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Get current Group object
      const groupIdHash = ensureIdHash(groupId) as SHA256IdHash<Group>;
      const groupResult = await getObjectByIdHash(groupIdHash);
      const group: Group = groupResult.obj;

      // Resolve HashGroup to get current members
      const hashGroupResult: HashGroup<Person> = await getObject(group.hashGroup);
      const members = new Set(hashGroupResult.person);

      // Remove members
      for (const contactId of contactIds) {
        const personIdHash = ensureIdHash(contactId) as SHA256IdHash<Person>;
        members.delete(personIdHash);
      }

      // Create new HashGroup with updated members
      const newHashGroup = await storeUnversionedObject({
        $type$: 'HashGroup',
        person: members
      });

      // Update Group to reference new HashGroup
      await storeVersionedObject({
        $type$: 'Group',
        $versionHash$: (group as any).$versionHash$,
        name: group.name,
        owner: group.owner,
        hashGroup: newHashGroup.hash,
        participants: group.participants
      });

      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to remove contacts from group:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get group members (core Group pattern)
   */
  async getGroupMembers(groupId: string): Promise<{ success: boolean; members?: any[]; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      // Get Group object
      const groupIdHash = ensureIdHash(groupId) as SHA256IdHash<Group>;
      const result = await getObjectByIdHash(groupIdHash);
      const group: Group = result.obj;

      // Resolve HashGroup to get members
      const hashGroupResult: HashGroup<Person> = await getObject(group.hashGroup);
      const memberIds = hashGroupResult.person;

      // Get member details
      const members = [];
      const someoneObjects = await this.nodeOneCore.leuteModel.others();

      for (const personIdHash of memberIds) {
        const someone = someoneObjects.find((s: any) => s.mainIdentity() === personIdHash);

        if (someone) {
          const profile = await someone.mainProfile();
          const name = profile?.personDescriptions?.find((d: any) => d.$type$ === 'PersonName')?.name || 'Unknown';

          members.push({
            id: personIdHash,
            name
          });
        }
      }

      return { success: true, members };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get group members:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Delete a group - NOTE: Groups cannot be truly deleted in ONE.core
   * This marks the group as deleted by removing all members
   */
  async deleteGroup(groupId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get Group object
      const groupIdHash = ensureIdHash(groupId) as SHA256IdHash<Group>;
      const result = await getObjectByIdHash(groupIdHash);
      const group: Group = result.obj;

      // Create empty HashGroup (soft delete)
      const emptyHashGroup = await storeUnversionedObject({
        $type$: 'HashGroup',
        person: new Set<SHA256IdHash<Person>>()
      });

      // Update Group to reference empty HashGroup
      await storeVersionedObject({
        $type$: 'Group',
        $versionHash$: (group as any).$versionHash$,
        name: group.name,
        owner: group.owner,
        hashGroup: emptyHashGroup.hash,
        participants: group.participants
      });

      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to delete group:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  // ===== Profile Management Methods =====

  /**
   * Get all profiles for a Someone contact
   *
   * Takes the Someone's idHash (Contact.id) and loads profiles directly.
   * Falls back to personId lookup for backwards compatibility.
   */
  async getProfilesForSomeone(request: { personId: string }): Promise<{ success: boolean; profiles?: any[]; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const id = request.personId;  // This is now the Someone idHash (Contact.id)

      // Get all contacts (me + others)
      const me = await this.nodeOneCore.leuteModel.me();
      const others = await this.nodeOneCore.leuteModel.others();
      const allContacts = [me, ...others];

      // Find the Someone with matching idHash
      let someone = allContacts.find((s: any) => s.idHash === id);

      // Backwards compatibility: if not found by idHash, try as personId
      if (!someone) {
        someone = await this.nodeOneCore.leuteModel.getSomeone(id as SHA256IdHash<Person>);
      }

      if (!someone) {
        return { success: false, error: 'Contact not found' };
      }

      // Get the Person identity email (the email used to create the Person object)
      let personEmail: string | undefined;
      try {
        const mainIdentity = await someone.mainIdentity();
        const personObj = await getIdObject(mainIdentity);
        personEmail = (personObj as any).email;
      } catch (e) {
        // Person email not available
      }

      // Get main profile for comparison
      const mainProfile = await someone.mainProfile();
      const mainProfileIdHash = mainProfile?.idHash;
      console.log(`[ContactsPlan] mainProfile idHash: ${mainProfileIdHash?.substring(0, 8)}`);

      // Get all profiles - returns Promise<ProfileModel[]>, not async iterator
      const profileModels = await someone.profiles();
      console.log(`[ContactsPlan] Found ${profileModels?.length || 0} profiles`);
      const profiles: any[] = [];

      for (const profile of profileModels) {
        // Extract PersonName from descriptions
        let name = '';
        let email = '';
        let avatarBlobHash: string | undefined;

        try {
          const personNames = profile.descriptionsOfType('PersonName');
          if (personNames && personNames.length > 0) {
            name = (personNames[0] as any).name || '';
          }
        } catch (e) {
          // PersonName not found
        }

        // Extract email from Email description
        try {
          const emails = profile.descriptionsOfType('Email');
          if (emails && emails.length > 0) {
            email = (emails[0] as any).email || '';
          }
        } catch (e) {
          // Email not found
        }

        // Extract avatar blob hash from ProfileImage description
        try {
          const profileImages = profile.descriptionsOfType('ProfileImage');
          if (profileImages && profileImages.length > 0) {
            avatarBlobHash = (profileImages[profileImages.length - 1] as any).image;
          }
        } catch (e) {
          // Avatar not found
        }

        // Get identity key fingerprint for this profile's person
        let identityKeyFingerprint: string | undefined;
        let identityKeyType: string | undefined;
        try {
          const personId = profile.personId;
          const keysHash = await getDefaultKeys(personId);
          if (keysHash) {
            const keys = await getObject(keysHash);
            if (keys && keys.publicSignKey) {
              // Use first 40 chars of the hex public sign key as fingerprint
              identityKeyFingerprint = keys.publicSignKey.slice(0, 40);
              identityKeyType = 'Ed25519';
            }
          }
        } catch (e) {
          // Keys not found - that's ok for some contacts
        }

        profiles.push({
          profileIdHash: profile.idHash,
          personId: request.personId,
          personEmail,
          name,
          email,
          avatarBlobHash,
          isMainProfile: profile.idHash === mainProfileIdHash,
          identityKeyFingerprint,
          identityKeyType
        });
      }

      return { success: true, profiles };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get profiles for Someone:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get profile for a contact (main profile)
   */
  async getProfile(request: { personId: string }): Promise<{ success: boolean; profile?: any; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const personId = request.personId as SHA256IdHash<Person>;
      const someone = await this.nodeOneCore.leuteModel.getSomeone(personId);

      if (!someone) {
        return { success: false, error: 'Contact not found' };
      }

      const profile = await someone.mainProfile();
      if (!profile) {
        return { success: false, error: 'Profile not found' };
      }

      // Extract name from PersonName description
      let name = '';
      try {
        const personNames = profile.descriptionsOfType('PersonName');
        if (personNames && personNames.length > 0) {
          name = (personNames[0] as any).name || '';
        }
      } catch (e) {
        // PersonName not found
      }

      // Check if this is the owner
      const me = await this.nodeOneCore.leuteModel.me();
      const myPersonId = await me.mainIdentity();
      const isOwner = personId === myPersonId;

      return {
        success: true,
        profile: {
          profileIdHash: profile.idHash,
          personId,
          name,
          isOwner,
          isMainProfile: true
        }
      };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get profile:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update profile for a contact
   */
  async updateProfile(request: {
    personId: string;
    name?: string;
    email?: string;
    phone?: string;
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    website?: string;
    birthday?: string;
    jobTitle?: string;
    company?: string;
    notes?: string;
    avatarBlobHash?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.nodeOneCore.leuteModel) {
        return { success: false, error: 'Leute model not initialized' };
      }

      const personId = request.personId as SHA256IdHash<Person>;
      const someone = await this.nodeOneCore.leuteModel.getSomeone(personId);

      if (!someone) {
        return { success: false, error: 'Contact not found' };
      }

      const profile = await someone.mainProfile();
      if (!profile) {
        return { success: false, error: 'Profile not found' };
      }

      let needsSave = false;

      // Ensure personDescriptions array exists
      if (!profile.personDescriptions) {
        profile.personDescriptions = [];
      }

      // Update name if provided - direct array manipulation pattern from LeuteApi
      if (request.name && request.name.trim()) {
        // Remove existing PersonName descriptions
        profile.personDescriptions = profile.personDescriptions.filter(
          (desc: any) => desc.$type$ !== 'PersonName'
        );
        // Add new PersonName
        profile.personDescriptions.push({
          $type$: 'PersonName' as const,
          name: request.name.trim()
        });
        needsSave = true;
      }

      // Update email if provided
      if (request.email !== undefined) {
        // Remove existing Email descriptions
        profile.personDescriptions = profile.personDescriptions.filter(
          (desc: any) => desc.$type$ !== 'Email'
        );
        // Add new Email if not empty
        if (request.email.trim()) {
          profile.personDescriptions.push({
            $type$: 'Email' as const,
            email: request.email.trim()
          });
        }
        needsSave = true;
      }

      // Update avatar if provided - save as ProfileImage description
      if (request.avatarBlobHash !== undefined) {
        // Remove existing ProfileImage descriptions
        profile.personDescriptions = profile.personDescriptions.filter(
          (desc: any) => desc.$type$ !== 'ProfileImage'
        );
        // Add new ProfileImage if not empty
        if (request.avatarBlobHash) {
          profile.personDescriptions.push({
            $type$: 'ProfileImage' as const,
            image: request.avatarBlobHash
          });
        }
        needsSave = true;
      }

      if (needsSave) {
        await profile.saveAndLoad();
      }

      return { success: true };
    } catch (error) {
      console.error('[ContactsPlan] Failed to update profile:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Upload avatar image and return blob hash
   */
  async uploadAvatar(request: { dataUrl: string }): Promise<{ success: boolean; blobHash?: string; error?: string }> {
    try {
      const base64Data = request.dataUrl.split(',')[1];
      if (!base64Data) {
        return { success: false, error: 'Invalid data URL' };
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { storeArrayBufferAsBlob } = await import('@refinio/one.core/lib/storage-blob.js');
      const result = await storeArrayBufferAsBlob(bytes.buffer);

      return { success: true, blobHash: result.hash };
    } catch (error) {
      console.error('[ContactsPlan] Failed to upload avatar:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get avatar as data URL from blob hash
   */
  async getAvatarDataUrl(request: { blobHash: string }): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
    try {
      const { readBlobAsArrayBuffer } = await import('@refinio/one.core/lib/storage-blob.js');

      const arrayBuffer = await readBlobAsArrayBuffer(request.blobHash as any);
      if (!arrayBuffer) {
        return { success: false, error: 'Blob not found' };
      }

      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Detect mime type
      let mimeType = 'image/png';
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
        mimeType = 'image/jpeg';
      } else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        mimeType = 'image/gif';
      }

      return { success: true, dataUrl: `data:${mimeType};base64,${base64}` };
    } catch (error) {
      console.error('[ContactsPlan] Failed to get avatar data URL:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get VGER avatar config for a person (stub - not yet implemented)
   */
  async getVgerAvatarConfig(request: { personId: string; name?: string }): Promise<{ success: boolean; vgerConfig?: any; error?: string }> {
    // TODO: Implement when AvatarPreference recipe supports vgerConfig
    return { success: true, vgerConfig: null };
  }

  /**
   * Save VGER avatar config for a person (stub - not yet implemented)
   */
  async saveVgerAvatarConfig(request: {
    personId: string;
    name?: string;
    vgerConfig: any;
  }): Promise<{ success: boolean; generation?: number; error?: string }> {
    // TODO: Implement when AvatarPreference recipe supports vgerConfig
    console.log('[ContactsPlan] Saving vger avatar config for:', request.personId);
    return { success: true, generation: 1 };
  }

  /**
   * Get tool definitions for MCP/PlanRegistry discovery
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, { type: string; description?: string; default?: unknown }>;
      required?: string[];
    };
  }> {
    return [
      {
        name: 'getContacts',
        description: 'Get all contacts with AI detection.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'searchContacts',
        description: 'Search contacts by name or other criteria.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string' },
            limit: { type: 'number', description: 'Maximum number of contacts to return' }
          },
          required: ['query']
        }
      },
      {
        name: 'addContact',
        description: 'Add a contact (human or AI).',
        inputSchema: {
          type: 'object',
          properties: {
            personId: { type: 'string', description: 'Person ID hash of the contact' },
            modelId: { type: 'string', description: 'LLM model ID if creating an AI contact' },
            isAI: { type: 'boolean', description: 'Whether this is an AI contact' }
          },
          required: ['personId']
        }
      },
      {
        name: 'removeContact',
        description: 'Remove a contact.',
        inputSchema: {
          type: 'object',
          properties: {
            personId: { type: 'string', description: 'Person ID hash of the contact to remove' }
          },
          required: ['personId']
        }
      },
      {
        name: 'updateContactProfile',
        description: 'Update a contact profile.',
        inputSchema: {
          type: 'object',
          properties: {
            personId: { type: 'string', description: 'Person ID hash of the contact' },
            displayName: { type: 'string', description: 'New display name' },
            description: { type: 'string', description: 'New profile description' }
          },
          required: ['personId']
        }
      },
      {
        name: 'getContactWithTrust',
        description: 'Get a contact with trust information.',
        inputSchema: {
          type: 'object',
          properties: {
            personId: { type: 'string', description: 'Person ID hash of the contact' }
          },
          required: ['personId']
        }
      },
      {
        name: 'getAIContacts',
        description: 'Get only AI contacts.',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }
}
