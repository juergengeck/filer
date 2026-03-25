/**
 * StoryTopicPlan - Topic operations using Story + Cube architecture
 *
 * This plan creates and manages Topics wrapped with StoryFactory for:
 * - Full provenance tracking (who created/modified, when)
 * - Cube indexing for efficient queries
 * - Edit history via Story versioning
 *
 * Topics are conversation containers with:
 * - Stable UUID identity (allows renaming)
 * - Display name (mutable)
 * - Participants via HashGroup (for access control)
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person, HashGroup } from '@refinio/one.core/lib/recipes.js';
import type { VersionedObjectResult } from '@refinio/one.core/lib/storage-versioned-objects.js';
import { operationRegistry } from '@refinio/api/registry';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';

/**
 * StoryFactory interface from refinio.api
 * Wraps operations to create Story objects for audit trail
 */
export interface StoryFactory {
    wrapExecution<T>(
        metadata: ExecutionMetadata,
        operation: () => Promise<OperationResult<T>>
    ): Promise<ExecutionResult<T>>;
}

export interface PlanDefinition {
    id: string;
    name: string;
    description?: string;
    domain?: string;
    demandPatterns?: any[];
    supplyPatterns?: any[];
}

export interface ExecutionMetadata {
    title: string;
    planId: SHA256IdHash<Plan>;
    planTypeName: string;
    owner: SHA256IdHash<Person>;
    instanceVersion: string;
}

export interface OperationResult<T> {
    result: T;
    productHash: SHA256Hash<any>;
}

export interface ExecutionResult<T> {
    result: T;
    storyId?: SHA256IdHash<Story>;
    assemblyId?: SHA256IdHash<Assembly>;
}

// Types from assembly.core (canonical definitions)
import type { Plan, Story, Assembly } from '@refinio/assembly.core';

/**
 * Storage dependencies injected from platform
 */
export interface StoryTopicPlanDeps {
    storeVersionedObject: <T>(obj: T) => Promise<VersionedObjectResult<T>>;
    storeUnversionedObject: <T>(obj: T) => Promise<{ hash: SHA256Hash<T> }>;
    getObjectByIdHash: <T>(idHash: SHA256IdHash<T>) => Promise<{ obj: T }>;
    getObject: <T>(hash: SHA256Hash<T>) => Promise<T>;
    calculateIdHashOfObj: <T>(obj: T) => Promise<SHA256IdHash<T>>;
}

/**
 * Topic Plan definition for StoryFactory registration
 */
export const TOPIC_PLAN: PlanDefinition = {
    id: 'TopicPlan',
    name: 'Topic Plan',
    description: 'Creates and manages conversation topics using Story + Cube architecture',
    domain: 'chat',
    supplyPatterns: [
        { type: 'Topic', description: 'Conversation topics' }
    ]
};

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CreateTopicRequest {
    name: string;
    participants: SHA256IdHash<Person>[];
}

export interface CreateTopicResponse {
    topicHash: SHA256Hash<Topic>;
    topicIdHash: SHA256IdHash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface RenameTopicRequest {
    topicIdHash: SHA256IdHash<Topic>;
    newName: string;
}

export interface RenameTopicResponse {
    topicHash: SHA256Hash<Topic>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface AddParticipantRequest {
    topicIdHash: SHA256IdHash<Topic>;
    participant: SHA256IdHash<Person>;
}

export interface AddParticipantResponse {
    topicHash: SHA256Hash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface RemoveParticipantRequest {
    topicIdHash: SHA256IdHash<Topic>;
    participant: SHA256IdHash<Person>;
}

export interface RemoveParticipantResponse {
    topicHash: SHA256Hash<Topic>;
    participantsHash: SHA256Hash<HashGroup<Person>>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface GetParticipantsRequest {
    topicIdHash: SHA256IdHash<Topic>;
}

export interface GetParticipantsResponse {
    participants: SHA256IdHash<Person>[];
}

// ============================================================================
// StoryTopicPlan Implementation
// ============================================================================

/**
 * StoryTopicPlan - Topic operations with Story tracking
 *
 * Usage:
 * ```typescript
 * const topicPlan = new StoryTopicPlan(storyFactory, deps, ownerIdHash, '1.0.0');
 * await topicPlan.init();
 *
 * const result = await topicPlan.createTopic({
 *     name: 'Project Discussion',
 *     participants: [person1IdHash, person2IdHash]
 * });
 * ```
 */
export class StoryTopicPlan {
    private planIdHash: SHA256IdHash<Plan> | undefined;

    constructor(
        private storyFactory: StoryFactory,
        private deps: StoryTopicPlanDeps,
        private owner: SHA256IdHash<Person>,
        private instanceVersion: string = '1.0.0'
    ) {}

    /**
     * Initialize the plan - must be called before other methods
     */
    async init(): Promise<void> {
        this.planIdHash = await operationRegistry.resolvePlanId(TOPIC_PLAN);
    }

    /**
     * Generate a UUID for topic identity
     */
    private generateId(): string {
        return crypto.randomUUID();
    }

    /**
     * Ensure plan is initialized
     */
    private ensureInitialized(): void {
        if (!this.planIdHash) {
            throw new Error('StoryTopicPlan not initialized. Call init() first.');
        }
    }

    // ========================================================================
    // Create Topic
    // ========================================================================

