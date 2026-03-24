# ONE.core Integration Guide for connection.core

This guide explains how to integrate connection.core with ONE.core for invitations, chats, and group chats based on the proven test-object-filter.js pattern.

## Overview

connection.core provides a platform-agnostic connection management layer. The `OneCoreAdapter` interface allows platforms using ONE.core (lama.cube, lama.browser, lama iOS) to integrate invitation-based pairing, group chat, and attestation certificates.

## Architecture

```
┌──────────────────────────────────────┐
│   Platform (lama.cube/browser/iOS)   │
│                                      │
│  ┌────────────────────────────────┐ │
│  │  ConnectionManagerOneCore      │ │
│  │  (Extended ConnectionManager)  │ │
│  └────────────────────────────────┘ │
│             ↓ uses                   │
│  ┌────────────────────────────────┐ │
│  │    OneCoreAdapter Interface    │ │
│  └────────────────────────────────┘ │
│             ↓ implements             │
│  ┌────────────────────────────────┐ │
│  │  Platform-Specific Adapter     │ │
│  │  (wraps ONE.core models)       │ │
│  └────────────────────────────────┘ │
│             ↓ wraps                  │
│  ┌────────────────────────────────┐ │
│  │ LeuteModel, ChannelManager,    │ │
│  │ ConnectionsModel, TopicModel   │ │
│  └────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## Proven Pattern: test-object-filter.js

The integration is based on the working test-object-filter.js which demonstrates:

1. **Invitation-based Pairing** (lines 200-220, 245-272)
   - Create invitation via ConnectionsModel
   - Accept invitation triggers pairing callback
   - Callback creates shared 1:1 channel (null owner)

2. **Group with Certificates** (lines 262-358)
   - Create HashGroup (unversioned) with members
   - Create Group (versioned) with name
   - Create License + AffirmationCertificate + Signature
   - Grant access to members
   - Post certificates to 1:1 channels

3. **Object Filter** (lines 286-322)
   - Groups WITHOUT certificates are blocked
   - Groups WITH certificates pass through

4. **Group Chat** (lines 427-526)
   - Create Topic with groupId
   - Send/receive messages via TopicModel
   - Works peer-to-peer (even when creator offline)

## Integration Steps

### 1. Install connection.core

```bash
# In your platform package
npm install @lama/connection.core
```

### 2. Create Platform-Specific Adapter

Example for lama.cube:

```typescript
// lama.cube/src/connection/CubeOneCoreAdapter.ts
import { CubeOneCoreAdapter } from './CubeOneCoreAdapter.js';

// In your initialization code
const adapter = new CubeOneCoreAdapter(
  leuteModel,
  channelManager,
  connectionsModel,
  topicModel
);
```

### 3. Initialize ConnectionManager with Adapter

```typescript
import { ConnectionManagerOneCore } from '@lama/connection.core';
import { BrowserTransportFactory } from './BrowserTransportFactory.js';
import { BrowserIndexedDBStorage } from './BrowserStorage.js';
import { BrowserUICallbacks } from './BrowserUICallbacks.js';

// Create platform dependencies
const deps = {
  transport: new BrowserTransportFactory(),
  storage: new BrowserIndexedDBStorage(),
  ui: new BrowserUICallbacks()
};

// Create ConnectionManager
const connectionManager = new ConnectionManagerOneCore(deps);

// Set ONE.core adapter
connectionManager.setOneCoreAdapter(adapter);

// Initialize
await connectionManager.initialize();
```

### 4. Use ConnectionManager API

#### Invitation-based Pairing

```typescript
// Bob creates invitation
const invitation = await connectionManager.createInvitation();
// Share invitation string with Alice (QR code, URL, etc.)

// Alice accepts invitation
await connectionManager.acceptInvitation(invitation);

// Both get 'pairingComplete' event when shared 1:1 channel is created
connectionManager.on('pairingComplete', ({ remotePersonId, channelId }) => {
  console.log(`Paired with ${remotePersonId}, channel: ${channelId}`);
});
```

#### Create Group with Certificate

```typescript
// Alice creates group with Bob and Charlie
const group = await connectionManager.createGroupWithCertificate(
  'Weekend Plans',
  [aliceId, bobId, charlieId]
);

