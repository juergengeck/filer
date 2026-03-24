# Connection System Architecture

## Overview
The Connection system provides a robust WebSocket-based communication layer with plugin architecture. This document outlines the current architecture and the plan for Expo integration.

## Current Architecture

### Core Components

1. **Connection Class**
   - Main wrapper for WebSocket functionality
   - State machine for connection states (connecting, open, closed)
   - Event-based message handling
   - Plugin management

2. **WebSocketPlugin**
   - Handles raw WebSocket operations
   - Event transformation
   - Binary and text message support
   - Connection lifecycle management

3. **Plugin System**
   - PromisePlugin: Async operation support
   - StatisticsPlugin: Connection metrics
   - EncryptionPlugin: Secure communication
   - PingPongPlugin: Connection health
   - KeepAlivePlugin: Connection maintenance

### Event System

1. **Incoming Events**
```typescript
type ConnectionIncomingEvent = 
    | { type: 'message'; data: Uint8Array | string }
    | { type: 'opened' }
    | { type: 'closed'; reason: string; origin: 'local' | 'remote' };
```

2. **Outgoing Events**
```typescript
type ConnectionOutgoingEvent = 
    | { type: 'message'; data: Uint8Array | string }
    | { type: 'close'; reason?: string; terminate: boolean };
```

## Expo Integration Plan

### Required Components

1. **ExpoConnection**
```typescript
export class ExpoConnection {
    private state: StateMachine<'connecting' | 'open' | 'closed', 'open' | 'close'>;
    public onMessage: OEvent<(message: Uint8Array | string) => void>;
    private webSocket: WebSocket;

    constructor(url: string) {
        this.webSocket = new WebSocket(url);
        this.setupWebSocket();
        this.setupState();
    }
}
```

2. **Essential Plugins**
```typescript
// Core WebSocket functionality
class ExpoWebSocketPlugin {
    constructor(webSocket: WebSocket);
    handleMessage(data: string | ArrayBuffer): void;
}

// Async operations
class PromisePlugin {
    waitForMessage(): Promise<string | Uint8Array>;
}

// Basic statistics
class StatisticsPlugin {
    bytesReceived: number;
    bytesSent: number;
}
```

3. **Support Classes**
```typescript
// Event handling
class OEvent<T extends Function> {
    addListener(fn: T): void;
    emit(...args: any[]): void;
}

// Async operation management
class MultiPromise<T> {
    constructor(maxPromises: number, timeout: number);
}
```

### Features to Maintain

1. Binary and text message support
2. Promise-based async operations
3. Connection state management
4. Event-based message handling
5. Basic statistics tracking
6. Error handling and connection recovery

### Features to Simplify/Remove

1. Complex plugin system (make it more lightweight)
2. Server-side components (not needed in Expo)
3. Complex logging system
4. TCP-specific features
5. Node.js specific functionality

## Usage Example

```typescript
// Create connection
const conn = new ExpoConnection('ws://example.com');

// Add essential plugins
conn.addPlugin(new PromisePlugin());
conn.addPlugin(new StatisticsPlugin());

// Wait for connection
await conn.waitForOpen();

// Send message
conn.send('Hello Server!');

// Listen for messages
conn.onMessage(msg => {
    console.log('Received:', msg);
});

// Close connection
conn.close('Done');
```

## Migration Strategy

1. Create ExpoConnection class extending base Connection
2. Implement minimal plugin set
3. Test with Expo's WebSocket implementation
4. Gradually add features as needed
5. Maintain compatibility with existing API where possible

## Notes

- Expo's WebSocket implementation has some limitations compared to Node.js
- Focus on client-side functionality only
- Keep the API surface minimal but extensible
- Maintain type safety with TypeScript
- Consider mobile-specific requirements (connection drops, background state) 