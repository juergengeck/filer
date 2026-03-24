# Channel Event System Debugging

This document describes the debugging enhancements implemented in the message bus system to help diagnose event propagation issues between `ChannelManager` and `TopicModel`.

## Overview of Changes

The following components have been enhanced with comprehensive debug logging:

1. **ChannelManager.processNewVersion**: Added detailed tracking of channel event processing
2. **OEvent Class**: Added capabilities to name events and track listener registration/emission
3. **TopicModel Initialization**: Added debug for channel event listener registration
4. **TopicModel.addTopicToRegistry**: Added tracking of event flow during topic registration
5. **ChannelManager.createChannel**: Added detailed debug messages for channel creation process
6. **TopicModel.createNewTopic**: Added extensive logging for the topic creation process and promise handling
7. **ObjectEventDispatcher**: Added logging for event registration, dispatch, and execution of handlers

## Enhanced Message Bus Integration

We've added detailed debug messages across the full event propagation path with distinctive log tags:

- `[CHANNEL_EVENT]` - Standard channel event logs
- `[CHANNEL_EVENT_DETAILED]` - Detailed step-by-step logs for channel operations
- `[TOPIC_EVENT]` - Standard topic model event logs
- `[TOPIC_EVENT_DETAILED]` - Detailed logs for topic operations
- `[EVENT_DEBUG]` - Debug messages for the OEvent system
- `[OBJECT_EVENTS]` - Standard logs for ObjectEventDispatcher operations
- `[OBJECT_EVENTS_DETAILED]` - Detailed logs for ChannelInfo object processing

## Debugging Details

### ChannelManager Debug Enhancements

The `ChannelManager.processNewVersion` method now includes detailed debug logging with the `[CHANNEL_EVENT]` prefix:

- **Start of Processing**: Logs when event processing begins with channel ID and version info
- **Cache Updates**: Logs when channel cache is updated
- **Head Comparison**: Logs details about comparing channel versions
- **Change Detection**: Logs when new entries are found
- **Event Emission**: Logs before and after emitting events, including listener count
- **Error Handling**: Detailed error logging with full context

### ChannelManager.createChannel Enhancements

The `createChannel` method now includes detailed logging:

- **Entry/Exit Points**: Logs at the start and end of the method
- **Parameter Validation**: Logs parameter values and validation
- **Storage Operations**: Logs each step of channel creation in storage
- **Cache Updates**: Logs cache operations for channel info
- **Error Details**: Enhanced error handling with detailed context

### OEvent Class Debug Capabilities

The `OEvent` class now includes:

- **Event Naming**: New methods to name events (`setEventName`) for easier identification in logs
- **Debug Toggling**: Method to enable/disable debugging per event (`enableDebug`)
- **Listener Tracking**: Logging when listeners are added or removed with current count
- **Emission Tracking**: Logging of event emissions with argument summary
- **Error Reporting**: Enhanced error logs for event handler failures

### TopicModel Debug Enhancements

The `TopicModel.init` method now includes:

- **Initialization Tracking**: Logs when initialization starts and completes
- **Event Listener Setup**: Logs before and after setting up channel event listeners
- **Diagnostic Listener**: Adds a dedicated listener to verify channel updates are received
- **Listener Count Verification**: Logs current listener count on `channelManager.onUpdated` event

### Topic Creation Debug Enhancements

The `createNewTopic` method now includes detailed logging:

- **Promise Creation**: Logs the setup of the `channelUpdatePromise`
- **Listener Registration**: Logs when the event listener is registered
- **Channel Creation**: Logs before and after calling `createChannel`
- **Promise Resolution**: Logs when the promise resolves with the channel info
- **Topic Storage**: Logs the storage of the topic object
- **Registry Updates**: Logs adding the topic to the registry
- **Access Rights**: Logs the application of access rights
- **Event Emission**: Logs the emission of the `onNewTopicEvent`

### ObjectEventDispatcher Debug Enhancements

Added extensive logging to the core event system:

- **Handler Registration**: Logs when handlers are registered for events
- **Event Processing**: Logs detailed information about ChannelInfo object processing
- **Handler Execution**: Logs the execution of handlers for ChannelInfo objects
- **Error Tracking**: Captures and logs errors in handler execution

## Using the Debug Output

When analyzing the logs, look for:

1. **Creation Process**: Follow channel creation from `createChannel` to `processNewVersion`
2. **Event Chain**: Follow the object event from storage through ObjectEventDispatcher to ChannelManager
3. **Promise Resolution**: Check if the `channelUpdatePromise` in `createNewTopic` is resolving properly
4. **Listener Registration**: Verify listeners are registered before events are emitted
5. **Handler Execution**: Confirm handlers are being called when ChannelInfo objects are processed

The enhanced logs will show the complete flow of events and identify exactly where the breakdown is occurring:

1. Is the channel being created successfully?
2. Is the object event reaching the ObjectEventDispatcher?
3. Is the ChannelManager's processNewVersion method being called?
4. Is the ChannelManager emitting the onUpdated event?
5. Are the TopicModel's listeners receiving the events?

## Implementation Notes

These debug enhancements maintain the existing application behavior while providing comprehensive visibility into the event system. The logs are designed to be easily filtered by prefix tags to focus on specific areas of interest. 