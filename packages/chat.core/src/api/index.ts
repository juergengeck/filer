/**
 * API exports for chat.core
 */

// Chat API
export {
    ChatApi,
    createChatApi,
    type StoryFactory,
    type PlanDefinition,
    type ExecutionMetadata,
    type OperationResult,
    type ExecutionResult,
    type ChatApiDeps,
    type DimensionRegistry,
    type SendMessageRequest,
    type SendMessageResponse,
    type EditMessageRequest,
    type EditMessageResponse,
    type DeleteMessageRequest,
    type DeleteMessageResponse,
    type AddReactionRequest,
    type AddReactionResponse,
    type RemoveReactionRequest,
    type RemoveReactionResponse,
    type CreateTopicRequest,
    type CreateTopicResponse,
    type RenameTopicRequest,
    type RenameTopicResponse,
    type AddParticipantRequest,
    type AddParticipantResponse,
    type RemoveParticipantRequest,
    type RemoveParticipantResponse
} from './ChatApi.js';

// Events
export {
    ChatEventEmitter,
    type ChatEventBase,
    type MessageCreatedEvent,
    type MessageEditedEvent,
    type MessageDeletedEvent,
    type ReactionAddedEvent,
    type ReactionRemovedEvent,
    type TopicCreatedEvent,
    type TopicRenamedEvent,
    type ParticipantAddedEvent,
    type ParticipantRemovedEvent,
    type ChatEvent,
    type ChatEventType,
    type ChatEventHandler,
    type MessageCreatedHandler,
    type MessageEditedHandler,
    type MessageDeletedHandler,
    type ReactionAddedHandler,
    type ReactionRemovedHandler,
    type TopicCreatedHandler,
    type TopicRenamedHandler,
    type ParticipantAddedHandler,
    type ParticipantRemovedHandler
} from './ChatEvents.js';
