/**
 * ChatCubeIndexer - Indexes chat Stories in the Cube for efficient queries
 *
 * Listens for Story creation events from StoryFactory and creates
 * CubeObjects with dimension values for:
 * - when: Story.created timestamp
 * - who: Story.owner (author)
 * - topic: ChatMessage.topic
 * - plan: Story.plan
 * - replyTo: ChatMessage.replyTo (if present)
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import type { SHA256Hash, SHA256IdHash } from '@refinio/one.core/lib/util/type-checks.js';
import type { Person } from '@refinio/one.core/lib/recipes.js';
import type { ChatMessage } from '../recipes/ChatMessageRecipe.js';
import type { Topic } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
import { DIMENSION_NAMES } from '../dimensions/ChatDimensions.js';

// ============================================================================
// Forward declarations for types from refinio.api and cube.core
// ============================================================================

interface Story {
    $type$: 'Story';
    id: string;
    title: string;
    plan: SHA256IdHash<Plan>;
    product: SHA256Hash<any>;
    instanceVersion: string;
    created: number;
    duration?: number;
    owner?: SHA256IdHash<Person>;
}

interface Plan {
    $type$: 'Plan';
    id: string;
}

interface Dimension {
    $type$: 'Dimension';
    name: string;
    dataType: 'number' | 'hash' | 'string';
    standard: boolean;
    shared: boolean;
    packageName?: string;
}

interface DimensionValue {
    $type$: 'DimensionValue';
    dimensionHash: SHA256Hash<Dimension>;
    value: any;
    valueHash?: string;
    created: number;
}

interface CubeObject {
    $type$: 'CubeObject';
    oneObjectHash: SHA256Hash<Story>;
    dimensionValues: SHA256Hash<DimensionValue>[];
    created: number;
    creator?: SHA256IdHash<Person>;
}

// ============================================================================
// StoryFactory interface for event subscription
// ============================================================================

export interface StoryCreatedEvent {
    story: Story;
    storyHash: SHA256Hash<Story>;
    storyIdHash: SHA256IdHash<Story>;
}

export interface StoryFactoryEvents {
    onStoryCreated(handler: (event: StoryCreatedEvent) => Promise<void>): void;
    offStoryCreated(handler: (event: StoryCreatedEvent) => Promise<void>): void;
}

// ============================================================================
// Storage dependencies
// ============================================================================

export interface ChatCubeIndexerDeps {
    getObject: <T>(hash: SHA256Hash<T>) => Promise<T>;
    storeUnversionedObject: <T>(obj: T) => Promise<{ hash: SHA256Hash<T> }>;
    storeVersionedObject: <T>(obj: T) => Promise<{ hash: SHA256Hash<T>; idHash: SHA256IdHash<T> }>;
}

// ============================================================================
// Dimension Registry - provides dimension hashes
// ============================================================================

export interface DimensionRegistry {
    getDimensionHash(name: string): Promise<SHA256Hash<Dimension>>;
}

// ============================================================================
// ChatCubeIndexer Implementation
// ============================================================================

/**
 * ChatCubeIndexer - Indexes chat/topic Stories in the Cube
 *
 * Usage:
 * ```typescript
 * const indexer = new ChatCubeIndexer(storyFactory, deps, dimensionRegistry, owner);
 * await indexer.init();
 * // Now automatically indexes ChatPlan and TopicPlan stories
 *
 * await indexer.shutdown();
 * ```
 */
export class ChatCubeIndexer {
    private handler: ((event: StoryCreatedEvent) => Promise<void>) | undefined;

    constructor(
        private storyFactory: StoryFactoryEvents,
        private deps: ChatCubeIndexerDeps,
        private dimensionRegistry: DimensionRegistry,
        private creator?: SHA256IdHash<Person>
    ) {}

    /**
     * Start listening for Story creation events
     */
    async init(): Promise<void> {
        this.handler = this.handleStoryCreated.bind(this);
        this.storyFactory.onStoryCreated(this.handler);
    }

    /**
     * Stop listening for events
     */
    async shutdown(): Promise<void> {
        if (this.handler) {
            this.storyFactory.offStoryCreated(this.handler);
            this.handler = undefined;
        }
    }

    /**
     * Handle Story creation event
     */
    private async handleStoryCreated(event: StoryCreatedEvent): Promise<void> {
        const { story, storyHash } = event;

        // Filter for chat-related plans
        if (story.id.startsWith('ChatPlan.')) {
            await this.indexChatStory(story, storyHash);
        } else if (story.id.startsWith('TopicPlan.')) {
            await this.indexTopicStory(story, storyHash);
        }
    }

    // ========================================================================
    // Index Chat Story
    // ========================================================================

