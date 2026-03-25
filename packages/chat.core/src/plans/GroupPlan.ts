/**
 * Group Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for conversation topic operations.
 * Uses TopicModel for topic creation and access control.
 *
 * Architecture:
 *   Topic → participants (HashGroup)
 *        → channel (message transport / sync)
 *        → group (Group, for group conversations)
 *
 * CHUM follows all references automatically when Topic is shared.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Group, HashGroup } from '@refinio/one.core/lib/recipes.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
// createAccess and SET_ACCESS_MODE removed — addParticipants deprecated, access handled by ChatPlan

/**
 * Result from creating a topic
 */
export interface CreateTopicResult {
  topic: Topic;
  topicIdHash: SHA256IdHash<Topic>;
  participantsHash: SHA256Hash<HashGroup<Person>>;
}

/**
 * Storage dependencies for GroupPlan
 * Note: Generic methods use 'any' to avoid constraint issues with ONE.core's
 * complex type system. Runtime behavior is correct; these are just type signatures
 * for the dependency injection pattern.
 */
export interface GroupPlanStorageDeps {
  getObjectByIdHash: (idHash: SHA256IdHash<any>) => Promise<{ obj: any }>;
  getObject: (hash: SHA256Hash<any>) => Promise<any>;
  calculateIdHashOfObj: (obj: any) => Promise<SHA256IdHash<any>>;
  storeUnversionedObject: (obj: any) => Promise<{ hash: SHA256Hash<any> }>;
  storeVersionedObject: (obj: any) => Promise<{ hash: SHA256Hash<any>; idHash: SHA256IdHash<any> }>;
}

export interface CreateTopicRequest {
  topicName: string;
  participants: SHA256IdHash<Person>[];
}

export interface CreateTopicResponse {
  success: boolean;
  topicIdHash?: SHA256IdHash<Topic>;
  participantsHash?: SHA256Hash<HashGroup>;
  error?: string;
}

export interface GetTopicRequest {
  topicId: string;
}

export interface GetTopicResponse {
  success: boolean;
  topicIdHash?: SHA256IdHash<Topic>;
  participants?: SHA256IdHash<Person>[];
  error?: string;
}

export interface GetTopicParticipantsRequest {
  topicId: string;
}

export interface GetTopicParticipantsResponse {
  success: boolean;
  participants?: SHA256IdHash<Person>[];
  error?: string;
}

export interface EnsureTopicForGroupRequest {
  topicName: string;
  groupIdHash: SHA256IdHash<Group>;
}

export interface EnsureTopicForGroupResponse {
  success: boolean;
  topicIdHash?: SHA256IdHash<Topic>;
  participantsHash?: SHA256Hash<HashGroup>;
  error?: string;
}

export interface AddParticipantsRequest {
  topicId: string;
  participants: SHA256IdHash<Person>[];
}

export interface AddParticipantsResponse {
  success: boolean;
  error?: string;
}

/**
 * GroupPlan - Pure business logic for conversation topic operations
 *
 * Dependencies injected via constructor:
 * - topicModel: TopicModel for topic creation and queries
 * - storageDeps: Storage functions for object access
 */
export class GroupPlan {
  static get planId(): string { return 'group'; }
  static get planName(): string { return 'Group'; }
  static get description(): string { return 'Manages conversation topics via TopicModel'; }
  static get version(): string { return '4.0.0'; }

  private topicModel: TopicModel;
  private storageDeps: GroupPlanStorageDeps;
  private ownerId: SHA256IdHash<Person>;

  // Cache: topicId -> topicIdHash (for quick lookups)
  private topicCache: Map<string, SHA256IdHash<Topic>>;

  constructor(topicModel: TopicModel, storageDeps: GroupPlanStorageDeps, ownerId: SHA256IdHash<Person>) {
    this.topicModel = topicModel;
    this.storageDeps = storageDeps;
    this.ownerId = ownerId;
    this.topicCache = new Map();
  }

  private async loadTopic(topicId: string): Promise<Topic> {
    const { obj } = await this.storageDeps.getObjectByIdHash(ensureIdHash(topicId));
    if (!obj) {
      throw new Error(`Topic ${topicId} not found`);
    }
    return obj as Topic;
  }