    /**
     * Create a new conversation topic
     *
     * Creates a Topic with HashGroup for participants, wrapped with StoryFactory.
     * The owner is automatically added to participants if not already included.
     */
    async createTopic(request: CreateTopicRequest): Promise<CreateTopicResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Create topic: ${request.name}`,
                planId: this.planIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Ensure owner is in participants
                const allParticipants = new Set(request.participants);
                allParticipants.add(this.owner);

                // Create HashGroup for participants
                const hashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: allParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(hashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                // Grant access to the HashGroup object itself so it can sync via CHUM
                const {createAccess} = await import('@refinio/one.core/lib/access.js');
                const {SET_ACCESS_MODE} = await import('@refinio/one.core/lib/storage-base-common.js');
                await createAccess([{
                    object: participantsHash,
                    person: [],
                    hashGroup: [participantsHash],
                    mode: SET_ACCESS_MODE.ADD
                }]);

                // Create Topic
                // NOTE: Story+Cube architecture creates Topics without channels.
                // The one.models Topic requires a channel for full functionality.
                // This simplified Topic works for Story+Cube but may need channel
                // integration for full one.models compatibility.
                const topic = {
                    $type$: 'Topic',
                    participants: participantsHash,
                    originalName: request.name,
                    displayName: request.name
                } as Topic;

                const stored = await this.deps.storeVersionedObject(topic);

                return {
                    result: {
                        topicHash: stored.hash,
                        topicIdHash: stored.idHash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        return {
            topicHash: result.result.topicHash,
            topicIdHash: result.result.topicIdHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Rename Topic
    // ========================================================================

    /**
     * Rename an existing topic
     *
     * Creates a new version with updated name.
     * The Story chain tracks rename history.
     */
    async renameTopic(request: RenameTopicRequest): Promise<RenameTopicResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Rename topic to: ${request.newName}`,
                planId: this.planIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current topic
                const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);

                // Create new version with updated displayName
                // NOTE: originalName is part of identity and should not change
                const updated: Topic = {
                    ...current.obj,
                    displayName: request.newName
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: { topicHash: stored.hash },
                    productHash: stored.hash
                };
            }
        );

        return {
            topicHash: result.result.topicHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Add Participant
    // ========================================================================

    /**
     * Add a participant to a topic
     *
     * Creates a new HashGroup with the additional participant,
     * then creates a new Topic version referencing it.
     */
    async addParticipant(request: AddParticipantRequest): Promise<AddParticipantResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Add participant to topic`,
                planId: this.planIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current topic
                const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);

                // Load current HashGroup
                const currentHashGroup = await this.deps.getObject<HashGroup<Person>>(
                    current.obj.participants
                );

                // Create new HashGroup with added participant
                const newParticipants = new Set(currentHashGroup.person);
                newParticipants.add(request.participant);

                const newHashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: newParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(newHashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                // Create new Topic version with updated participants
                const updated: Topic = {
                    ...current.obj,
                    participants: participantsHash
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: {
                        topicHash: stored.hash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        return {
            topicHash: result.result.topicHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Remove Participant
    // ========================================================================

    /**
     * Remove a participant from a topic
     *
     * Creates a new HashGroup without the participant,
     * then creates a new Topic version referencing it.
     *
     * Note: Cannot remove the last participant or the owner.
     */
    async removeParticipant(request: RemoveParticipantRequest): Promise<RemoveParticipantResponse> {
        this.ensureInitialized();

        const result = await this.storyFactory.wrapExecution(
            {
                title: `Remove participant from topic`,
                planId: this.planIdHash!,
                planTypeName: 'TopicPlan',
                owner: this.owner,
                instanceVersion: this.instanceVersion
            },
            async () => {
                // Load current topic
                const current = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);

                // Load current HashGroup
                const currentHashGroup = await this.deps.getObject<HashGroup<Person>>(
                    current.obj.participants
                );

                // Validate removal
                if (String(request.participant) === String(this.owner)) {
                    throw new Error('Cannot remove topic owner from participants');
                }

                const newParticipants = new Set(currentHashGroup.person);
                if (!newParticipants.has(request.participant)) {
                    throw new Error('Participant not in topic');
                }

                newParticipants.delete(request.participant);

                if (newParticipants.size === 0) {
                    throw new Error('Cannot remove last participant from topic');
                }

                // Create new HashGroup without the participant
                const newHashGroup: HashGroup<Person> = {
                    $type$: 'HashGroup',
                    person: newParticipants
                };
                const hashGroupResult = await this.deps.storeUnversionedObject(newHashGroup);
                const participantsHash = hashGroupResult.hash as SHA256Hash<HashGroup<Person>>;

                // Create new Topic version with updated participants
                const updated: Topic = {
                    ...current.obj,
                    participants: participantsHash
                };

                const stored = await this.deps.storeVersionedObject(updated);

                return {
                    result: {
                        topicHash: stored.hash,
                        participantsHash
                    },
                    productHash: stored.hash
                };
            }
        );

        return {
            topicHash: result.result.topicHash,
            participantsHash: result.result.participantsHash,
            storyIdHash: result.storyId!
        };
    }

    // ========================================================================
    // Query Helpers
    // ========================================================================

    /**
     * Get participants for a topic
     *
     * Note: This is a read-only query, not wrapped with StoryFactory
     */
    async getParticipants(request: GetParticipantsRequest): Promise<GetParticipantsResponse> {
        const topic = await this.deps.getObjectByIdHash<Topic>(request.topicIdHash);
        const hashGroup = await this.deps.getObject<HashGroup<Person>>(topic.obj.participants);

        return {
            participants: Array.from(hashGroup.person)
        };
    }
}
