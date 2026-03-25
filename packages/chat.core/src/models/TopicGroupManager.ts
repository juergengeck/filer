/**
 * TopicGroupManager - DEPRECATED STUB
 *
 * This class has been deprecated. Its functionality has been moved to:
 * - ChatPlan.createGroupConversation() for creating group chats
 * - GroupPlan for topic management operations
 *
 * This stub provides backward compatibility during migration.
 * TODO: Update consumers to use ChatPlan and GroupPlan instead.
 */

import type { SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, Group, HashGroup } from '@refinio/one.core/lib/recipes.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import type ChannelManager from '@refinio/one.models/lib/models/ChannelManager.js';
import type TopicModel from '@refinio/one.models/lib/models/Chat/TopicModel.js';
import type LeuteModel from '@refinio/one.models/lib/models/Leute/LeuteModel.js';

export interface OneCoreInstance {
    ownerId: SHA256IdHash<Person>;
    channelManager: ChannelManager;
    topicModel: TopicModel;
    leuteModel: LeuteModel;
    aiAssistantModel?: any;
    paranoiaLevel?: number;
}

export interface TopicGroupManagerStorageDeps {
    storeVersionedObject: (obj: any) => Promise<any>;
    storeUnversionedObject: (obj: any) => Promise<any>;
    getObjectByIdHash: (hash: any) => Promise<any>;
    getObject: (hash: any) => Promise<any>;
    createAccess?: (params: any) => Promise<any>;
    calculateIdHashOfObj?: (obj: any) => Promise<any>;
    calculateHashOfObj?: (obj: any) => Promise<any>;
}

/**
 * @deprecated Use ChatPlan.createGroupConversation() and GroupPlan instead.
 */
export class TopicGroupManager {
    private oneCore: OneCoreInstance;
    private storageDeps: TopicGroupManagerStorageDeps;
    private trustPlan?: any;

    constructor(
        oneCore: OneCoreInstance,
        storageDeps: TopicGroupManagerStorageDeps,
        trustPlan?: any
    ) {
        this.oneCore = oneCore;
        this.storageDeps = storageDeps;
        this.trustPlan = trustPlan;
        console.warn('[TopicGroupManager] DEPRECATED: This class is deprecated. Use ChatPlan.createGroupConversation() and GroupPlan instead.');
    }

    /**
     * Get cached group for topic
     * @deprecated
     */
    getCachedGroupForTopic(_topicId: string): SHA256IdHash<Group> | undefined {
        console.warn('[TopicGroupManager] getCachedGroupForTopic is deprecated');
        return undefined;
    }

    /**
     * Check if conversation has group
     * @deprecated
     */
    hasConversationGroup(_conversationId: string): boolean {
        console.warn('[TopicGroupManager] hasConversationGroup is deprecated');
        return false;
    }

    /**
     * Get or create conversation group
     * @deprecated Use ChatPlan.createGroupConversation() instead
     */
    async getOrCreateConversationGroup(
        _topicIdHash: SHA256IdHash<Topic>,
        _aiPersonId?: SHA256IdHash<Person>
    ): Promise<SHA256IdHash<Group> | undefined> {
        console.warn('[TopicGroupManager] getOrCreateConversationGroup is deprecated. Use ChatPlan.createGroupConversation()');
        return undefined;
    }

    /**
     * Create group topic
     * @deprecated Use ChatPlan.createGroupConversation() instead
     */
    async createGroupTopic(
        _topicName: string,
        _topicId: string,
        _participants?: SHA256IdHash<Person>[]
    ): Promise<any> {
        console.warn('[TopicGroupManager] createGroupTopic is deprecated. Use ChatPlan.createGroupConversation()');
        return null;
    }

    /**
     * Create P2P topic
     * @deprecated Use ChatPlan or P2PTopicService instead
     */
    async createP2PTopic(
        _topicName: string,
        _topicId: string,
        _participants: SHA256IdHash<Person>[]
    ): Promise<any> {
        console.warn('[TopicGroupManager] createP2PTopic is deprecated');
        return null;
    }

    /**
     * Ensure P2P channels for peer
     * @deprecated
     */
    async ensureP2PChannelsForPeer(_peerPersonId: SHA256IdHash<Person>): Promise<any> {
        console.warn('[TopicGroupManager] ensureP2PChannelsForPeer is deprecated');
        return null;
    }

    /**
     * Initialize topic sync listener
     * @deprecated
     */
    initializeTopicSyncListener(_topicModel?: TopicModel): void {
        console.warn('[TopicGroupManager] initializeTopicSyncListener is deprecated - sync is handled automatically');
    }

    /**
     * Initialize group sync listener
     * @deprecated
     */
    initializeGroupSyncListener(): void {
        console.warn('[TopicGroupManager] initializeGroupSyncListener is deprecated - sync is handled automatically');
    }

    /**
     * Create object filter for ConnectionsModel
     * Returns a permissive filter (allows all) since this is deprecated
     */
    createObjectFilter(): (obj: any) => Promise<boolean> {
        return async () => true;
    }

    /**
     * Create import filter for ConnectionsModel
     * Returns a permissive filter (allows all) since this is deprecated
     */
    createImportFilter(): (obj: any) => Promise<boolean> {
        return async () => true;
    }
}

export default TopicGroupManager;
