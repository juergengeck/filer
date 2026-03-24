# Channel Event System Diagnostics and Testing

This document outlines various diagnostic approaches and tests to troubleshoot the event propagation issue between ChannelManager and TopicModel.

## Problem Description

The channel event system is not propagating events as expected. Specifically:
- The ChannelManager is processing new versions and performing operations
- The `onUpdated` event is being emitted
- But TopicModel's listeners aren't receiving these events

## Testing Approach

We'll use a multi-layered approach to identify exactly where the event chain is breaking down.

### 1. Direct Event Testing

Test if the ChannelManager's event system works at all:

```typescript
function testDirectEvent(channelManager: ChannelManager) {
  let eventReceived = false;
  console.log('[DIAGNOSTICS] Setting up direct event test');
  
  const disconnect = channelManager.onUpdated((infoHash, id, owner, time, data) => {
    console.log('[DIAGNOSTICS] ✓ Direct event received:', { id });
    eventReceived = true;
  });
  
  // Create test channel
  const testChannelId = `diagnostic-test-${Date.now()}`;
  console.log('[DIAGNOSTICS] Creating test channel:', testChannelId);
  
  channelManager.createChannel(testChannelId)
    .then(() => {
      console.log('[DIAGNOSTICS] Test channel created');
      
      // Check after delay
      setTimeout(() => {
        console.log('[DIAGNOSTICS] Direct event received status:', eventReceived);
        disconnect();
      }, 2000);
    })
    .catch(err => {
      console.error('[DIAGNOSTICS] Error creating test channel:', err);
      disconnect();
    });
}
```

### 2. Listener Registration Check

Verify if listeners are properly registered with the event:

```typescript
function checkListenerRegistration(channelManager: ChannelManager) {
  // Add a temporary property to check listeners
  const listeners = (channelManager.onUpdated as any)._listeners || 
                   (channelManager.onUpdated as any).listeners;
  
  console.log('[DIAGNOSTICS] Checking onUpdated event listeners:');
  console.log('[DIAGNOSTICS] Has listeners property:', !!listeners);
  
  if (listeners) {
    if (listeners instanceof Map) {
      console.log('[DIAGNOSTICS] Listener count:', listeners.size);
    } else if (listeners instanceof Set) {
      console.log('[DIAGNOSTICS] Listener count:', listeners.size);
    } else if (Array.isArray(listeners)) {
      console.log('[DIAGNOSTICS] Listener count:', listeners.length);
    } else {
      console.log('[DIAGNOSTICS] Listeners type:', typeof listeners);
    }
  }
}
```

### 3. Event Chain Instrumentation

Instrument the OEvent class to log all emissions:

```typescript
class InstrumentedOEvent<T extends (...args: any[]) => void> extends OEvent<T> {
  emit(...args: Parameters<T>): void {
    console.log('[EVENT] Emitting event with args:', args);
    super.emit(...args);
  }
}

// Create a temporary replacement for testing
function instrumentChannelManagerEvents(channelManager: ChannelManager) {
  const originalEvent = channelManager.onUpdated;
  const instrumentedEvent = new InstrumentedOEvent<
    (
      channelInfoIdHash: SHA256IdHash<ChannelInfo>,
      channelId: string,
      channelOwner: SHA256IdHash<Person> | null,
      timeOfEarliestChange: Date,
      data: Array<RawChannelEntry & {isNew: boolean}>
    ) => void
  >();
  
  // Transfer all existing listeners
  const listeners = (originalEvent as any)._listeners || 
                    (originalEvent as any).listeners;
  
  if (listeners) {
    if (listeners instanceof Map) {
      listeners.forEach((listener, key) => {
        instrumentedEvent(listener);
      });
    } else if (listeners instanceof Set) {
      listeners.forEach(listener => {
        instrumentedEvent(listener);
      });
    } else if (Array.isArray(listeners)) {
      listeners.forEach(listener => {
        instrumentedEvent(listener);
      });
    }
  }
  
  // Replace the event
  channelManager.onUpdated = instrumentedEvent;
  
  return () => {
    // Function to restore original event
    channelManager.onUpdated = originalEvent;
  };
}
```

### 4. Process Tracing in ChannelManager

Add tracing inside the `processNewVersion` method:

```typescript
// Temporary code to add to ChannelManager.ts
private async processNewVersion(caughtObject: VersionedObjectResult<ChannelInfo>): Promise<void> {
  console.log('[TRACE] processNewVersion start:', caughtObject.idHash);
  
  // Original processing code...
  
  console.log('[TRACE] About to emit onUpdated event:', {
    idHash: caughtObject.idHash,
    id: newChannelInfo.id,
    hasListeners: this.checkForListeners()
  });
  
  this.onUpdated.emit(
    caughtObject.idHash,
    newChannelInfo.id,
    newChannelInfo.owner || null,
    new Date(changedElements[changedElements.length - 1].creationTime),
    changedElements
  );
  
  console.log('[TRACE] onUpdated event emitted');
}

// Helper method to check for listeners
private checkForListeners(): boolean {
  const listeners = (this.onUpdated as any)._listeners || 
                   (this.onUpdated as any).listeners;
  
  if (listeners) {
    if (listeners instanceof Map) {
      return listeners.size > 0;
    } else if (listeners instanceof Set) {
      return listeners.size > 0;
    } else if (Array.isArray(listeners)) {
      return listeners.length > 0;
    }
  }
  return false;
}
```

### 5. ObjectEventDispatcher Test

Test if the ObjectEventDispatcher is forwarding events correctly:

