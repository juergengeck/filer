# connection.core Tests

This directory contains tests for connection.core's ONE.core integration.

## Test Files

### Production Tests (Using connection.core)

1. **test-adapter-simple.js** (NEW)
   - Demonstrates CubeOneCoreAdapter usage
   - Shows clean API wrapping of ONE.core models
   - Single-process test (fails due to ONE.core's single-instance limitation)
   - **Purpose**: API documentation and pattern demonstration

2. **test-connection-core.js** (NEW)
   - Demonstrates full ConnectionManagerOneCore usage
   - Shows high-level API (createInvitation, createGroupWithCertificate, etc.)
   - Single-process test (fails due to ONE.core's single-instance limitation)
   - **Purpose**: API documentation for platforms

### Integration Tests (Multi-process, using workers)

3. **test-object-filter-simple.js** (Refactored)
   - Simple 2-person pairing and group creation test
   - Uses worker processes to run multiple ONE.core instances
   - Tests object filter (Groups without certificates are blocked)
   - **Status**: Refactored paths to work from connection.core/test/

4. **test-object-filter.js** (Refactored)
   - Comprehensive 3-person group chat test
   - Tests pairing, group creation, certificate distribution, messaging
   - Validates peer-to-peer messaging (works when creator offline)
   - **Status**: Refactored paths to work from connection.core/test/

5. **test-object-filter-worker.js** (To be refactored)
   - HTTP worker process that wraps ONE.core models
   - Provides HTTP API for test coordination
   - **Next step**: Refactor to use CubeOneCoreAdapter for cleaner code

## Architecture

```
┌─────────────────────────────────────────┐
│   Test Process (coordinator)           │
│                                         │
│   ┌─────────────────────────────────┐  │
│   │ test-object-filter-simple.js    │  │
│   │ or test-object-filter.js        │  │
│   └─────────────────────────────────┘  │
│              ↓ spawns                   │
│   ┌─────────────────────────────────┐  │
│   │ Worker Process 1 (Alice)        │  │
│   │   test-object-filter-worker.js  │  │
│   │                                 │  │
│   │   ONE.core Models               │  │
│   │   → LeuteModel                  │  │
│   │   → ChannelManager              │  │
│   │   → ConnectionsModel            │  │
│   │   → TopicModel                  │  │
│   │                                 │  │
│   │   HTTP Server (port 9001)       │  │
│   └─────────────────────────────────┘  │
│              ↓ spawns                   │
│   ┌─────────────────────────────────┐  │
│   │ Worker Process 2 (Bob)          │  │
│   │   test-object-filter-worker.js  │  │
│   │                                 │  │
│   │   ONE.core Models               │  │
│   │   HTTP Server (port 9002)       │  │
│   └─────────────────────────────────┘  │
│              ↓ spawns                   │
│   ┌─────────────────────────────────┐  │
│   │ Worker Process 3 (Charlie)      │  │
│   │   test-object-filter-worker.js  │  │
│   │                                 │  │
│   │   ONE.core Models               │  │
│   │   HTTP Server (port 9003)       │  │
│   └─────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Running Tests

### Integration Tests (Working)

```bash
# Simple 2-person test
node connection.core/test/test-object-filter-simple.js

# Comprehensive 3-person group chat test
node connection.core/test/test-object-filter.js
```

**Current Status**: Tests run but fail due to:
- API response format issues (contacts endpoint)
- Channel management bugs (channel doesn't exist errors)
- Timing/synchronization issues

### API Demonstration Tests (For reference)

```bash
# CubeOneCoreAdapter API demo (fails - single instance limitation)
node connection.core/test/test-adapter-simple.js

# ConnectionManagerOneCore API demo (fails - platform deps required)
node connection.core/test/test-connection-core.js
```

## Refactoring Status

✅ **Completed**:
- Path fixes for tests to work from connection.core/test/
- Created adapter demonstration tests
- Created ConnectionManagerOneCore demonstration tests

🔄 **Next Steps**:
1. Fix functional bugs in integration tests (channel management, API responses)
2. Refactor test-object-filter-worker.js to use CubeOneCoreAdapter
3. Update worker HTTP endpoints to use adapter methods

## connection.core Integration

The tests demonstrate connection.core's adapter pattern:

### Without connection.core (raw ONE.core):
```javascript
// Create invitation
const invitation = await connectionsModel.pairing.createInvitation();

// Create group with certificates (50+ lines of code)
const hashGroup = { $type$: 'HashGroup', members };
const hashGroupResult = await storeUnversionedObject(hashGroup);
// ... 40 more lines ...
```

### With connection.core (CubeOneCoreAdapter):
```javascript
// Create invitation
const invitation = await adapter.connections.createInvitation();

// Create group with certificates (1 line!)
const group = await adapter.attestation.createGroupWithCertificate('Group Name', members);
```

## Key Findings

1. **ONE.core Limitation**: Only one ONE.core instance per JavaScript runtime
   - Solution: Use worker processes (current approach)
   - Alternative: Use ConnectionManager without ONE.core for platforms that don't need it

2. **CubeOneCoreAdapter**: Provides clean API wrapper
   - Simplifies group creation from 50+ lines to 1 line
   - Makes intent clear (create group with certificate vs. low-level object storage)
   - Platform-specific (Cube/Node.js)

3. **ConnectionManagerOneCore**: High-level connection management
   - Requires full platform dependencies (transport, storage, UI)
   - Best for platforms building on connection.core
   - Can use ONE.core adapter optionally

4. **Test Architecture**: Multi-process required
   - Coordinator spawns worker processes
   - Workers run ONE.core instances
   - HTTP API for coordination
   - Could be refactored to use adapter for cleaner code

## Documentation

- See `../README-ONECORE-INTEGRATION.md` for integration guide
- See `../src/adapters/OneCoreAdapter.ts` for interface definition
- See `../src/adapters/cube/CubeOneCoreAdapter.ts` for implementation
- See `../src/ConnectionManager.extended.ts` for high-level API
