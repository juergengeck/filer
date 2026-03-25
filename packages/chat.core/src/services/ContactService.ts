/**
 * Contact Service (Chat Business Logic)
 *
 * Extracted from OneCoreHandler - chat-specific contact management.
 * Provides contact list with VGER-specific enhancements:
 * - AI contact detection
 * - Avatar color management
 * - No caching (LeuteModel already caches)
 * - Deduplication
 */

import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';
import type { PersonDescriptionTypes } from '@refinio/one.models/lib/recipes/Leute/PersonDescriptions.js';
import type { CommunicationEndpointTypes } from '@refinio/one.models/lib/recipes/Leute/CommunicationEndpoints.js';
import type { AvatarPreference } from '../types/AvatarPreference.js';
import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import { storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObjectByIdHash } from '@refinio/one.core/lib/storage-versioned-objects.js';

// Type guards
function isEmail(obj: CommunicationEndpointTypes): obj is Extract<CommunicationEndpointTypes, { $type$: 'Email' }> {
  return obj.$type$ === 'Email';
}

// Types
export interface Contact {
  id: string;
  personId: string;
  someoneId?: string;
  name: string;
  displayName: string;
  email: string;
  isAI: boolean;
  modelId?: string; // LLM model ID for AI contacts
  role: string;
  platform: string;
  status: string;
  isConnected: boolean;
  trusted: boolean;
  lastSeen: string;
  color: string;
}

// Avatar color generation
function generateAvatarColor(personId: string): string {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#14b8a6',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e'
  ];

  let hash = 0;
  for (let i = 0; i < personId.length; i++) {
    hash = ((hash << 5) - hash) + personId.charCodeAt(i);
    hash = hash & hash;
  }

  return colors[Math.abs(hash) % colors.length];
}

function getMoodColor(mood: string): string {
  const moodColors: Record<string, string> = {
    'happy': '#f59e0b', 'sad': '#3b82f6', 'angry': '#ef4444',
    'calm': '#14b8a6', 'excited': '#ec4899', 'tired': '#8b5cf6',
    'focused': '#10b981', 'neutral': '#6366f1'
  };
  return moodColors[mood] || moodColors['neutral'];
}

async function getAvatarColor(personId: string): Promise<string> {
  try {
    const result = await getObjectByIdHash<AvatarPreference>(personId as any);
    if (result && result.obj) {
      const pref = result.obj;
      if (pref.mood) return getMoodColor(pref.mood);
      if (pref.color) return pref.color;
    }
  } catch (e) {
    // Preference doesn't exist, will create one
  }

  const color = generateAvatarColor(personId);
  const preference: AvatarPreference = {
    $type$: 'AvatarPreference',
    personId,
    color,
    updatedAt: Date.now()
  };

  try {
    await storeVersionedObject(preference);
  } catch (e) {
    console.warn('[ContactService] Failed to store avatar preference:', e);
  }

  return color;
}

/**
 * ContactService - Contact management with VGER-specific features
 */
export class ContactService {
  private leuteModel: LeuteModel;
  private aiAssistantModel: any; // Optional - for AI detection
  // No local cache - LeuteModel already caches

  constructor(
    leuteModel: LeuteModel,
    aiAssistantModel?: any
  ) {
    this.leuteModel = leuteModel;
    this.aiAssistantModel = aiAssistantModel;
  }

  /**
   * Invalidate contacts cache (deprecated - no-op)
   */
  invalidateContactsCache(): void {
    // No-op - we don't cache locally
  }