  /**
   * Create a conversation topic with participants
   *
   * Creates HashGroup -> Group -> Topic with proper structure.
   * TopicModel.createGroupTopic expects a Group ID hash.
   */
  async createTopic(request: CreateTopicRequest): Promise<CreateTopicResponse> {
    const { topicName, participants } = request;
    console.log(`[GroupPlan] createTopic name="${topicName}" participants=${participants.length}`);

    try {
      // Ensure owner is included in participants
      const allParticipants = [...participants];
      if (!allParticipants.some(p => String(p) === String(this.ownerId))) {
        allParticipants.unshift(this.ownerId);
      }

      // Step 1: Create HashGroup with participants
      const hashGroupObj: HashGroup<Person> = {
        $type$: 'HashGroup',
        person: new Set(allParticipants)
      };

      const hashGroupResult = await this.storageDeps.storeUnversionedObject(hashGroupObj);
      const hashGroupHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

      // Step 2: Create Group referencing HashGroup
      const groupObj: Group = {
        $type$: 'Group',
        name: topicName,
        owner: this.ownerId,
        hashGroup: hashGroupHash
      };
      const groupResult = await this.storageDeps.storeVersionedObject(groupObj);
      const groupIdHash = groupResult.idHash as SHA256IdHash<Group>;

      // Step 3: Create topic via TopicModel
      // Identity = {participants, originalName} — ONE.core computes idHash.
      // Same participants + same name = same topic (idempotent).
      const topic = await this.topicModel.createGroupTopic(
        topicName,
        groupIdHash
      );

      const topicIdHash = await this.storageDeps.calculateIdHashOfObj(topic);

      console.log(`[GroupPlan] Topic ready: ${String(topicIdHash).substring(0, 16)} name="${topicName}"`);

      return {
        success: true,
        topicIdHash,
        participantsHash: topic.participants
      };
    } catch (error) {
      console.error('[GroupPlan] Error creating topic:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get topic info for a conversation
   */
  async getTopic(request: GetTopicRequest): Promise<GetTopicResponse> {
    try {
      // Try cache first
      let topicIdHash = this.topicCache.get(request.topicId);

      // If not in cache, try to find via TopicModel
      // topicId is expected to be the idHash string
      if (!topicIdHash) {
        const topic = await this.loadTopic(request.topicId);
        topicIdHash = await this.storageDeps.calculateIdHashOfObj(topic);
        this.topicCache.set(request.topicId, topicIdHash);
      }

      const participants = await this.getParticipantsForTopic(request.topicId);

      return {
        success: true,
        topicIdHash,
        participants
      };
    } catch (error) {
      console.error('[GroupPlan] Error getting topic:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get participants for a topic from Topic.participants
   * @param topicId - The Topic's computed idHash (as string)
   */
  private async getParticipantsForTopic(topicId: string): Promise<SHA256IdHash<Person>[]> {
    const topic = await this.loadTopic(topicId);
    const hashGroup = await this.storageDeps.getObject(topic.participants);
    const personSet: Set<SHA256IdHash<Person>> = (hashGroup as HashGroup<Person>).person || new Set();

    return Array.from(personSet);
  }

  /**
   * Get participants for a topic
   */
  async getTopicParticipants(request: GetTopicParticipantsRequest): Promise<GetTopicParticipantsResponse> {
    try {
      const participants = await this.getParticipantsForTopic(request.topicId);

      return {
        success: true,
        participants
      };
    } catch (error) {
      console.error('[GroupPlan] Error getting topic participants:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Ensure a Topic exists for an already-created Group.
   */
  async ensureTopicForGroup(request: EnsureTopicForGroupRequest): Promise<EnsureTopicForGroupResponse> {
    const { topicName, groupIdHash } = request;
    console.log(`[GroupPlan] ensureTopicForGroup name="${topicName}" group=${String(groupIdHash).substring(0, 16)}`);

    try {
      const topic = await this.topicModel.createGroupTopic(topicName, groupIdHash);
      const topicIdHash = await this.storageDeps.calculateIdHashOfObj(topic);

      console.log(
        `[GroupPlan] Group topic ready: ${String(topicIdHash).substring(0, 16)} name="${topicName}"`
      );

      return {
        success: true,
        topicIdHash,
        participantsHash: topic.participants
      };
    } catch (error) {
      console.error('[GroupPlan] Error ensuring topic for group:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * @deprecated Use ChatPlan.addParticipants() instead — it creates a new Topic
   * with merged participants and tracks the conversation chain via TopicDimension.
   * GroupPlan.addParticipants() only granted access rights without updating Topic.participants.
   */
  async addParticipants(request: AddParticipantsRequest): Promise<AddParticipantsResponse> {
    console.warn('[GroupPlan] addParticipants is deprecated — use ChatPlan.addParticipants() instead');
    return {
      success: false,
      error: 'Deprecated: use ChatPlan.addParticipants() which creates a new Topic with merged participants'
    };
  }

  /**
   * Get cached topic ID hash
   */
  getCachedTopicForConversation(topicId: string): SHA256IdHash<Topic> | undefined {
    return this.topicCache.get(topicId);
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
        name: 'createTopic',
        description: 'Create a new conversation topic with participants.',
        inputSchema: {
          type: 'object',
          properties: {
            topicName: { type: 'string', description: 'Name for the conversation topic' },
            participants: { type: 'array', description: 'Person ID hashes of participants' }
          },
          required: ['topicName', 'participants']
        }
      },
      {
        name: 'getTopic',
        description: 'Get information about a conversation topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID hash' }
          },
          required: ['topicId']
        }
      },
      {
        name: 'getTopicParticipants',
        description: 'Get participants for a conversation topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID hash' }
          },
          required: ['topicId']
        }
      },
      {
        name: 'addParticipants',
        description: 'DEPRECATED: Use ChatPlan.addParticipants() instead. Creates proper conversation chain with new Topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID hash' },
            participants: { type: 'array', description: 'Person ID hashes to add' }
          },
          required: ['topicId', 'participants']
        }
      }
    ];
  }
}