```typescript
function testObjectEvents() {
  let receivedEvent = false;
  
  const disconnect = objectEvents.onNewVersion(
    (result) => {
      console.log('[TEST] objectEvents received:', result.obj.$type$);
      receivedEvent = true;
    },
    'Test handler',
    'ChannelInfo'
  );
  
  // Create or update a ChannelInfo object
  channelManager.createChannel('test-object-events')
    .then(() => {
      setTimeout(() => {
        console.log('[TEST] objectEvents received status:', receivedEvent);
        disconnect();
      }, 1000);
    });
}
```

### 6. Testing with Extended Timeout

Test if there's a timing issue:

```typescript
function testWithExtendedTimeout(channelManager: ChannelManager) {
  let eventReceived = false;
  console.log('[DIAGNOSTICS] Setting up extended timeout test');
  
  const disconnect = channelManager.onUpdated(() => {
    console.log('[DIAGNOSTICS] ✓ Event received with extended timeout');
    eventReceived = true;
  });
  
  // Create test channel
  const testChannelId = `extended-timeout-test-${Date.now()}`;
  
  channelManager.createChannel(testChannelId)
    .then(() => {
      // Wait longer than the normal timeout
      setTimeout(() => {
        console.log('[DIAGNOSTICS] Extended timeout event status:', eventReceived);
        disconnect();
      }, 5000); // 5 second timeout instead of typical 1 second
    });
}
```

### 7. Initialization Order Test

Test if the initialization order affects event registration:

```typescript
async function testInitializationOrder() {
  // 1. Create models but don't initialize
  const leuteModel = new LeuteModel('ws://localhost:8080');
  const channelManager = new ChannelManager(leuteModel);
  
  // 2. Register listener BEFORE initialization
  let preInitEventReceived = false;
  const preInitDisconnect = channelManager.onUpdated(() => {
    console.log('[TEST] Pre-init event received');
    preInitEventReceived = true;
  });
  
  // 3. Initialize models
  await leuteModel.init();
  await channelManager.init();
  
  // 4. Test if pre-init listener works
  await channelManager.createChannel('pre-init-test');
  
  // 5. Register listener AFTER initialization
  let postInitEventReceived = false;
  const postInitDisconnect = channelManager.onUpdated(() => {
    console.log('[TEST] Post-init event received');
    postInitEventReceived = true;
  });
  
  // 6. Test if post-init listener works
  await channelManager.createChannel('post-init-test');
  
  // 7. Check results after delay
  setTimeout(() => {
    console.log('[TEST] Pre-init event received:', preInitEventReceived);
    console.log('[TEST] Post-init event received:', postInitEventReceived);
    
    // Clean up
    preInitDisconnect();
    postInitDisconnect();
  }, 2000);
}
```

## Comprehensive Diagnostic Module

Here's a complete diagnostic module you can add to your app:

```typescript
// channelEventDebug.ts
export function runChannelEventDiagnostics(
  channelManager: ChannelManager,
  topicModel: TopicModel
) {
  console.log('[DIAGNOSTICS] Starting channel event diagnostics');
  
  // Test 1: Direct event test
  testDirectEvent(channelManager);
  
  // Test 2: Listener registration check
  checkListenerRegistration(channelManager);
  
  // Test 3: Test with extended timeout
  setTimeout(() => {
    testWithExtendedTimeout(channelManager);
  }, 3000);
  
  // Test 4: Test TopicModel's listener setup
  checkTopicModelListeners(topicModel, channelManager);
}

function checkTopicModelListeners(topicModel: TopicModel, channelManager: ChannelManager) {
  console.log('[DIAGNOSTICS] Checking if TopicModel has attached handlers');
  
  // Check if the TopicModel has stored disconnectFns
  const disconnectFns = (topicModel as any).disconnectFns;
  console.log('[DIAGNOSTICS] TopicModel disconnectFns:', {
    exists: !!disconnectFns,
    count: disconnectFns ? disconnectFns.length : 0
  });
  
  // Test if we can attach a listener through TopicModel's methods
  // This assumes TopicModel might have its own method to attach to ChannelManager events
  if (typeof topicModel.testChannelEvents === 'function') {
    console.log('[DIAGNOSTICS] Running TopicModel.testChannelEvents()');
    topicModel.testChannelEvents();
  } else {
    console.log('[DIAGNOSTICS] TopicModel.testChannelEvents method not found');
  }
}

// Other test functions as defined above...
```

## Implementation Instructions

1. Add this diagnostic module to your application
2. Call the diagnostics after model initialization:

```typescript
// In your app initialization code
import { runChannelEventDiagnostics } from './channelEventDebug';

// After models are initialized
console.log('[APP] Running channel event diagnostics');
runChannelEventDiagnostics(channelManager, topicModel);
```

3. Check the logs to determine:
   - If direct event listeners work
   - If TopicModel's listeners are properly registered
   - If there's a timing issue
   - If event emission is working correctly

## Common Issues and Solutions

### No Listeners Registered

**Signs**: checkListenerRegistration shows zero listeners.
**Solution**: Check TopicModel's initialization to ensure it properly registers listeners.

### Events Emitted But Not Received

**Signs**: Tracing shows events are emitted but listeners don't receive them.
**Solution**: Check if event type matches what listeners expect, or if there's an event serialization issue.

### Timing Issues

**Signs**: Extended timeout tests show events are eventually received.
**Solution**: Add delay or ensure proper order of operations.

### Initialization Order Problems

**Signs**: Post-initialization listeners work but pre-initialization listeners don't.
**Solution**: Move listener registration after initialization or enhance event system to handle pre-init listeners.

### Event Object Replacement

**Signs**: Listeners are registered but on a different event object instance.
**Solution**: Ensure the event object isn't being replaced during initialization. 