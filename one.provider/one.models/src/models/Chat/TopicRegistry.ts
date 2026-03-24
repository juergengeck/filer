import type {UnversionedObjectResult} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import {getObject} from '@refinio/one.core/lib/storage-unversioned-objects.js';
import type {VersionedObjectResult} from '@refinio/one.core/lib/storage-versioned-objects.js';
import {
    getIdObject,
    getObjectByIdObj,
    storeVersionedObject
} from '@refinio/one.core/lib/storage-versioned-objects.js';
import type {SHA256Hash} from '@refinio/one.core/lib/util/type-checks.js';
import type {Topic, TopicAppRegistry} from '../../recipes/ChatRecipes.js';

/**
 * Registry that holds references to all the created topics.
 *
 * Singleton design pattern. To get the instance use @see this.load()
 * Note: This singleton way is bad, because it is bound to happen, that someone just calls the
 * constructor which will not create the registry if it does not exist, which will lead to errors.
 */
export default class TopicRegistry {
    private static readonly id = 'TopicAppRegistry';

    private static instance: TopicRegistry;

    /**
     * Load and initialize the registry.
     *
     * Use this function to get an instance instead of using the constructor!
     */
    public static async load(): Promise<TopicRegistry> {
        if (!TopicRegistry.instance) {
            TopicRegistry.instance = new TopicRegistry();
        }
        await TopicRegistry.createTopicRegistryIfNotExist();
        return TopicRegistry.instance;
    }

    /**
     * Removes the topic from the TopicRegistry by the given topicID.
     * @param topicID
     */
    public async remove(topicID: string): Promise<void> {
        const registry = await getObjectByIdObj({$type$: 'TopicAppRegistry', id: TopicRegistry.id});
        registry.obj.topics.delete(topicID);
        await TopicRegistry.updateTopicRegistry(registry.obj.topics);
    }

    /**
     * Registers the given topic into the TopicRegistry.
     * @param topic
     */
    public async add(topic: UnversionedObjectResult<Topic>): Promise<Topic> {
        const registry = await getObjectByIdObj({$type$: 'TopicAppRegistry', id: TopicRegistry.id});

        const channel = await getIdObject(topic.obj.channel);
        registry.obj.topics.set(channel.id, topic.hash);
        await TopicRegistry.updateTopicRegistry(registry.obj.topics);
        return topic.obj;
    }

    /**
     * Retrieve all the topics in the TopicRegistry.
     */
    public async all(): Promise<Topic[]> {
        const registry = await getObjectByIdObj({$type$: 'TopicAppRegistry', id: TopicRegistry.id});
        const topicsHashes = Array.from(registry.obj.topics.values());
        return await Promise.all(
            topicsHashes.map(async topicHash => {
                return await getObject(topicHash);
            })
        );
    }

    /**
     * Retrieve topics by the given name.
     * @param name
     */
    public async queryByName(name: string): Promise<Topic[]> {
        const topics = await this.all();
        return topics.filter(topic => topic.name !== undefined && topic.name === name);
    }

    /**
     * Retrieve topic by the channel id.
     * @param channelID
     */
    public async queryById(channelID: string): Promise<Topic | undefined> {
        const registry = await getObjectByIdObj({$type$: 'TopicAppRegistry', id: TopicRegistry.id});
        const foundTopic = registry.obj.topics.get(channelID);

        if (foundTopic === undefined) {
            return undefined;
        }

        return await getObject(foundTopic);
    }

    /**
     * Retrieve topic hash by the channel id.
     * @param channelID
     */
    public async queryHashById(channelID: string): Promise<SHA256Hash<Topic> | undefined> {
        const registry = await getObjectByIdObj({$type$: 'TopicAppRegistry', id: TopicRegistry.id});
        const foundTopic = registry.obj.topics.get(channelID);

        if (foundTopic === undefined) {
            return undefined;
        }

        return foundTopic;
    }

    // --------------------------------- private ---------------------------------

    /**
     * Creates the topic registry if not exist, otherwise returns the existing one.
     * @private
     */
    private static async createTopicRegistryIfNotExist(): Promise<
        VersionedObjectResult<TopicAppRegistry>
    > {
        try {
            return await getObjectByIdObj({$type$: 'TopicAppRegistry', id: this.id});
        } catch (e) {
            if (e.name === 'FileNotFoundError') {
                return await storeVersionedObject({
                    $type$: 'TopicAppRegistry',
                    id: TopicRegistry.id,
                    topics: new Map()
                });
            }

            throw e;
        }
    }

    /**
     * Updates the topic registry by the given topics.
     * @param topics
     * @private
     */
    private static async updateTopicRegistry(topics: TopicAppRegistry['topics']): Promise<void> {
        await storeVersionedObject({
            $type$: 'TopicAppRegistry',
            id: TopicRegistry.id,
            topics: topics
        });
    }
}