// Share with each member
await connectionManager.shareGroupWithMember(bobId, group);
await connectionManager.shareGroupWithMember(charlieId, group);

// Wait for CHUM to sync certificates to members
await new Promise(resolve => setTimeout(resolve, 10000));
```

#### Create Group Chat

```typescript
// Alice creates topic
const topicId = await connectionManager.createGroupChatTopic(
  'Weekend Discussion',
  [aliceId, bobId, charlieId],
  group.groupId
);

// Bob sends message
await connectionManager.sendMessage(topicId, 'Hello everyone!');

// Charlie reads messages
const messages = await connectionManager.getMessages(topicId);
console.log(messages); // [{author: bobId, content: 'Hello everyone!', timestamp: ...}]
```

## Platform-Specific Adapters

### lama.cube (Electron/Node.js)

File: `lama.cube/src/connection/CubeOneCoreAdapter.ts`

Uses:
- NodeOneCore models (LeuteModel, ChannelManager, etc.)
- File system storage
- Full ONE.core capabilities

### lama.browser (Browser)

File: `lama.browser/src/connection/BrowserOneCoreAdapter.ts`

Uses:
- Browser-loaded ONE.core models
- IndexedDB storage
- ONE.core in browser main thread

### lama (iOS)

File: `lama/src/connection/IOSOneCoreAdapter.swift`

Uses:
- Swift wrapper around ONE.core models
- Native iOS storage
- React Native bridge for JavaScript interop

## Key Principles

1. **No Fallbacks**: If operations fail, throw. Fix the problem, don't mitigate.
2. **Fail Fast**: Certificate creation/access must succeed or throw.
3. **Use What You Have**: Leverage existing ONE.core models, don't recreate.
4. **Pattern Proven**: Based on test-object-filter.js which passes all tests.

## Object Filter Behavior

The ONE.core object filter **automatically blocks** Groups without certificates:

- ✅ Groups WITH certificates: Pass through CHUM sync
- ❌ Groups WITHOUT certificates: Blocked at CHUM level (socket closed)

This is enforced at the protocol level - you cannot bypass it.

## Timing Considerations

### Certificate Distribution (test shows 15s wait)
```typescript
// Post certificates to 1:1 channels
await shareGroupWithMember(bobId, group);

// Wait for CHUM sync (test uses 15s)
await new Promise(resolve => setTimeout(resolve, 15000));

// Now Bob has certificates, Group will sync successfully
```

### Message Propagation (test shows 5s wait)
```typescript
await sendMessage(topicId, 'hello');

// Wait for CHUM sync
await new Promise(resolve => setTimeout(resolve, 5000));

// Now peer can read message
const messages = await getMessages(topicId);
```

**Note**: These are observed timings from test. Production may need adjustment based on network conditions.

## Error Handling

```typescript
try {
  const group = await connectionManager.createGroupWithCertificate(name, members);
} catch (error) {
  if (error instanceof GroupError) {
    console.error('Group creation failed:', error.message);
    // Fix the problem, don't mitigate
    throw error;
  }
}
```

## Testing

See `test-object-filter.js` for comprehensive integration test demonstrating:
- Pairing flow
- Group creation with certificates
- Object filter validation
- Group chat messaging
- Peer-to-peer sync (creator offline)

Run test:
```bash
node test-object-filter.js
```

## Dependencies

### connection.core
- Platform-agnostic connection management
- No ONE.core dependencies
- Transport/storage/UI via dependency injection

### ONE.core (via adapter)
- LeuteModel: Identity management
- ChannelManager: Channel creation/posting
- ConnectionsModel: Pairing/connections
- TopicModel: Chat topics/messages

## Further Reading

- `connection.core/src/adapters/OneCoreAdapter.ts` - Interface definition
- `connection.core/src/ConnectionManager.extended.ts` - Extended ConnectionManager
- `test-object-filter.js` - Working test demonstrating all flows
- `packages/one.models/` - ONE.core models documentation
