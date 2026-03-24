# Channel System Documentation

## Overview

The channel system provides a mechanism for managing data streams and communication between different parts of the application. It is primarily implemented through the `ChannelManager` class which handles channel creation, data posting, and retrieval.

## Core Components

### ChannelManager

The `ChannelManager` class is the central component that manages all channel-related operations. It provides functionality for:

- Creating and managing channels
- Posting data to channels with synchronous cache updates
- Retrieving data from channels
- Managing channel settings
- Handling channel access control

### Channel Types

```typescript
type Channel = {
    id: string;
    owner?: SHA256IdHash<Person>;
};

type ChannelInfo = {
    id: string;
    owner?: SHA256IdHash<Person>;
    head?: SHA256Hash<LinkedListEntry>;  // Points to the latest entry in the channel
};
```

## Channel Identification Details

A channel's identity in the system is determined by multiple components working together:

1. **Basic Channel ID**: A simple string that serves as the human-readable identifier
2. **Channel Owner**: A `SHA256IdHash<Person>` that represents the owner of the channel
3. **Channel Info ID Hash**: A unique hash calculated from both the channel ID and owner:
   ```typescript
   const channelInfoIdHash = calculateIdHashOfObj({
       $type$: 'ChannelInfo',
       id: channelId,
       owner: owner
   });
   ```

This three-part identification system ensures:
- Human-readable channel identification through the string ID
- Proper ownership attribution through the owner hash
- Unique internal reference through the channel info ID hash
- Prevention of channel ID collisions between different owners

### Key Features

### Data Structures

```typescript
type ObjectData<T = unknown> = {
    channelId: string;
    channelOwner?: SHA256IdHash<Person>;
    channelEntryHash: SHA256Hash<LinkedListEntry>;
    id: string;
    creationTime: Date;
    creationTimeHash: SHA256Hash<CreationTime>;
    author?: SHA256IdHash<Person>;
    sharedWith: SHA256IdHash<Person>[];
    data: T;
    dataHash: SHA256Hash<T extends OneObjectTypes ? T : OneObjectTypes>;
};

type RawChannelEntry = {
    channelInfo: ChannelInfo;
    channelInfoIdHash: SHA256IdHash<ChannelInfo>;
    channelEntryHash: SHA256Hash<LinkedListEntry>;
    creationTimeHash: SHA256Hash<CreationTime>;
    creationTime: number;
    dataHash: SHA256Hash;
    metaDataHashes?: Array<SHA256Hash>;
    author?: SHA256IdHash<Person>;
};
```

## Key Features

### Channel Creation

```typescript
async createChannel(
    channelId: string,
    owner?: SHA256IdHash<Person> | null
): Promise<SHA256IdHash<ChannelInfo>>
```

Creates a new channel with the specified ID and optional owner. If no owner is specified, the default owner (main identity) is used.

### Data Posting

```typescript
async postToChannel<T extends OneObjectTypes>(
    channelId: string,
    data: T,
    channelOwner?: SHA256IdHash<Person> | null,
    timestamp?: number,
    author?: SHA256IdHash<Person>
): Promise<void>
```

Posts data to a specified channel with synchronous cache updates to prevent race conditions. The process:

1. Acquires a post lock to ensure sequential posting
2. Posts the data and gets the new version
3. Synchronously updates the cache with proper locking
4. Gets the latest entry directly from the channel head
5. Triggers the update event synchronously with the correct data structure

### Cache Management

The `ChannelManager` uses a sophisticated cache management system:

```typescript
private channelInfoCache: Map<SHA256IdHash<ChannelInfo>, ChannelInfo>;
```

Key features:
- Synchronous updates with the post operation
- Double locking mechanism (post lock and cache lock)
- Immediate cache consistency
- Event emission synchronized with cache updates

### Data Retrieval

Several methods are available for retrieving data:

```typescript
async getObjects(queryOptions?: QueryOptions): Promise<ObjectData<OneObjectTypes>[]>
async *objectIterator(queryOptions?: QueryOptions): AsyncIterableIterator<ObjectData<OneObjectTypes>>
```

### Channel Settings

The system supports various channel settings:

- `setChannelSettingsAppendSenderProfile`: Controls whether sender profiles are appended
- `setChannelSettingsRegisterSenderProfileAtLeute`: Manages profile registration
- `setChannelSettingsMaxSize`: Controls channel size limits

## Query Options

```typescript
type QueryOptions = ChannelSelectionOptions & DataSelectionOptions;

type ChannelSelectionOptions = {
    channelId?: string;
    channelIds?: string[];
    owner?: SHA256IdHash<Person> | null | 'mainId';
    owners?: (SHA256IdHash<Person> | null | 'mainId')[];
    channel?: Channel;
    channels?: Channel[];
};

type DataSelectionOptions = {
    orderBy?: Order;
    from?: Date;
    to?: Date;
    count?: number;
    type?: OneObjectTypeNames;
    types?: OneObjectTypeNames[];
    omitData?: boolean;
    omitSharedWith?: boolean;
};
```

## Race Condition Prevention

The system includes robust mechanisms to prevent race conditions:

1. **Synchronous Cache Updates**:
   ```typescript
   await serializeWithType(ChannelManager.postLockName, async () => {
       const newVersion = await this.internalChannelPost(/*...*/);
       await serializeWithType(
           `${ChannelManager.cacheLockName}${channelInfoIdHash}`,
           async () => {
               // Synchronous cache update
               this.channelInfoCache.set(channelInfoIdHash, newChannelInfo.obj);
           }
       );
   });
   ```

2. **Double Locking Mechanism**:
   - Post Lock: Ensures sequential posting operations
   - Cache Lock: Ensures atomic cache updates

3. **Event Synchronization**:
   - Events are emitted synchronously after cache updates
   - Events include complete and accurate channel entry data

4. **Cache Consistency**:
   - Cache is updated before any iterators can access it
   - Latest entry is retrieved directly from the channel head

### Example Usage

```typescript
// Create a channel
const channelId = await channelManager.createChannel("myChannel");

// Post data (with synchronous cache update)
await channelManager.postToChannel(channelId, {
    type: "message",
    content: "Hello World"
});

// Retrieve data (guaranteed to see latest updates)
const iterator = channelManager.objectIterator({
    channelId: "myChannel",
    orderBy: Order.Descending
});

for await (const item of iterator) {
    console.log(item.data);
}
```

## Best Practices

1. Always use proper error handling when working with channels
2. Consider using the iterator pattern for large datasets
3. Set appropriate channel settings based on your use case
4. Be mindful of cache consistency when performing rapid operations
5. Use proper typing with `OneObjectTypes` for type safety
6. Await all asynchronous operations to ensure proper synchronization

## Security Considerations

1. Channel access is controlled through owner and shared access lists
2. Author verification is supported through the system
3. Data integrity is maintained through hash verification
4. Proper encryption is used for sensitive data
5. Locks prevent concurrent modifications that could lead to data corruption

## Performance Considerations

1. Use appropriate query options to limit data retrieval
2. Consider using the `maxSize` setting for large channels
3. Be mindful of memory usage with large datasets
4. Use proper indexing for efficient queries
5. Consider the overhead of synchronous cache updates in high-throughput scenarios 