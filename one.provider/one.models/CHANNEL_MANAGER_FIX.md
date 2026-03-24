# ChannelManager Race Condition Fix

## Issue Description

There is a race condition in the `ChannelManager` where the object event dispatcher updates the cache only after the async object post operation completes. This means that if there's an immediate subsequent call to a `ChannelManager` iterator, it may load an old version of the `ChannelInfo` without the needed information.

The current workaround involves placing a sync mechanic in the `ChannelManager` that waits for an object to show up in the cache (for one second max) if you try to access a Channel that has a processing object. The object hash is kept for 5 seconds max before a timeout clears it.

## Root Cause

The race condition occurs because:

1. `postToChannel` stores the object using `storeVersionedObject`
2. The `ObjectEventDispatcher` receives this event and queues it for processing
3. The cache update in `ChannelManager.processNewVersion` happens asynchronously after the queue is processed
4. If code immediately tries to access the channel data through an iterator, it may get stale cache data

## Solution

The fix addresses the root cause by:

1. Making cache updates synchronous with the post operation
2. Using proper locking mechanisms for cache consistency
3. Ensuring the cache is updated before any iterators can access it

### Key Changes

1. **Immediate Cache Update**: The cache is updated synchronously after the post operation, before any iterators can access it
2. **Proper Locking**: Using `serializeWithType` with both the post lock and cache lock ensures no concurrent modifications
3. **Type Safety**: Fixed type issues by properly handling the `RawChannelEntry` type
4. **Consistent Events**: The update event is triggered synchronously with the correct data structure

### Implementation Details

The fix modifies the `postToChannel` method to:

1. Post data and get the new version
2. Synchronously update the cache with the new version using proper locking
3. Get the latest entry directly from the channel
4. Trigger the update event with the correct data structure

This eliminates the need for timeouts or retries since it ensures the cache is always consistent with the stored data.

## Patch

The patch modifies the `postToChannel` method in `src/models/ChannelManager.ts`. See the attached patch file for the complete changes.

## Testing

The fix should be tested with:

1. Rapid sequential posts to the same channel
2. Immediate iterator access after posting
3. Concurrent access from multiple clients
4. Edge cases around cache updates and event handling

## Migration

This is a non-breaking change that fixes a race condition. No migration steps are needed for existing code. 