    /**
     * Index a chat message Story
     *
     * Creates DimensionValues for:
     * - when: timestamp from Story.created
     * - who: author from Story.owner
     * - topic: conversation from ChatMessage.topic
     * - plan: plan type from Story.plan
     * - replyTo: parent message from ChatMessage.replyTo (if present)
     */
    async indexChatStory(
        story: Story,
        storyHash: SHA256Hash<Story>
    ): Promise<SHA256Hash<CubeObject>> {
        // Load the ChatMessage to get topic/replyTo
        const message = await this.deps.getObject<ChatMessage>(story.product as SHA256Hash<ChatMessage>);

        // Create dimension values
        const dimensionValues: SHA256Hash<DimensionValue>[] = [];

        // when - timestamp
        const whenValue = await this.createDimensionValue(
            DIMENSION_NAMES.WHEN,
            story.created
        );
        dimensionValues.push(whenValue);

        // who - author
        if (story.owner) {
            const whoValue = await this.createDimensionValue(
                DIMENSION_NAMES.WHO,
                story.owner
            );
            dimensionValues.push(whoValue);
        }

        // topic - conversation
        const topicValue = await this.createDimensionValue(
            DIMENSION_NAMES.TOPIC,
            message.topic
        );
        dimensionValues.push(topicValue);

        // plan - operation type
        const planValue = await this.createDimensionValue(
            DIMENSION_NAMES.PLAN,
            story.plan
        );
        dimensionValues.push(planValue);

        // replyTo - parent message (optional)
        if (message.replyTo) {
            const replyToValue = await this.createDimensionValue(
                DIMENSION_NAMES.REPLY_TO,
                message.replyTo
            );
            dimensionValues.push(replyToValue);
        }

        // Create CubeObject
        const cubeObject: CubeObject = {
            $type$: 'CubeObject',
            oneObjectHash: storyHash,
            dimensionValues,
            created: Date.now(),
            creator: this.creator
        };

        const result = await this.deps.storeVersionedObject(cubeObject);
        return result.hash;
    }

    // ========================================================================
    // Index Topic Story
    // ========================================================================

    /**
     * Index a topic Story
     *
     * Creates DimensionValues for:
     * - when: timestamp from Story.created
     * - who: creator from Story.owner
     * - plan: plan type from Story.plan
     */
    async indexTopicStory(
        story: Story,
        storyHash: SHA256Hash<Story>
    ): Promise<SHA256Hash<CubeObject>> {
        // Create dimension values
        const dimensionValues: SHA256Hash<DimensionValue>[] = [];

        // when - timestamp
        const whenValue = await this.createDimensionValue(
            DIMENSION_NAMES.WHEN,
            story.created
        );
        dimensionValues.push(whenValue);

        // who - creator
        if (story.owner) {
            const whoValue = await this.createDimensionValue(
                DIMENSION_NAMES.WHO,
                story.owner
            );
            dimensionValues.push(whoValue);
        }

        // plan - operation type
        const planValue = await this.createDimensionValue(
            DIMENSION_NAMES.PLAN,
            story.plan
        );
        dimensionValues.push(planValue);

        // Create CubeObject
        const cubeObject: CubeObject = {
            $type$: 'CubeObject',
            oneObjectHash: storyHash,
            dimensionValues,
            created: Date.now(),
            creator: this.creator
        };

        const result = await this.deps.storeVersionedObject(cubeObject);
        return result.hash;
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Create and store a DimensionValue
     */
    private async createDimensionValue(
        dimensionName: string,
        value: any
    ): Promise<SHA256Hash<DimensionValue>> {
        const dimensionHash = await this.dimensionRegistry.getDimensionHash(dimensionName);

        const dimensionValue: DimensionValue = {
            $type$: 'DimensionValue',
            dimensionHash,
            value,
            created: Date.now()
        };

        const result = await this.deps.storeUnversionedObject(dimensionValue);
        return result.hash;
    }
}

// ============================================================================
// Manual Indexing Functions
// ============================================================================

/**
 * Manually index a chat Story (for backfill or testing)
 */
export async function indexChatStoryManual(
    story: Story,
    storyHash: SHA256Hash<Story>,
    message: ChatMessage,
    deps: ChatCubeIndexerDeps,
    dimensionRegistry: DimensionRegistry,
    creator?: SHA256IdHash<Person>
): Promise<SHA256Hash<CubeObject>> {
    const indexer = new ChatCubeIndexer(
        { onStoryCreated: () => {}, offStoryCreated: () => {} },
        deps,
        dimensionRegistry,
        creator
    );
    return indexer.indexChatStory(story, storyHash);
}

/**
 * Manually index a topic Story (for backfill or testing)
 */
export async function indexTopicStoryManual(
    story: Story,
    storyHash: SHA256Hash<Story>,
    deps: ChatCubeIndexerDeps,
    dimensionRegistry: DimensionRegistry,
    creator?: SHA256IdHash<Person>
): Promise<SHA256Hash<CubeObject>> {
    const indexer = new ChatCubeIndexer(
        { onStoryCreated: () => {}, offStoryCreated: () => {} },
        deps,
        dimensionRegistry,
        creator
    );
    return indexer.indexTopicStory(story, storyHash);
}