  /**
   * Get contacts from LeuteModel with VGER-specific enhancements
   */
  async getContacts(): Promise<Contact[]> {
    console.log('\n' + '='.repeat(60));
    console.log('[ContactService] 📋 GETTING CONTACTS - START');
    console.log('='.repeat(60));

    const contacts: Contact[] = [];

    // Get owner ID
    let myId: string | null = null;
    try {
      const me = await this.leuteModel.me();
      myId = await me.mainIdentity();
    } catch (error) {
      console.warn('[ContactService] Error getting owner ID:', error);
    }

    // Get ALL contacts from LeuteModel.others()
    console.log('[ContactService] Step 1: Calling LeuteModel.others()...');
    const others = await this.leuteModel.others();
    console.log(`[ContactService] ✅ LeuteModel.others() returned ${others.length} contacts`);

    // Track processed personIds to avoid duplicates
    const processedPersonIds = new Set<string>();

    // Process contacts
    for (const someone of others) {
      try {
        const personId = await someone.mainIdentity();

        if (!personId || processedPersonIds.has(personId)) {
          continue;
        }
        processedPersonIds.add(personId);

        const profile = await someone.mainProfile();

        // Extract email
        let email: string | null = null;
        if ((someone as any).email) {
          email = (someone as any).email;
        } else if (profile?.communicationEndpoints?.length > 0) {
          const emailEndpoint = profile.communicationEndpoints.find(isEmail);
          if (emailEndpoint && 'email' in emailEndpoint) {
            email = emailEndpoint.email;
          }
        } else if (typeof (someone as any).mainEmail === 'function') {
          try {
            email = await (someone as any).mainEmail();
          } catch (e) {
            // mainEmail might not exist or fail
          }
        }

        // Check if AI contact and get model ID
        let isAI = false;
        let modelId: string | undefined = undefined;
        // Use AIAssistantPlan's public methods (isAIPerson, getModelIdForPersonId)
        if (this.aiAssistantModel?.isAIPerson) {
          isAI = this.aiAssistantModel.isAIPerson(personId);
          // If it's an AI contact, try to get its model ID
          if (isAI && this.aiAssistantModel.getModelIdForPersonId) {
            modelId = this.aiAssistantModel.getModelIdForPersonId(personId);
          }
        }
        if (!isAI && email && email.endsWith('@ai.local')) {
          isAI = true;
        }

        // Skip private AI variants (used internally for VGER chat)
        // These have -private in their email prefix (e.g., vger-private@ai.local)
        if (isAI && email && email.includes('-private@')) {
          console.log(`[ContactService] Skipping private AI variant: ${email}`);
          continue;
        }

        // Get display name
        let displayName: string | null = null;
        if (profile) {
          try {
            const personNames = profile.descriptionsOfType('PersonName');
            if (personNames && personNames.length > 0) {
              displayName = personNames[0].name;
            }
          } catch (e: any) {
            console.log(`[ContactService] Error getting PersonName: ${e.message}`);
          }
        }

        // Extract name from AI email if needed
        if (displayName === 'Unknown Contact' && email && isAI) {
          const emailPrefix = email.split('@')[0];
          displayName = emailPrefix
            .replace(/lmstudio_/g, '')
            .replace(/ollama_/g, '')
            .replace(/claude_/g, '')
            .replace(/_/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

          if (email.includes('lmstudio')) {
            displayName += ' (LM Studio)';
          } else if (email.includes('ollama')) {
            displayName += ' (Ollama)';
          }
        }

        // Fallback display name
        if (!displayName) {
          displayName = personId ? `Contact ${String(personId).substring(0, 8)}` : 'Unknown Contact';
        }

        // Check if owner
        const isOwner = personId === myId;
        if (isOwner) {
          displayName += ' (You)';
        }

        // Get avatar color
        const color = await getAvatarColor(personId);

        contacts.push({
          id: personId,
          personId: personId,
          someoneId: someone.idHash,
          name: displayName,
          displayName: displayName,
          email: email || `${String(personId).substring(0, 8)}@vger.one`,
          isAI: isAI,
          modelId: modelId, // Include model ID for AI contacts
          role: isOwner ? 'owner' : 'contact',
          platform: isAI ? 'ai' : (isOwner ? 'nodejs' : 'external'),
          status: isOwner ? 'owner' : 'offline',
          isConnected: isOwner ? true : false,
          trusted: true,
          lastSeen: new Date().toISOString(),
          color
        });
      } catch (error) {
        console.warn('[ContactService] Error processing contact:', error);
      }
    }

    console.log('\n[ContactService] SUMMARY:');
    console.log(`[ContactService]   - Total from LeuteModel.others(): ${others.length}`);
    console.log(`[ContactService]   - After deduplication: ${contacts.length}`);
    console.log(`[ContactService]   - Owner: ${contacts.filter(c => c.role === 'owner').length}`);
    console.log(`[ContactService]   - AI contacts: ${contacts.filter(c => c.isAI).length}`);
    console.log(`[ContactService]   - Regular contacts: ${contacts.filter(c => !c.isAI && c.role !== 'owner').length}`);
    console.log('='.repeat(60) + '\n');

    return contacts;
  }

  /**
   * Get peer list (simplified contact format)
   */
  async getPeerList(): Promise<any[]> {
    console.log('[ContactService] Getting peer list');

    try {
      const contacts = await this.getContacts();
      return contacts.map((contact: Contact) => ({
        id: contact.id,
        personId: contact.personId,
        name: contact.name,
        displayName: contact.displayName,
        email: contact.email,
        isAI: contact.isAI,
        status: contact.status || 'offline',
        isConnected: contact.isConnected || false
      }));
    } catch (error) {
      console.error('[ContactService] Failed to get peer list:', error);
      throw error;
    }
  }
}
