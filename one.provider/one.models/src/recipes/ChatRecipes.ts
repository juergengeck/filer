import type {VersionNode} from '@refinio/one.core/lib/recipes.js';
import type {Person, Recipe} from '@refinio/one.core/lib/recipes.js';
import type {SHA256Hash, SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';
import type {ChannelInfo} from './ChannelRecipes.js';

declare module '@OneObjectInterfaces' {
    export interface OneUnversionedObjectInterfaces {
        ChatMessage: ChatMessage;
        ChatRequest: ChatRequest;
        Topic: Topic;
    }

    export interface OneIdObjectInterfaces {
        TopicAppRegistry: Pick<TopicAppRegistry, 'id' | '$type$'>;
    }

    export interface OneVersionedObjectInterfaces {
        TopicAppRegistry: TopicAppRegistry;
    }
}

export interface Topic {
    $type$: 'Topic';
    // one-to-one relationship between the id and the channelID
    id: string;
    channel: SHA256IdHash<ChannelInfo>;
    name?: string;
}

export interface ChatMessage {
    $type$: 'ChatMessage';
    text: string;
    attachments?: SHA256Hash[];
    sender: SHA256IdHash<Person>;
    thumbnails?: SHA256Hash[];
}

export interface ChatRequest {
    $type$: 'ChatRequest';
    for: string;
}

type TopicChannelID = string;

export interface TopicAppRegistry {
    $type$: 'TopicAppRegistry';
    $versionHash$?: SHA256Hash<VersionNode>;
    id: 'TopicAppRegistry';
    topics: Map<TopicChannelID, SHA256Hash<Topic>>;
}

export const ChatRequestRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ChatRequest',
    rule: [
        {
            itemprop: 'for',
            itemtype: {type: 'string'}
        }
    ]
};

export const ChatMessageRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'ChatMessage',
    rule: [
        {
            itemprop: 'text',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'attachments',
            itemtype: {
                type: 'array',
                item: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            optional: true
        },
        {
            itemprop: 'sender',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['Person'])}
        },
        {
            itemprop: 'thumbnails',
            itemtype: {
                type: 'array',
                item: {
                    type: 'referenceToObj',
                    allowedTypes: new Set(['*'])
                }
            },
            optional: true
        }
    ]
};

export const TopicRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'Topic',
    rule: [
        {
            itemprop: 'name',
            itemtype: {type: 'string'},
            optional: true
        },
        {
            itemprop: 'id',
            itemtype: {type: 'string'}
        },
        {
            itemprop: 'channel',
            itemtype: {type: 'referenceToId', allowedTypes: new Set(['ChannelInfo'])}
        }
    ]
};

export const TopicAppRegistryRecipe: Recipe = {
    $type$: 'Recipe',
    name: 'TopicAppRegistry',
    rule: [
        {
            itemprop: 'id',
            isId: true,
            itemtype: {type: 'string', regexp: /^TopicAppRegistry$/}
        },
        {
            itemprop: 'topics',
            itemtype: {
                type: 'map',
                key: {type: 'string'},
                value: {type: 'referenceToObj', allowedTypes: new Set(['Topic'])}
            }
        }
    ]
};

const ChatRecipes: Recipe[] = [
    ChatMessageRecipe,
    ChatRequestRecipe,
    TopicRecipe,
    TopicAppRegistryRecipe
];

export default ChatRecipes;
