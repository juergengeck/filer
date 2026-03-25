/**
 * Chat Plan (Pure Business Logic)
 *
 * Transport-agnostic plan for chat operations.
 * Can be used from both Electron IPC and Web Worker contexts.
 * Pattern based on refinio.api architecture.
 *
 * SELF-SUFFICIENT: Creates GroupPlan internally using nodeOneCore.topicModel.
 * Platform code just needs to pass fundamental dependencies.
 */

import type { SHA256IdHash, SHA256Hash } from '@refinio/one.core/lib/util/type-checks.js';
import { ensureHash, ensureIdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Group, HashGroup } from '@refinio/one.core/lib/recipes.js';
import type { SetAccessParam } from '@refinio/one.core/lib/access.js';
import type { ChatAttachment, Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import { SET_ACCESS_MODE } from '@refinio/one.core/lib/storage-base-common.js';
import { getObjectByIdHash, storeVersionedObject } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { getObject, storeUnversionedObject } from '@refinio/one.core/lib/storage-unversioned-objects.js';
import { calculateIdHashOfObj } from '@refinio/one.core/lib/util/object.js';
import { createAccess } from '@refinio/one.core/lib/access.js';
import { GroupPlan as GroupPlanImpl, GroupPlanStorageDeps } from './GroupPlan.js';
import { createP2PTopic } from '../services/P2PTopicService.js';
import type { ChatTrieManager } from '../services/ChatTrieManager.js';
import type { Hash } from '@refinio/trie.core';
import { createDefaultKeysIfNotExist } from '@refinio/one.core/lib/keychain/keychain.js';

// StoryFactory interface for optional Story/Assembly tracking
export interface StoryFactory {
  wrapExecution(metadata: any, operation: () => Promise<any>): Promise<any>;
}

// Dimension interfaces - lightweight types so chat.core doesn't depend on vger.core
// These mirror the actual dimension classes in vger.core/dimensions/

/** Lightweight contact entry from ContactDimension */
export interface ChatPlanContactEntry {
    personIdHash: string;
    someoneIdHash: string;
    name: string;
}

/** Lightweight topic entry from TopicDimension */
export interface ChatPlanTopicEntry {
    topicIdHash: string;
    name: string;              // originalName
    displayName: string;
    participantIds: string[];
    lastActivity: number;
    groupIdHash?: string;
    source?: string;           // conversation source: 'hi' | 'vger' | 'glue' | 'molt' | 'whatsapp'
    conversationGroupId?: string;  // first topicIdHash in chain
    supersededBy?: string;         // newer topicIdHash that replaced this one
}

/** Interface for ContactDimension - O(1) contact lookups */
export interface ChatPlanContactDimension {
    getByPersonId(personIdHash: string): ChatPlanContactEntry | undefined;
    getBySomeoneId(someoneIdHash: string): ChatPlanContactEntry | undefined;
    all(): ChatPlanContactEntry[];
}

/** Lightweight message entry from MessageDimension */
export interface ChatPlanMessageEntry {
    entryHash: string;
    dataHash: string;
    timestamp: number;
    authorId: string;
}

/** Interface for MessageDimension - per-topic sorted message index */
export interface ChatPlanMessageDimension {
    getRecent(topicIdHash: string, count: number): ChatPlanMessageEntry[];
    getBefore(topicIdHash: string, before: number, count: number): ChatPlanMessageEntry[];
    getCount(topicIdHash: string): number;
    has(topicIdHash: string): boolean;
    index?(
      topicIdHash: string,
      entryHash: string,
      dataHash: string,
      timestamp: number,
      authorId: string,
      options?: {origin?: string}
    ): void;
}

/** Interface for TopicDimension - O(1) topic lookups */
export interface ChatPlanTopicDimension {
    getByTopicId(topicIdHash: string): ChatPlanTopicEntry | undefined;
    getByName(name: string): ChatPlanTopicEntry | undefined;
    allByLastActivity(): ChatPlanTopicEntry[];
    all(): ChatPlanTopicEntry[];
    allTopicIds(): string[];
    touchActivity?(topicIdHash: string, lastActivity: number): void;
    // Conversation chain methods
    registerConversationChain(oldTopicIdHash: string, newTopicIdHash: string): void;
    getConversationChain(topicIdHash: string): string[];
    getLatestInChain(topicIdHash: string): ChatPlanTopicEntry | undefined;
    isSuperseded(topicIdHash: string): boolean;
}

// GroupPlan interface for topic operations
export interface GroupPlan {
  createTopic(request: any): Promise<any>;
  getTopic(request: any): Promise<any>;
  getTopicParticipants(request: any): Promise<any>;
  addParticipants(request: any): Promise<any>;
}

// Request/Response types
export interface InitializeDefaultChatsRequest {
  // No parameters
}

export interface InitializeDefaultChatsResponse {
  success: boolean;
  error?: string;
}

export interface UIReadyRequest {
  // No parameters
}

export interface UIReadyResponse {
  success: boolean;
  error?: string;
}

export interface SendMessageRequest {
  topicId: string;
  content: string;  // Changed from 'text' to match response format
  attachments?: any[];
  senderId?: any;  // Optional: Person ID of the sender (defaults to nodeOneCore.ownerId)
  replyTo?: string;  // dataHash of the message being replied to
}

export interface SendMessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetMessagesRequest {
  topicId: string;
  limit?: number;
  offset?: number;
  before?: number;  // Timestamp cursor for scroll-up (load messages before this timestamp)
}

export interface GetMessagesResponse {
  success: boolean;
  messages?: any[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

export interface CreateConversationRequest {
  type?: string;
  participants?: any[];
  name?: string | null;
}

export interface CreateConversationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface CreateP2PConversationRequest {
  localPersonId: any;
  remotePersonId: any;
}

export interface CreateP2PConversationResponse {
  success: boolean;
  topicId?: string;
  error?: string;
}

export interface GetConversationsRequest {
  limit?: number;
  offset?: number;
}

export interface GetConversationsResponse {
  success: boolean;
  data?: any[];
  error?: string;
}

export interface GetConversationRequest {
  topicId: string;
}

export interface GetConversationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface GetCurrentUserRequest {
  // No parameters
}

export interface GetCurrentUserResponse {
  success: boolean;
  user?: {
    id: string;
    name: string;
  };
  error?: string;
}

export interface AddParticipantsRequest {
  topicId: string;
  participantIds: string[];
  hiddenAIIds?: string[];
}

export interface AddParticipantsResponse {
  success: boolean;
  data?: {
    topicId: string;
    addedParticipants: string[];
    newConversationId?: string;  // Present when a new chat is created (different group)
  };
  error?: string;
}

export interface ClearConversationRequest {
  topicId: string;
}

export interface ClearConversationResponse {
  success: boolean;
  error?: string;
}

export interface EditMessageRequest {
  messageId: string;
  topicId: string;
  newText: string;
  editReason?: string;
}

export interface EditMessageResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface DeleteMessageRequest {
  messageId: string;
  topicId: string;
  reason?: string;
}

export interface DeleteMessageResponse {
  success: boolean;
  error?: string;
}

export interface GetMessageHistoryRequest {
  messageId: string;
}

export interface GetMessageHistoryResponse {
  success: boolean;
  history?: any[];
  error?: string;
}

export interface ExportMessageCredentialRequest {
  messageId: string;
}

export interface ExportMessageCredentialResponse {
  success: boolean;
  credential?: string;
  error?: string;
}

export interface VerifyMessageAssertionRequest {
  certificateHash: string;
  messageHash: string;
}

export interface VerifyMessageAssertionResponse {
  success: boolean;
  valid?: boolean;
  error?: string;
}

/**
 * ChatPlan - Pure business logic for chat operations
 *
 * SELF-SUFFICIENT: Automatically creates GroupPlan using nodeOneCore.topicModel.
 * For group conversations with proper Group/HashGroup structure, use createGroupConversation().
 *
 * Dependencies injected via constructor:
 * - nodeOneCore: The ONE.core instance with topicModel, leuteModel, storage functions
 * - stateManager: State management service (optional)
 * - messageVersionManager: Message versioning manager (optional)
 * - messageAssertionManager: Message assertion/certificate manager (optional)
 * - groupPlan: Advanced override for custom GroupPlan (optional - for power users)
 * - storyFactory: Story/Assembly automation (optional - for compatibility)
 *
 * Platform code can now simply:
 * ```typescript
 * const chatPlan = new ChatPlan(nodeOneCore);
 * ```
 */
export class ChatPlan {
  static get planId(): string { return 'chat'; }
  static get planName(): string { return 'Chat'; }
  static get description(): string { return 'Manages chat conversations, messages, and participants'; }
  static get version(): string { return '1.0.0'; }

  private nodeOneCore: any;
  private stateManager: any;
  private messageVersionManager: any;
  private messageAssertionManager: any;
  private groupPlan?: GroupPlan;
  private storyFactory?: StoryFactory;
  private contactDimension?: ChatPlanContactDimension;
  private topicDimension?: ChatPlanTopicDimension;
  private messageDimension?: ChatPlanMessageDimension;
  private chatTrieManager?: ChatTrieManager;

  constructor(
    nodeOneCore: any,
    stateManager?: any,
    messageVersionManager?: any,
    messageAssertionManager?: any,
    groupPlan?: GroupPlan,
    storyFactory?: StoryFactory
  ) {
    this.nodeOneCore = nodeOneCore;
    this.stateManager = stateManager;
    this.messageVersionManager = messageVersionManager;
    this.messageAssertionManager = messageAssertionManager;
    this.storyFactory = storyFactory;

    // Create GroupPlan if not provided (using topicModel from nodeOneCore)
    if (groupPlan) {
      // Use provided GroupPlan (backward compatibility or power user override)
      this.groupPlan = groupPlan;
    } else if (nodeOneCore.topicModel && nodeOneCore.ownerId) {
      // Auto-create GroupPlan with TopicModel
      const storageDeps: GroupPlanStorageDeps = {
        getObjectByIdHash: nodeOneCore.getObjectByIdHash || getObjectByIdHash,
        getObject: nodeOneCore.getObject || getObject,
        calculateIdHashOfObj: nodeOneCore.calculateIdHashOfObj || calculateIdHashOfObj,
        storeUnversionedObject: nodeOneCore.storeUnversionedObject || storeUnversionedObject,
        storeVersionedObject: nodeOneCore.storeVersionedObject || storeVersionedObject
      };
      this.groupPlan = new GroupPlanImpl(nodeOneCore.topicModel, storageDeps, nodeOneCore.ownerId);
      console.log('[ChatPlan] Auto-created GroupPlan with TopicModel');
    }
  }

  /**
   * Set message managers after initialization
   */
  setMessageManagers(versionManager: any, assertionManager: any): void {
    this.messageVersionManager = versionManager;
    this.messageAssertionManager = assertionManager;
  }

  /**
   * Set GroupPlan after initialization (for gradual adoption)
   */
  setGroupPlan(plan: GroupPlan): void {
    this.groupPlan = plan;
  }

  /**
   * Set StoryFactory after initialization (for gradual adoption)
   */
  setStoryFactory(factory: StoryFactory): void {
    this.storyFactory = factory;
  }

  /**
   * Set ContactDimension for O(1) contact lookups (replaces leuteModel.others() scans)
   */
  setContactDimension(dimension: ChatPlanContactDimension): void {
    this.contactDimension = dimension;
  }

  /**
   * Set TopicDimension for O(1) topic lookups (replaces topics.all() scans)
   */
  setTopicDimension(dimension: ChatPlanTopicDimension): void {
    this.topicDimension = dimension;
  }

  /**
   * Set MessageDimension for O(log n) message queries (replaces retrieveAllMessages)
   */
  setMessageDimension(dimension: ChatPlanMessageDimension): void {
    this.messageDimension = dimension;
  }

  /**
   * Set ChatTrieManager for trie-backed reads and local writes.
   * External message indexing is bridged from MessageDimension by the host runtime.
   */
  setChatTrieManager(manager: ChatTrieManager): void {
    this.chatTrieManager = manager;
  }

  private requireChatTrieManager(): ChatTrieManager {
    if (!this.chatTrieManager) {
      throw new Error('ChatTrieManager not initialized');
    }
    return this.chatTrieManager;
  }

  private async loadTopic(topicId: string): Promise<Topic> {
    const { obj } = await getObjectByIdHash<Topic>(ensureIdHash(topicId));
    if (!obj) {
      throw new Error(`Topic ${topicId} not found`);
    }
    return obj;
  }

  private async ensureTopicTrieAccess(topicId: string): Promise<void> {
    const chatTrieManager = this.requireChatTrieManager();
    const topic = await this.loadTopic(topicId);
    const persistedObjectIds = await chatTrieManager.ensureTopic(topicId);
    if (persistedObjectIds.length !== 3) {
      throw new Error(`ChatTrieManager.ensureTopic(${topicId}) returned ${persistedObjectIds.length} root ids; expected 3`);
    }

    const [chatTrieRoot, topicTrieRoot, subjectTrieRoot] = persistedObjectIds;
    const topicWithTrieRoots = topic as Topic & {
      chatTrieRoot?: SHA256IdHash<any>;
      topicTrieRoot?: SHA256IdHash<any>;
      subjectTrieRoot?: SHA256IdHash<any>;
    };

    const needsTopicUpdate =
      topicWithTrieRoots.chatTrieRoot !== chatTrieRoot ||
      topicWithTrieRoots.topicTrieRoot !== topicTrieRoot ||
      topicWithTrieRoots.subjectTrieRoot !== subjectTrieRoot;

    if (needsTopicUpdate) {
      await storeVersionedObject({
        ...topicWithTrieRoots,
        chatTrieRoot,
        topicTrieRoot,
        subjectTrieRoot
      });
    }

    await this.grantIdAccessViaHashGroup(persistedObjectIds, topic.participants as SHA256Hash<HashGroup<Person>>);
  }

  /**
   * Whether a topic is part of a conversation chain (needs broad participant query).
   */
  private isChainedTopic(topicIdHash: string): boolean {
    if (!this.topicDimension) return false;
    return this.topicDimension.getConversationChain(topicIdHash).length > 1;
  }

  /**
   * Get current instance version hash for Story/Assembly tracking
   */
  private getCurrentInstanceVersion(): string {
    // Try to get from nodeOneCore, fallback to timestamp if not available
    return this.nodeOneCore.instanceVersion || `instance-${Date.now()}`;
  }

  /**
   * Initialize default chats
   */
  async initializeDefaultChats(_request: InitializeDefaultChatsRequest): Promise<InitializeDefaultChatsResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        return { success: false, error: 'Node not ready' };
      }

      // Don't create any chats here - they should only be created when we have an AI model
      return { success: true };
    } catch (error) {
      console.error('[ChatPlan] Error initializing default chats:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * UI ready signal
   */
  async uiReady(_request: UIReadyRequest): Promise<UIReadyResponse> {
    try {
      // Notify the PeerMessageListener that UI is ready (platform-specific)
      if (this.nodeOneCore.peerMessageListener) {
        // This will be handled by the platform-specific adapter
      }
      return { success: true };
    } catch (error) {
      console.error('[ChatPlan] Error in uiReady:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Send a message to a conversation
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    // Disabled: Pollutes JSON-RPC stdout in MCP server
    // console.error('[ChatPlan] Send message:', { topicId: request.topicId, content: request.content, senderId: request.senderId });

    // Use provided senderId or default to owner
    const userId = request.senderId || this.nodeOneCore.ownerId || this.stateManager?.getState('user.id');

    // Ensure the sender has keys (needed for signing messages)
    if (request.senderId && userId) {
      await createDefaultKeysIfNotExist(userId as SHA256IdHash<Person>, 'owner');
    }

    // StoryFactory disabled - Story requires product (Assembly) reference which isn't implemented yet
    // TODO: Re-enable when Assembly/Story integration is complete
    return await this.sendMessageInternal(request, userId);
  }

  /**
   * Internal implementation of sendMessage (wrapped by Story recording)
   */
  private async sendMessageInternal(request: SendMessageRequest, userId: string | null): Promise<SendMessageResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      if (!userId) {
        throw new Error('User not authenticated');
      }

      // Validate topicId
      if (!request.topicId || typeof request.topicId !== 'string') {
        throw new Error(`Invalid topicId: ${request.topicId}`);
      }

      // Allow empty content if attachments are present
      const hasContent = request.content && request.content.trim().length > 0;
      const hasAttachments = request.attachments && request.attachments.length > 0;

      if (!hasContent && !hasAttachments) {
        throw new Error('Message content cannot be empty');
      }

      console.log('[ChatPlan.sendMessage] 📤 Sending to:', request.topicId?.substring(0, 20) + '...');

      const topic = await this.loadTopic(request.topicId);

      const participantIds = await this.getTopicParticipantIds(topic, request.topicId);
      const participantsHash = topic.participants as SHA256Hash<HashGroup<Person>>;
      console.log('[ChatPlan.sendMessage] participantIds:', participantIds.map(id => String(id).substring(0, 16)));
      const author = userId as SHA256IdHash<Person>;
      const attachmentHashes = await this.storeChatAttachments(request.attachments || [], participantsHash);

      const chatMessage = {
        $type$: 'ChatMessage' as const,
        text: request.content || '',
        sender: author,
        ...(attachmentHashes.length > 0 ? { attachments: attachmentHashes } : {}),
        ...(request.replyTo ? { replyTo: request.replyTo } : {})
      };
      const storedMessage = await storeUnversionedObject(chatMessage);
      const messageHash = storedMessage.hash as SHA256Hash;
      const timestamp = Date.now();

      await this.grantObjectAccessViaHashGroup([messageHash], participantsHash);
      console.log('[ChatPlan.sendMessage] granted message access:', messageHash.substring(0, 16));

      const { entryHash, persistedObjectIds } = await this.requireChatTrieManager().indexMessage(request.topicId, {
        topicId: request.topicId,
        messageHash: messageHash as unknown as Hash,
        authorId: String(author),
        timestamp
      });
      console.log('[ChatPlan.sendMessage] trie entry:', String(entryHash).substring(0, 16), 'roots:', persistedObjectIds.map(id => String(id).substring(0, 16)));
      await this.grantObjectAccessViaHashGroup([ensureHash(entryHash)], participantsHash);
      await this.grantIdAccessViaHashGroup(persistedObjectIds, participantsHash);

      return {
        success: true,
        data: {
          id: messageHash,
          messageHash,
          topicId: request.topicId,
          content: request.content,
          sender: userId,
          timestamp,
          attachments: request.attachments || []
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get messages for a conversation.
   *
   * Fast path (ChatTrieManager available): reads trie-backed chat atoms directly.
   * Fallback path: uses MessageDimension metadata to load only the requested slice.
   */
  async getMessages(request: GetMessagesRequest): Promise<GetMessagesResponse> {
    try{
      if (!this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      const limit = request.limit || 50;
      const startTime = Date.now();
      console.log('[ChatPlan.getMessages] 📥 Request:', request.topicId?.substring(0, 20) + '...');

      if (this.chatTrieManager) {
        let trieResult = await this.chatTrieManager.getMessageEntries(request.topicId, {
          limit,
          before: request.before
        });

        if (trieResult.total === 0) {
          // Backfill: catch-up load, not a live event. The caller gets messages
          // from the response — per-message events would trigger a UI refresh
          // storm (183 events → 183 getMessages calls for the same topic).
          await this.chatTrieManager.reloadTopic(request.topicId, {emitEvent: false});
          trieResult = await this.chatTrieManager.getMessageEntries(request.topicId, {
            limit,
            before: request.before
          });
        }

        if (trieResult.total > 0) {
          const participantNameCache = await this.buildParticipantNameCache(request.topicId);
          const ownerId = this.nodeOneCore.ownerId;
          const formattedMessages = (await Promise.all(
            trieResult.entries.map(async (entry) => this.formatMessageFromEntry({
              entryHash: entry.entryHash,
              dataHash: entry.messageHash,
              timestamp: entry.timestamp,
              authorId: entry.authorId
            }, ownerId, participantNameCache))
          )).filter((msg) =>
            (msg.content || (msg.attachments && msg.attachments.length > 0))
          );

          const hasMore = request.before
            ? trieResult.available > formattedMessages.length
            : trieResult.total > limit;

          console.log(`[ChatPlan.getMessages] 🌲 ChatTrie: ${formattedMessages.length}/${trieResult.total} messages in ${Date.now() - startTime}ms`);
          return {
            success: true,
            messages: formattedMessages,
            total: trieResult.total,
            hasMore
          };
        }
      }

      if (!this.messageDimension) {
        throw new Error('MessageDimension not initialized');
      }

      const entries = request.before
        ? this.messageDimension.getBefore(request.topicId, request.before, limit)
        : this.messageDimension.getRecent(request.topicId, limit);

      const total = this.messageDimension.getCount(request.topicId);
      console.log(`[ChatPlan.getMessages] ⚡ MessageDimension: ${entries.length}/${total} entries in ${Date.now() - startTime}ms`);

      if (entries.length === 0) {
        return { success: true, messages: [], total, hasMore: false };
      }

      // Build participant name cache
      const participantNameCache = await this.buildParticipantNameCache(request.topicId);

      // Load content for only the requested entries (O(limit), not O(total))
      const ownerId = this.nodeOneCore.ownerId;
      const formattedMessages = (await Promise.all(entries.map(async (entry) => {
        return this.formatMessageFromEntry(entry, ownerId, participantNameCache);
      }))).filter((msg) =>
        // Skip empty messages (no content AND no attachments)
        (msg.content || (msg.attachments && msg.attachments.length > 0))
      );

      // Determine hasMore: if we got a full page AND there are more messages before
      const hasMore = request.before
        ? entries.length === limit
        : total > limit;

      console.log(`[ChatPlan.getMessages] ✅ Returning ${formattedMessages.length} messages in ${Date.now() - startTime}ms`);
      return {
        success: true,
        messages: formattedMessages,
        total,
        hasMore
      };
    } catch (error) {
      console.error('[ChatPlan] Error getting messages:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Resolve the participant set for a topic without going through channel state.
   */
  private async getTopicParticipantIds(topic: Topic, topicId: string): Promise<SHA256IdHash<Person>[]> {
    const hashGroup = await getObject(topic.participants) as HashGroup<Person>;
    const participantIds = Array.from(hashGroup.person || []) as SHA256IdHash<Person>[];
    if (participantIds.length === 0) {
      throw new Error(`Topic ${topicId} has no participants in its HashGroup`);
    }
    return participantIds;
  }

  /**
   * Grant object access to all topic participants.
   */
  private async grantObjectAccessToParticipants(
    objectHashes: SHA256Hash<any>[],
    participantIds: SHA256IdHash<Person>[]
  ): Promise<void> {
    if (objectHashes.length === 0 || participantIds.length === 0) {
      return;
    }

    await createAccess(
      objectHashes.flatMap(object => participantIds.map(person => ({
        object,
        person: [person],
        hashGroup: [] as SHA256Hash<HashGroup<Person>>[],
        mode: SET_ACCESS_MODE.ADD
      })))
    );
  }

  /**
   * Grant versioned-object IdAccess to all topic participants.
   */
  private async grantIdAccessToParticipants(
    objectIds: SHA256IdHash<any>[],
    participantIds: SHA256IdHash<Person>[]
  ): Promise<void> {
    if (objectIds.length === 0 || participantIds.length === 0) {
      return;
    }

    await createAccess(
      objectIds.flatMap(id => participantIds.map(person => ({
        id,
        person: [person],
        hashGroup: [] as SHA256Hash<HashGroup<Person>>[],
        mode: SET_ACCESS_MODE.ADD
      })))
    );
  }

  private async grantObjectAccessViaHashGroup(
    objectHashes: SHA256Hash<any>[],
    participantsHash: SHA256Hash<HashGroup<Person>>
  ): Promise<void> {
    if (objectHashes.length === 0) {
      return;
    }

    await createAccess(
      objectHashes.map(object => ({
        object,
        person: [] as SHA256IdHash<Person>[],
        hashGroup: [participantsHash],
        mode: SET_ACCESS_MODE.ADD
      }))
    );
  }

  private async grantIdAccessViaHashGroup(
    objectIds: SHA256IdHash<any>[],
    participantsHash: SHA256Hash<HashGroup<Person>>
  ): Promise<void> {
    if (objectIds.length === 0) {
      return;
    }

    await createAccess(
      objectIds.map(id => ({
        id,
        person: [] as SHA256IdHash<Person>[],
        hashGroup: [participantsHash],
        mode: SET_ACCESS_MODE.ADD
      }))
    );
  }

  /**
   * Store ChatAttachment wrappers for already-stored ONE objects.
   */
  private async storeChatAttachments(
    attachments: any[],
    participantsHash: SHA256Hash<HashGroup<Person>>
  ): Promise<SHA256Hash<ChatAttachment>[]> {
    if (!attachments.length) {
      return [];
    }

    const attachmentObjects = attachments.map(att => {
      if (typeof att === 'object' && att.hash && att.type) {
        return {
          hash: att.hash,
          type: att.type,
          metadata: att.mimeType || att.name || att.size || att.preview || att.thumbnailHash ? {
            name: att.name,
            mimeType: att.mimeType,
            size: att.size,
            preview: att.preview,
            thumbnailHash: att.thumbnailHash
          } : undefined
        };
      }
      if (typeof att === 'string') {
        return { hash: att, type: 'BLOB' };
      }
      return { hash: att?.hash || att?.id, type: att?.type || 'BLOB' };
    }).filter(att => att.hash);

    const chatAttachmentHashes: SHA256Hash<ChatAttachment>[] = [];
    const underlyingHashes: SHA256Hash<any>[] = [];

    for (const attachment of attachmentObjects) {
      const chatAttachment: ChatAttachment = {
        $type$: 'ChatAttachment',
        hash: attachment.hash,
        type: attachment.type,
        metadata: attachment.metadata
      };
      const result = await storeUnversionedObject(chatAttachment);
      chatAttachmentHashes.push(result.hash as SHA256Hash<ChatAttachment>);
      underlyingHashes.push(attachment.hash);
    }

    await this.grantObjectAccessViaHashGroup([...underlyingHashes, ...chatAttachmentHashes], participantsHash);

    return chatAttachmentHashes;
  }

  /**
   * Build participant name cache for a topic.
   * O(P) where P = participants (usually 2-5).
   */
  private async buildParticipantNameCache(topicId: string): Promise<Map<string, string>> {
    const participantNameCache = new Map<string, string>();
    try {
      const topic = await this.loadTopic(topicId);
      const hashGroup = await getObject(topic.participants) as HashGroup<Person>;
      if (hashGroup?.person) {
        const participantIds = Array.from(hashGroup.person) as SHA256IdHash<Person>[];

        await Promise.all(participantIds.map(async (personId) => {
          const personIdStr = personId.toString();

          if (personIdStr === this.nodeOneCore.ownerId?.toString()) {
            participantNameCache.set(personIdStr, 'You');
            return;
          }

          if (this.nodeOneCore.aiAssistantModel) {
            const ai = this.nodeOneCore.aiAssistantModel.getAIByPersonIdHash?.(personIdStr);
            console.log(`[ChatPlan] Resolving participant ${personIdStr.substring(0, 8)}: isAI=${!!ai}, name=${ai?.displayName}`);
            if (ai) {
              participantNameCache.set(personIdStr, ai.displayName || ai.modelId || 'AI');
              return;
            }
          }

          if (this.contactDimension) {
            const entry = this.contactDimension.getByPersonId(personIdStr);
            if (entry?.name) {
              participantNameCache.set(personIdStr, entry.name);
              return;
            }
          }
          if (this.nodeOneCore.leuteModel) {
            try {
              const name = this.nodeOneCore.leuteModel.getPersonName(personId);
              if (name && name !== 'N/A') {
                participantNameCache.set(personIdStr, name);
              }
            } catch {
              // Ignore lookup errors
            }
          }
        }));
      }
    } catch (e) {
      console.error('[ChatPlan] Failed to build participant cache:', e);
    }
    return participantNameCache;
  }

  private async getStoredParticipantIds(topicId: string): Promise<string[]> {
    if (!this.groupPlan) {
      throw new Error('GroupPlan not initialized');
    }

    const response = await this.groupPlan.getTopicParticipants({ topicId });
    if (!response?.success || !Array.isArray(response.participants)) {
      throw new Error(response?.error || `Failed to load participants for topic ${topicId}`);
    }

    return Array.from(new Set(response.participants.map((participantId: any) => String(participantId))));
  }

  private async getCurrentUserDisplayName(): Promise<string> {
    if (this.nodeOneCore.leuteModel) {
      try {
        const me: any = await this.nodeOneCore.leuteModel.me?.();
        const profile: any = await me?.mainProfile?.();
        if (profile) {
          const personName = profile.personDescriptions?.find((d: any) => d.$type$ === 'PersonName');
          return personName?.name || profile.name || 'You';
        }
      } catch (error) {
        console.warn('[ChatPlan] Failed to resolve current user display name:', error);
      }
    }

    return 'You';
  }

  private async resolveParticipantDisplayName(participantId: string, isAI: boolean): Promise<string> {
    if (participantId === String(this.nodeOneCore.ownerId)) {
      return this.getCurrentUserDisplayName();
    }

    if (this.contactDimension) {
      const entry = this.contactDimension.getByPersonId(participantId);
      if (entry?.name) {
        return entry.name;
      }
    }

    if (isAI) {
      const ai = this.nodeOneCore.aiAssistantModel?.getAIByPersonIdHash?.(participantId);
      if (ai?.displayName) {
        return ai.displayName;
      }
    }

    if (this.nodeOneCore.leuteModel) {
      try {
        const name = this.nodeOneCore.leuteModel.getPersonName?.(ensureIdHash<Person>(participantId));
        if (name && name !== 'N/A') {
          return name;
        }
      } catch {
        // Ignore and fall through to explicit query
      }

      try {
        const others = await this.nodeOneCore.leuteModel.others?.();
        if (others) {
          for (const someone of others) {
            const identity = await someone.mainIdentity();
            if (String(identity) !== participantId) {
              continue;
            }

            const profile: any = await someone.mainProfile();
            if (profile) {
              const personName = profile.personDescriptions?.find((d: any) => d.$type$ === 'PersonName');
              return personName?.name || profile.name || (isAI ? 'AI' : 'Unknown');
            }
          }
        }
      } catch (error) {
        console.warn(`[ChatPlan] Failed to resolve participant name for ${participantId.substring(0, 8)}:`, error);
      }
    }

    return isAI ? 'AI' : 'Unknown';
  }

  private async enrichParticipants(participantIds: string[]): Promise<any[]> {
    return Promise.all(
      Array.from(new Set(participantIds.map(String))).map(async (participantId) => {
        const isAI = this.nodeOneCore.aiAssistantModel?.isAIPerson(participantId as SHA256IdHash<Person>) ?? false;
        const llmModelId = isAI
          ? (this.nodeOneCore.aiAssistantModel?.getModelIdForPersonId(participantId as SHA256IdHash<Person>) ?? undefined)
          : undefined;

        return {
          id: participantId,
          name: await this.resolveParticipantDisplayName(participantId, isAI),
          isAI,
          isLLM: isAI,
          llmModelId,
          modelId: llmModelId
        };
      })
    );
  }

  /**
   * Format a message from a MessageDimension entry.
   * Loads only the ObjectData content for this specific message.
   */
  private async formatMessageFromEntry(
    entry: ChatPlanMessageEntry,
    ownerId: any,
    participantNameCache: Map<string, string>
  ): Promise<any> {
    // Load the ObjectData content by hash
    let msgData: any = {};
    try {
      msgData = await getObject(entry.dataHash as SHA256Hash);
    } catch (error) {
      console.warn('[ChatPlan] Failed to load message content:', entry.dataHash?.substring(0, 16), error);
    }

    const senderStr = entry.authorId;
    const isOwn = senderStr === ownerId?.toString();

    let senderName = senderStr ? participantNameCache.get(senderStr) : undefined;
    if (!senderName && senderStr && !isOwn) {
      senderName = this.resolveSenderName(senderStr, participantNameCache);
    }
    if (!senderName) senderName = isOwn ? 'You' : 'Unknown';

    let isAI = false;
    if (senderStr && this.nodeOneCore.aiAssistantModel) {
      try {
        isAI = this.nodeOneCore.aiAssistantModel.isAIPerson(senderStr);
      } catch { isAI = false; }
    }

    const thinking = msgData?.thinking;

    // Resolve reply context
    let replyTo: { messageId: string; text: string; senderName: string } | undefined;
    if (msgData?.replyTo) {
      try {
        const replyData = await getObject(msgData.replyTo as SHA256Hash);
        const replySender = (replyData as any)?.sender?.toString();
        const replySenderName = replySender ? (participantNameCache.get(replySender) || 'Unknown') : 'Unknown';
        replyTo = {
          messageId: msgData.replyTo,
          text: ((replyData as any)?.text || '').substring(0, 100),
          senderName: replySenderName
        };
      } catch {
        replyTo = {
          messageId: msgData.replyTo,
          text: '[Message not found]',
          senderName: 'Unknown'
        };
      }
    }

    // Load attachments
    const rawAttachments = msgData?.attachments || [];
    const attachments = await this.loadAttachments(rawAttachments);

    return {
      id: entry.entryHash,
      dataHash: entry.dataHash,
      content: msgData?.text || '',
      sender: senderStr,
      senderName,
      timestamp: entry.timestamp,
      attachments,
      creationTime: entry.timestamp,
      thinking,
      isAI,
      isOwn,
      replyTo,
      format: 'markdown' as const
    };
  }

  /**
   * Resolve sender name from ContactDimension or LeuteModel cache.
   */
  private resolveSenderName(senderStr: string, cache: Map<string, string>): string | undefined {
    if (this.contactDimension) {
      const entry = this.contactDimension.getByPersonId(senderStr);
      if (entry?.name) {
        cache.set(senderStr, entry.name);
        return entry.name;
      }
    }
    if (this.nodeOneCore.leuteModel) {
      try {
        const name = this.nodeOneCore.leuteModel.getPersonName(ensureIdHash<Person>(senderStr));
        if (name && name !== 'N/A') {
          cache.set(senderStr, name);
          return name;
        }
      } catch { /* ignore */ }
    }
    return undefined;
  }

  /**
   * Load ChatAttachment objects by their hashes.
   */
  private async loadAttachments(rawAttachments: SHA256Hash[]): Promise<any[]> {
    return Promise.all(rawAttachments.map(async (attHash: SHA256Hash) => {
      try {
        const chatAttachment = await getObject(attHash) as any;
        return {
          hash: chatAttachment.hash as string,
          type: chatAttachment.type,
          name: chatAttachment.metadata?.name,
          size: chatAttachment.metadata?.size,
          mimeType: chatAttachment.metadata?.mimeType,
          preview: chatAttachment.metadata?.preview,
          thumbnailHash: chatAttachment.metadata?.thumbnailHash
        };
      } catch (error) {
        console.error('[ChatPlan] Failed to fetch ChatAttachment:', attHash, error);
        return { hash: attHash as string };
      }
    }));
  }

  /**
   * Create a new conversation
   */
  async createConversation(request: CreateConversationRequest): Promise<CreateConversationResponse> {
    const userId = this.nodeOneCore.ownerId || this.stateManager?.getState('user.id');

    // StoryFactory disabled - Story requires product (Assembly) reference which isn't implemented yet
    // TODO: Re-enable when Assembly/Story integration is complete
    return await this.createConversationInternal(request, userId);
  }

  /**
   * Internal implementation of createConversation (wrapped by Story+Assembly recording)
   */
  private async createConversationInternal(request: CreateConversationRequest, userId: string | null): Promise<CreateConversationResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      if (!this.groupPlan) {
        throw new Error('GroupPlan not initialized');
      }

      if (!userId) {
        throw new Error('User not authenticated');
      }

      const participants = request.participants || [];
      const name = request.name || `Conversation ${Date.now()}`;

      if ((request.type === 'direct' || request.type === 'ai' || !request.type) && participants.length === 1) {
        const localPersonId = ensureIdHash<Person>(String(userId));
        const remotePersonId = ensureIdHash<Person>(String(participants[0]));
        const p2pResult = await this.createP2PConversation({ localPersonId, remotePersonId });

        if (!p2pResult.success || !p2pResult.topicId) {
          throw new Error(p2pResult.error || 'P2P topic creation failed');
        }

        const topicId = p2pResult.topicId;
        const storedParticipantIds = await this.getStoredParticipantIds(topicId);
        await this.ensureTopicTrieAccess(topicId);
        const enrichedParticipants = await this.enrichParticipants(storedParticipantIds);
        console.log(`[ChatPlan] P2P topic ready: ${topicId.substring(0, 16)} participants=${storedParticipantIds.length}`);

        if (this.nodeOneCore.aiAssistantModel) {
          try {
            for (const participantId of storedParticipantIds) {
              if (this.nodeOneCore.aiAssistantModel.isAIPerson(participantId)) {
                const modelId = this.nodeOneCore.aiAssistantModel.getModelIdForPersonId(participantId);
                if (modelId) {
                  await this.nodeOneCore.aiAssistantModel.registerAITopic(topicId, participantId);
                  console.error(`[ChatPlan] Detected AI participant ${participantId.substring(0, 8)} with model: ${modelId}`);

                  const isDefaultChat = topicId === 'hi' || topicId === 'vger' || topicId === 'glue';
                  if (!isDefaultChat) {
                    this.nodeOneCore.aiAssistantModel.handleNewTopic({ topicId }).catch((error: Error) => {
                      console.error('[ChatPlan] Failed to generate welcome message:', error);
                    });
                  }
                  break;
                }
              }
            }
          } catch (error) {
            console.error('[ChatPlan] Failed to detect/register AI participants:', error);
          }
        }

        return {
          success: true,
          data: {
            id: topicId,
            name,
            type: request.type || 'direct',
            participants: enrichedParticipants,
            created: Date.now()
          }
        };
      }

      // Topic identity is {participants, originalName} — ONE.core computes the idHash.
      // Same participants + same name = same topic (idempotent, content-addressed).
      const result = await this.groupPlan.createTopic({
        topicName: name,
        participants
      });

      if (!result.success) {
        throw new Error(result.error || 'Topic creation failed');
      }

      const topicId = String(result.topicIdHash);
      const storedParticipantIds = await this.getStoredParticipantIds(topicId);
      await this.ensureTopicTrieAccess(topicId);
      const enrichedParticipants = await this.enrichParticipants(storedParticipantIds);
      console.log(`[ChatPlan] Topic ready: ${topicId.substring(0, 16)} name="${name}" participants=${storedParticipantIds.length}`);

      // Detect AI participants and register topic automatically
      console.error(`[ChatPlan] createConversation checking ${storedParticipantIds.length} participants for AI:`, storedParticipantIds);
      if (this.nodeOneCore.aiAssistantModel) {
        try {
          for (const participantId of storedParticipantIds) {
            console.error(`[ChatPlan] Checking participant: ${participantId}`);
            if (this.nodeOneCore.aiAssistantModel.isAIPerson(participantId)) {
              const modelId = this.nodeOneCore.aiAssistantModel.getModelIdForPersonId(participantId);
              if (modelId) {
                await this.nodeOneCore.aiAssistantModel.registerAITopic(topicId, participantId);
                console.error(`[ChatPlan] Detected AI participant ${participantId.substring(0, 8)} with model: ${modelId}`);

                // Default chats (hi/vger/glue) are handled by AITopicManager callback
                // User-created chats need welcome message triggered here
                const isDefaultChat = topicId === 'hi' || topicId === 'vger' || topicId === 'glue';
                if (!isDefaultChat) {
                  this.nodeOneCore.aiAssistantModel.handleNewTopic({ topicId }).catch((error: Error) => {
                    console.error('[ChatPlan] Failed to generate welcome message:', error);
                  });
                }
                break; // Only register first AI participant
              }
            }
          }
        } catch (error) {
          console.error('[ChatPlan] Failed to detect/register AI participants:', error);
          // Non-fatal - conversation creation succeeded
        }
      }

      return {
        success: true,
        data: {
          id: topicId,
          name,
          type: request.type || 'direct',
          participants: enrichedParticipants,  // Enriched with names to match getConversations format
          created: Date.now()
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all conversations
   */
  async getConversations(request: GetConversationsRequest): Promise<GetConversationsResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('TopicModel not initialized');
      }

      const limit = request.limit || 20;
      const offset = request.offset || 0;

      // Use TopicDimension when available (O(1) memory lookups, pre-sorted),
      // fall back to topics.all() (loads every Topic from storage) otherwise
      const useTopicDimension = !!this.topicDimension && this.topicDimension.all().length > 0;
      const topics = useTopicDimension ? null : await this.nodeOneCore.topicModel.topics.all();
      if (useTopicDimension) {
        console.log(`[ChatPlan] Using TopicDimension (${this.topicDimension!.all().length} topics)`);
      }

      // PRE-BUILD CONTACT NAME CACHE - O(C) once instead of O(T*P*C)
      const contactNameCache = new Map<string, { name: string; isAI: boolean; modelId?: string }>();
      const cacheStartTime = Date.now();

      // Add current user
      const ownerId = this.nodeOneCore.ownerId;
      if (ownerId) {
        let myName = 'You';
        try {
          if (this.nodeOneCore.leuteModel) {
            const me = await this.nodeOneCore.leuteModel.me();
            if (me) {
              const profile = await me.mainProfile();
              if (profile) {
                const personName = profile.personDescriptions?.find((d: any) => d.$type$ === 'PersonName');
                myName = personName?.name || profile.name || 'You';
              }
            }
          }
        } catch (e) { /* ignore */ }
        contactNameCache.set(String(ownerId), { name: myName, isAI: false });
      }

      // Add AI contacts
      if (this.nodeOneCore.llmObjectManager) {
        try {
          if (!(this.nodeOneCore.llmObjectManager as any).initialized) {
            await this.nodeOneCore.llmObjectManager.initialize();
          }
          const allLLMs = this.nodeOneCore.llmObjectManager.getAllLLMObjects();
          for (const llm of allLLMs) {
            const llmData = llm as any;
            if (llmData.personId && llmData.modelId) {
              contactNameCache.set(String(llmData.personId), {
                name: llmData.name || llmData.displayName || llmData.modelId,
                isAI: true,
                modelId: llmData.modelId
              });
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Add other contacts - use ContactDimension (O(1) memory) when available,
      // fall back to leuteModel.others() (expensive storage reads) otherwise
      if (this.contactDimension) {
        // O(1) - all contacts are pre-indexed in memory
        const allContacts = this.contactDimension.all();
        for (const entry of allContacts) {
          if (!contactNameCache.has(entry.personIdHash)) {
            contactNameCache.set(entry.personIdHash, { name: entry.name, isAI: false });
          }
        }
        console.log(`[ChatPlan] Contact cache from ContactDimension: ${allContacts.length} contacts`);
      } else if (this.nodeOneCore.leuteModel) {
        // Fallback: load all contacts from storage (expensive)
        try {
          const others = await this.nodeOneCore.leuteModel.others();
          const results = await Promise.all(others.map(async (someone: any) => {
            try {
              const personId = await someone.mainIdentity();
              if (!personId) return null;
              const profile = await someone.mainProfile();
              if (!profile) return null;
              const personName = profile.personDescriptions?.find((d: any) => d.$type$ === 'PersonName');
              const name = personName?.name || profile.name || 'Contact';
              return { personId: String(personId), name };
            } catch { return null; }
          }));
          for (const r of results) {
            if (r && !contactNameCache.has(r.personId)) {
              contactNameCache.set(r.personId, { name: r.name, isAI: false });
            }
          }
        } catch (e) { /* ignore */ }
      }

      console.log(`[ChatPlan] Built contact cache with ${contactNameCache.size} entries in ${Date.now() - cacheStartTime}ms`);

      // Convert to conversation format
      // Two paths: fast (TopicDimension) and fallback (storage reads)
      let conversations: any[];

      if (useTopicDimension) {
        // ===== FAST PATH: TopicDimension (pure memory, zero storage reads) =====
        const topicEntries = this.topicDimension!.allByLastActivity() // pre-sorted by lastActivity
          .filter(entry => !this.topicDimension!.isSuperseded(entry.topicIdHash)); // hide superseded topics

        conversations = await Promise.all(topicEntries.map(async (entry) => {
          const topicIdHash = entry.topicIdHash;
          const topicName = entry.displayName || entry.name || topicIdHash.substring(0, 16);

          // Enrich participants from pre-indexed data - O(1) per participant
          let participants: any[] = [];
          const participantIds = entry.participantIds.length > 0
            ? entry.participantIds
            : (ownerId ? [String(ownerId)] : []);

          participants = participantIds.map((participantId) => {
            const cached = contactNameCache.get(participantId);
            const name = cached?.name || 'Unknown';
            const isAI = cached?.isAI || false;
            const llmModelId = isAI ? cached?.modelId : undefined;

            return { id: participantId, name, isAI, isLLM: isAI, llmModelId, modelId: llmModelId };
          });

          // AI topic detection (in-memory checks only)
          let isAITopic = false;
          if (this.nodeOneCore.aiAssistantModel?.topicManager?.isAITopic) {
            isAITopic = this.nodeOneCore.aiAssistantModel.topicManager.isAITopic(topicIdHash);
          }

          // Resolve LLM model IDs for AI participants that don't have one cached
          if (isAITopic) {
            for (const p of participants) {
              if (!p.isAI || p.llmModelId) continue;
              if (this.nodeOneCore.aiAssistantModel?.aiManager?.getLLMId) {
                p.llmModelId = await this.nodeOneCore.aiAssistantModel.aiManager.getLLMId(p.id);
              }
            }
          }

          // P2P display name resolution using participant list (no storage reads)
          // AI topics already have meaningful names (Hi, glue.one, moltbook) — don't override
          let displayName = topicName;
          const isP2P = participantIds.length === 2 && !entry.name;
          if (isP2P && !isAITopic) {
            const myId = String(this.nodeOneCore.ownerId);
            const otherId = participantIds.find(id => id !== myId);
            if (otherId) {
              const cached = contactNameCache.get(otherId);
              if (cached?.isAI) {
                // Other participant is AI but topicAIMap wasn't populated yet (init race)
                // Keep the topic's original name (Hi, VGER, glue.one, etc.)
                isAITopic = true;
              } else if (cached?.name) {
                displayName = cached.name;
              } else {
                displayName = `Contact ${otherId.substring(0, 8)}`;
              }
            }
          }

          // Include conversation chain if this topic is part of one
          const chain = this.topicDimension!.getConversationChain(topicIdHash);
          const topicIdChain = chain.length > 1 ? chain : undefined;

          return {
            id: topicIdHash,
            topicIdHash,
            groupIdHash: entry.groupIdHash,
            name: displayName,
            type: 'chat',
            participants,
            lastActivity: entry.lastActivity,
            lastMessage: '',
            unreadCount: 0,
            isAITopic,
            source: entry.source,
            topicIdChain
          };
        }));
      } else {
        // ===== FALLBACK PATH: Full storage reads (when dimensions unavailable) =====
        // Each topic is wrapped in try/catch so partially-synced topics (e.g. during
        // CHUM sync when vheads haven't arrived yet) don't kill the entire list.
        const rawConversations = await Promise.all(
          topics!.map(async (topic: any) => {
            try {
            // Calculate topic ID hash from Topic object
            const topicId = await calculateIdHashOfObj(topic as Topic);
            const name = topic.displayName ?? topic.originalName ?? topicId.substring(0, 16);
            const topicIdHash = String(topicId);

            // Get participants directly from Topic.participants and enrich names/model info.
            let participants: any[] = [];
            try {
              let participantIds: string[] = [];

              try {
                const hashGroup = await getObject(topic.participants) as HashGroup<Person>;
                if (hashGroup.person) {
                  participantIds = Array.from(hashGroup.person).map((id: any) => String(id));
                }
              } catch (e) {
                console.warn(`[ChatPlan] Topic ${topicId} (${name}) - failed to get participants from Topic.participants:`, e);
              }

              if (participantIds.length === 0) {
                console.warn(`[ChatPlan] Topic ${topicId} (${name}) - no participants in topic, using owner only`);
                const currentUserId = this.nodeOneCore.ownerId;
                if (currentUserId) {
                  participantIds = [String(currentUserId)];
                }
              }

              // Enrich each participant using pre-built cache - O(1) lookup per participant
              participants = participantIds.map((participantId) => {
                const cached = contactNameCache.get(participantId);
                const name = cached?.name || 'Unknown';
                const isAI = cached?.isAI || false;
                const llmModelId = isAI ? cached?.modelId : undefined;

                return { id: participantId, name, isAI, isLLM: isAI, llmModelId, modelId: llmModelId };
              });
            } catch (error) {
              console.error(`[ChatPlan] Error fetching participants for topic ${topicId}:`, error);

              if (participants.length === 0) {
                const currentUserId = this.nodeOneCore.ownerId;
                if (currentUserId) {
                  participants = [{
                    id: String(currentUserId),
                    name: 'You',
                    isAI: false
                  }];
                }
              }
            }

            const lastMessage = '';
            const lastMessageTime = Date.now();

            // AI topic detection
            let isAITopic = false;
            if (this.nodeOneCore.aiAssistantModel?.topicManager?.isAITopic) {
              isAITopic = this.nodeOneCore.aiAssistantModel.topicManager.isAITopic(topicId);
            }

            // Resolve LLM model IDs for AI participants that don't have one cached
            if (isAITopic) {
              for (const p of participants) {
                if (!p.isAI || p.llmModelId) continue;
                if (this.nodeOneCore.aiAssistantModel?.aiManager?.getLLMId) {
                  p.llmModelId = await this.nodeOneCore.aiAssistantModel.aiManager.getLLMId(p.id);
                }
              }
            }

            // Resolve display name for P2P topics (HashGroup-based ID)
            // AI topics already have meaningful names — don't override
            let displayName = name || topicId;
            const isP2P = await this.nodeOneCore.topicModel?.isOneToOneChatAsync?.(topic) ?? false;
            if (isP2P && !isAITopic && this.nodeOneCore.topicModel) {
              let personA: string, personB: string;
              try {
                [personA, personB] = await this.nodeOneCore.topicModel.getOneToOneChatParticipants(topic);
              } catch {
                personA = '';
                personB = '';
              }
              const myId = String(this.nodeOneCore.ownerId);
              const otherId = (personA === myId) ? personB : personA;

              // Use pre-built cache instead of re-loading all contacts
              const cached = contactNameCache.get(otherId);
              if (cached?.name) {
                displayName = cached.name;
              } else if (otherId) {
                displayName = `Contact ${otherId.substring(0, 8)}`;
              }
            }

            return {
              id: topicId,
              topicIdHash,
              groupIdHash: topic.group ? String(topic.group) : undefined,
              name: displayName,
              type: 'chat',
              participants,
              lastActivity: lastMessageTime,
              lastMessage,
              unreadCount: 0,
              isAITopic,
              source: topic.source
            };
            } catch (topicError) {
              // Skip topics that fail to load (e.g. during CHUM sync when vheads
              // haven't arrived yet — SB-READ2). Return null and filter below.
              console.warn(`[ChatPlan] Skipping topic during fallback (likely mid-sync):`, topicError);
              return null;
            }
          })
        );
        conversations = rawConversations.filter((c): c is NonNullable<typeof c> => c !== null);
      }

      // Sort by last activity (fast path is already sorted, fallback path needs sort)
      const sortedConversations = useTopicDimension
        ? conversations  // Already sorted by allByLastActivity()
        : conversations.sort((a, b) => b.lastActivity - a.lastActivity);
      console.log(`[ChatPlan] After conversion: ${conversations.length} conversations:`,
        conversations.map(c => ({ id: c.id, name: c.name, participants: c.participants.length, isAITopic: c.isAITopic })));

      // Apply pagination
      const paginatedConversations = sortedConversations.slice(offset, offset + limit);
      console.log(`[ChatPlan] Returning ${paginatedConversations.length} conversations (offset: ${offset}, limit: ${limit})`);

      return {
        success: true,
        data: paginatedConversations
      };
    } catch (error) {
      console.error('[ChatPlan] Error getting conversations:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get a single conversation
   */
  async getConversation(request: GetConversationRequest): Promise<GetConversationResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('Node not initialized');
      }

      // Try to get the topic
      const topic = await this.loadTopic(request.topicId);
      const topicWithMetadata = topic as Topic & {
        creationTime?: number;
        displayName?: string;
        originalName?: string;
      };

      // Calculate topic ID hash from Topic object
      const topicIdHash = await calculateIdHashOfObj(topic as Topic);
      const topicDisplayName = topicWithMetadata.displayName ?? topicWithMetadata.originalName ?? topicIdHash.substring(0, 16);
      const participantIds = await this.getStoredParticipantIds(String(topicIdHash));
      const participants = await this.enrichParticipants(participantIds);
      const hasAIParticipant = participants.some(participant => participant.isAI);
      const llmModelId = participants.find(participant => participant.isAI)?.llmModelId;

      // Convert to conversation format
      const conversation: any = {
        id: topicIdHash,
        name: topicDisplayName,
        createdAt: topicWithMetadata.creationTime ? new Date(topicWithMetadata.creationTime).toISOString() : new Date().toISOString(),
        participants,
        participantCount: participants.length,
        hasAIParticipant,
        isAITopic: hasAIParticipant,
        llmModelId,
        modelName: llmModelId
      };

      return {
        success: true,
        data: conversation
      };
    } catch (error) {
      console.error('[ChatPlan] Error getting conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create a P2P (one-to-one) conversation
   *
   * Uses P2PTopicService internally to create topic with proper channel setup.
   * All P2P topic creation MUST go through this method - platform code should NOT
   * call P2PTopicService or TopicModel directly.
   */
  async createP2PConversation(request: CreateP2PConversationRequest): Promise<CreateP2PConversationResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('Node not initialized');
      }

      const { localPersonId, remotePersonId } = request;

      console.log('[ChatPlan] Creating P2P conversation');
      console.log('[ChatPlan]   Local person:', localPersonId?.substring(0, 8));
      console.log('[ChatPlan]   Remote person:', remotePersonId?.substring(0, 8));

      // Use P2PTopicService to create the topic (returns HashGroup-based topicId)
      const { wasCreated, topicId } = await createP2PTopic(
        this.nodeOneCore.topicModel,
        localPersonId,
        remotePersonId
      );

      if (wasCreated) {
        console.log('[ChatPlan] ✅ Created new P2P conversation:', topicId.substring(0, 16));
      } else {
        console.log('[ChatPlan] ✅ Using existing P2P conversation:', topicId.substring(0, 16));
      }

      return {
        success: true,
        topicId
      };
    } catch (error) {
      console.error('[ChatPlan] Error creating P2P conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Create a group conversation with proper Group/HashGroup structure.
   *
   * This method implements the new group chat architecture:
   * 1. Creates HashGroup with participants
   * 2. Uses GroupChatPlan to create Group referencing HashGroup
   * 3. Uses TopicModel to create Topic referencing Group
   * 4. Grants access via HashGroup (CHUM handles automatic distribution)
   *
   * @param name - Name of the group conversation
   * @param participants - Person IDs of all participants (owner is auto-included)
   * @returns The created Topic
   */
  async createGroupConversation(
    name: string,
    participants: SHA256IdHash<Person>[]
  ): Promise<Topic> {
    if (!this.nodeOneCore.topicModel) {
      throw new Error('TopicModel not initialized');
    }

    if (!this.nodeOneCore.ownerId) {
      throw new Error('Owner ID not set');
    }

    console.log(`[ChatPlan] Creating group conversation "${name}" with ${participants.length} participants`);

    // Ensure owner is included in participants
    const allParticipants = [...participants];
    if (!allParticipants.includes(this.nodeOneCore.ownerId)) {
      allParticipants.unshift(this.nodeOneCore.ownerId);
    }

    // Step 1: Create HashGroup with participants
    const hashGroup: HashGroup<Person> = {
      $type$: 'HashGroup',
      person: new Set(allParticipants)
    };
    const hashGroupResult = await storeUnversionedObject(hashGroup);
    const hashGroupHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

    // Grant access to the HashGroup object itself so it can sync via CHUM
    // CRITICAL: Use person-based access for CHUM sync to work across fresh pairings
    // HashGroup-based access creates a circular dependency (need HashGroup to verify HashGroup access)
    await createAccess([{
      object: hashGroupHash,
      person: allParticipants,
      hashGroup: [],
      mode: SET_ACCESS_MODE.ADD
    }]);

    console.log(`[ChatPlan] Created HashGroup: ${hashGroupHash.substring(0, 8)}`);

    // Step 2: Create Group referencing HashGroup
    const group: Group = {
      $type$: 'Group',
      name,
      owner: this.nodeOneCore.ownerId,
      hashGroup: hashGroupHash,
      participants: hashGroupHash
    };
    const groupResult = await storeVersionedObject(group);
    const groupIdHash = groupResult.idHash as SHA256IdHash<Group>;
    console.log(`[ChatPlan] Created Group: ${groupIdHash.substring(0, 8)}`);

    // Step 3: Create Topic referencing Group
    // Channel identity is based on participants only (no owner)
    const topic = await this.nodeOneCore.topicModel.createGroupTopic(
      name,
      groupIdHash
      // topicId auto-generated
    );
    const topicIdHash = await calculateIdHashOfObj(topic);

    console.log(`[ChatPlan] Created Topic: ${topicIdHash.substring(0, 8)}`);

    // Step 4: Grant additional HashGroup-based access to Topic
    // Note: TopicModel.createGroupTopic already grants person-based access to both
    // Topic and ChannelInfo via grantPersonAccess. This additional HashGroup-based
    // grant provides redundant access that may help with future group membership changes.
    const accessRequests: SetAccessParam[] = [
      {
        id: topicIdHash,
        person: [],
        hashGroup: [hashGroupHash],
        mode: SET_ACCESS_MODE.ADD
      }
    ];

    await createAccess(accessRequests);
    console.log(`[ChatPlan] Granted access via HashGroup`);

    await this.ensureTopicTrieAccess(String(topicIdHash));

    const topicDisplayName = topic.displayName ?? topic.originalName ?? topicIdHash.substring(0, 16);
    console.log(`[ChatPlan] Group conversation created: ${topicDisplayName}`);

    return topic;
  }

  /**
   * Get current user
   */
  async getCurrentUser(_request: GetCurrentUserRequest): Promise<GetCurrentUserResponse> {
    try {
      if (!this.nodeOneCore.ownerId) {
        // Fallback to state manager
        const userId = this.stateManager?.getState('user.id');
        const userName = this.stateManager?.getState('user.name');

        if (userId) {
          return {
            success: true,
            user: {
              id: userId,
              name: userName || 'User'
            }
          };
        }

        return {
          success: false,
          error: 'User not authenticated'
        };
      }

      // Get from ONE.core instance
      const ownerId = this.nodeOneCore.ownerId;
      let userName = 'User';

      // Try to get name from LeuteModel
      if (this.nodeOneCore.leuteModel) {
        try {
          const me: any = await this.nodeOneCore.leuteModel.me();
          if (me) {
            const profile: any = await me.mainProfile();
            if (profile?.personDescriptions?.length > 0) {
              const nameDesc = profile.personDescriptions.find((d: any) =>
                d.$type$ === 'PersonName' && d.name
              );
              if (nameDesc?.name) {
                userName = nameDesc.name;
              }
            }
          }
        } catch (e) {
          console.warn('[ChatPlan] Could not get user profile:', e);
        }
      }

      return {
        success: true,
        user: {
          id: String(ownerId),
          name: userName
        }
      };
    } catch (error) {
      console.error('[ChatPlan] Error getting current user:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Add participants to a conversation
   *
   * Because Topic.participants is isId=true, changing participants changes the Topic's idHash.
   * We cannot "update" a Topic's participants — we create a NEW Topic with merged participants
   * and link old→new via TopicDimension's conversation chain.
   *
   * The UI presents one conversation backed by a chain of Topic identities.
   * broadParticipantQuery ensures messages from all chain eras are visible.
   */
  async addParticipants(request: AddParticipantsRequest): Promise<AddParticipantsResponse> {
    try {
      console.log('[ChatPlan] ========== ADD PARTICIPANTS START ==========');
      console.log('[ChatPlan] Conversation:', request.topicId);
      console.log('[ChatPlan] Participant IDs to add:', request.participantIds);
      console.log('[ChatPlan] Hidden AI IDs to bind:', request.hiddenAIIds || []);

      if (!this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      if (!this.groupPlan) {
        throw new Error('GroupPlan not initialized');
      }

      // 1. Get current participants from the old topic's HashGroup
      const oldTopic = await this.loadTopic(request.topicId);

      const hiddenAIIds = Array.from(new Set(request.hiddenAIIds || []));
      const visibleParticipantIds = [...new Set(request.participantIds)];

      if (visibleParticipantIds.length === 0 && hiddenAIIds.length > 0) {
        await this.bindHiddenAIsToTopic(request.topicId, hiddenAIIds);

        return {
          success: true,
          data: {
            topicId: request.topicId,
            addedParticipants: []
          }
        };
      }

      const hashGroup = await getObject(oldTopic.participants) as any;
      const currentParticipants: string[] = Array.from(hashGroup.person || new Set());

      // 2. Merge new participants (dedup)
      const allParticipants = [...new Set([...currentParticipants, ...visibleParticipantIds])];
      console.log('[ChatPlan] Merged participants:', allParticipants.length, '(was', currentParticipants.length, ')');

      // 3. Create NEW Topic via GroupPlan.createTopic (same originalName → keeps discriminator stable)
      const topicName = oldTopic.originalName || oldTopic.displayName || '';
      const result = await this.groupPlan.createTopic({
        topicName,
        participants: allParticipants as any[]
      });

      if (!result.success || !result.topicIdHash) {
        throw new Error(`Failed to create new topic: ${result.error}`);
      }

      const newTopicIdHash = String(result.topicIdHash);
      console.log('[ChatPlan] New topic created:', newTopicIdHash.substring(0, 16), '(old:', request.topicId.substring(0, 16), ')');

      await this.ensureTopicTrieAccess(newTopicIdHash);

      // 4. Copy displayName to new topic if old topic had a custom one
      if (oldTopic.displayName && oldTopic.displayName !== oldTopic.originalName) {
        try {
          const newTopicResult = await getObjectByIdHash(result.topicIdHash);
          const newTopic = newTopicResult.obj as any;
          if (newTopic.displayName !== oldTopic.displayName) {
            newTopic.displayName = oldTopic.displayName;
            await storeVersionedObject(newTopic);
          }
        } catch (e) {
          console.warn('[ChatPlan] Could not copy displayName to new topic:', e);
        }
      }

      // 5. Track the chain in TopicDimension
      if (this.topicDimension) {
        this.topicDimension.registerConversationChain(request.topicId, newTopicIdHash);
        console.log('[ChatPlan] Conversation chain registered:', request.topicId.substring(0, 8), '→', newTopicIdHash.substring(0, 8));
      }

      // 6. Grant access on old topic to new participants (so they can read history)
      await this.nodeOneCore.topicModel.addPersonsToTopic(
        visibleParticipantIds as any[],
        oldTopic
      );

      // 7. Wrap with StoryFactory for Assembly tracking (if available)
      if (this.storyFactory) {
        try {
          const conversationGroupId = this.topicDimension
            ? (this.topicDimension.getConversationChain(request.topicId)[0] || request.topicId)
            : request.topicId;

          await this.storyFactory.wrapExecution(
            { title: 'Add participants to conversation', conversationGroupId },
            async () => ({
              result: { newTopicIdHash, oldTopicIdHash: request.topicId },
              productHash: conversationGroupId
            })
          );
        } catch (e) {
          console.error('[ChatPlan] StoryFactory recording failed (non-fatal, addParticipants succeeded):', e);
        }
      }

      // 8. Detect if any new participant is AI and register the new topic
      if (this.nodeOneCore.aiAssistantModel) {
        for (const participantId of visibleParticipantIds) {
          const isAI = this.nodeOneCore.aiAssistantModel.isAIPerson(participantId);
          if (isAI) {
            const modelId = this.nodeOneCore.aiAssistantModel.getModelIdForPersonId(participantId);
            console.log('[ChatPlan] Detected new AI participant - PersonId:', participantId.substring(0, 8), 'ModelId:', modelId);

            // Register the NEW topic with the AI Person's ID hash
            await this.nodeOneCore.aiAssistantModel.registerAITopic(newTopicIdHash, participantId as any);

            // Trigger introduction message from AI (fire and forget)
            this.nodeOneCore.aiAssistantModel.handleNewTopic({ topicId: newTopicIdHash }).catch((error: Error) => {
              console.error('[ChatPlan] Failed to generate AI introduction message:', error);
            });

            break; // Only register the first AI participant
          }
        }

        if (hiddenAIIds.length > 0) {
          await this.bindHiddenAIsToTopic(newTopicIdHash, hiddenAIIds);
        }
      }

      console.log('[ChatPlan] ========== ADD PARTICIPANTS END ==========');

      return {
        success: true,
        data: {
          topicId: request.topicId,
          addedParticipants: visibleParticipantIds,
          newConversationId: newTopicIdHash  // UI switches to this
        }
      };
    } catch (error) {
      console.error('[ChatPlan] Error adding participants:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  private async bindHiddenAIsToTopic(topicId: string, hiddenAIIds: string[]): Promise<void> {
    if (!this.nodeOneCore.aiAssistantModel || hiddenAIIds.length === 0) {
      return;
    }

    for (const aiPersonId of hiddenAIIds) {
      if (!this.nodeOneCore.aiAssistantModel.isAIPerson(aiPersonId)) {
        continue;
      }

      await this.nodeOneCore.aiAssistantModel.registerAITopic(topicId, aiPersonId as any, undefined, {
        hidden: true,
        defaultSettings: {
          analyse: true,
          respond: false,
          ignore: false
        }
      });
    }
  }

  /**
   * Clear a conversation
   */
  async clearConversation(request: ClearConversationRequest): Promise<ClearConversationResponse> {
    try {
      if (!this.nodeOneCore.topicModel) {
        throw new Error('Models not initialized');
      }

      await this.loadTopic(request.topicId);

      // Clear conversation
      // TODO: Implement actual clear logic

      return { success: true };
    } catch (error) {
      console.error('[ChatPlan] Error clearing conversation:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Edit a message
   */
  async editMessage(request: EditMessageRequest): Promise<EditMessageResponse> {
    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      // Create new version
      const result = await this.messageVersionManager.createNewVersion(
        request.messageId,
        request.newText,
        request.editReason
      );

      return {
        success: true,
        data: {
          messageId: request.messageId,
          newVersion: result.newVersionHash,
          editedAt: Date.now()
        }
      };
    } catch (error) {
      console.error('[ChatPlan] Error editing message:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Delete a message
   */
  async deleteMessage(request: DeleteMessageRequest): Promise<DeleteMessageResponse> {
    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      // Mark as deleted
      await this.messageVersionManager.markAsDeleted(request.messageId, request.reason);

      return { success: true };
    } catch (error) {
      console.error('[ChatPlan] Error deleting message:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get message history
   */
  async getMessageHistory(request: GetMessageHistoryRequest): Promise<GetMessageHistoryResponse> {
    try {
      if (!this.messageVersionManager) {
        throw new Error('Message version manager not initialized');
      }

      const history = await this.messageVersionManager.getVersionHistory(request.messageId);

      return {
        success: true,
        history
      };
    } catch (error) {
      console.error('[ChatPlan] Error getting message history:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Export message credential
   */
  async exportMessageCredential(request: ExportMessageCredentialRequest): Promise<ExportMessageCredentialResponse> {
    try {
      if (!this.messageAssertionManager) {
        throw new Error('Message assertion manager not initialized');
      }

      const credential = await this.messageAssertionManager.exportCredential(request.messageId);

      return {
        success: true,
        credential
      };
    } catch (error) {
      console.error('[ChatPlan] Error exporting credential:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Verify message assertion
   */
  async verifyMessageAssertion(request: VerifyMessageAssertionRequest): Promise<VerifyMessageAssertionResponse> {
    try {
      if (!this.messageAssertionManager) {
        throw new Error('Message assertion manager not initialized');
      }

      const valid = await this.messageAssertionManager.verifyAssertion(
        request.certificateHash,
        request.messageHash
      );

      return {
        success: true,
        valid
      };
    } catch (error) {
      console.error('[ChatPlan] Error verifying assertion:', error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
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
        name: 'sendMessage',
        description: 'Send a message to a conversation topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID to send the message to' },
            content: { type: 'string', description: 'The message content' },
            attachments: { type: 'array', description: 'Optional attachment hashes' },
            senderId: { type: 'string', description: 'Person ID hash of the sender (defaults to current user). Use to send as an AI participant.' }
          },
          required: ['topicId', 'content']
        }
      },
      {
        name: 'getMessages',
        description: 'Get messages from a conversation topic.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID to get messages from' },
            limit: { type: 'number', description: 'Maximum number of messages to return' },
            offset: { type: 'number', description: 'Number of messages to skip' }
          },
          required: ['topicId']
        }
      },
      {
        name: 'createGroupConversation',
        description: 'Create a new group conversation with multiple participants.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name for the group conversation' },
            participants: { type: 'array', description: 'Person ID hashes of participants' }
          },
          required: ['name', 'participants']
        }
      },
      {
        name: 'editMessage',
        description: 'Edit an existing message.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message to edit' },
            newContent: { type: 'string', description: 'The new message content' }
          },
          required: ['messageHash', 'newContent']
        }
      },
      {
        name: 'deleteMessage',
        description: 'Delete a message from a topic.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message to delete' },
            topicId: { type: 'string', description: 'The topic ID the message belongs to' }
          },
          required: ['messageHash', 'topicId']
        }
      },
      {
        name: 'createReaction',
        description: 'Add an emoji reaction to a message.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message to react to' },
            emoji: { type: 'string', description: 'The emoji to add as reaction' },
            topicId: { type: 'string', description: 'The topic ID the message belongs to' }
          },
          required: ['messageHash', 'emoji', 'topicId']
        }
      },
      {
        name: 'removeReaction',
        description: 'Remove an emoji reaction from a message.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message to remove reaction from' },
            emoji: { type: 'string', description: 'The emoji reaction to remove' },
            topicId: { type: 'string', description: 'The topic ID the message belongs to' }
          },
          required: ['messageHash', 'emoji', 'topicId']
        }
      },
      {
        name: 'getMessageDetails',
        description: 'Get detailed information about a specific message.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message' },
            topicId: { type: 'string', description: 'The topic ID the message belongs to' }
          },
          required: ['messageHash', 'topicId']
        }
      },
      {
        name: 'reactionsForMessage',
        description: 'Get all reactions for a specific message.',
        inputSchema: {
          type: 'object',
          properties: {
            messageHash: { type: 'string', description: 'Hash of the message to get reactions for' }
          },
          required: ['messageHash']
        }
      },
      {
        name: 'sendGroupMessage',
        description: 'Send a message to a group conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            topicId: { type: 'string', description: 'The topic ID to send the message to' },
            content: { type: 'string', description: 'The message content' },
            groupId: { type: 'string', description: 'The group ID for the conversation' }
          },
          required: ['topicId', 'content', 'groupId']
        }
      }
    ];
  }
}
