# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build
```bash
npm run build      # Full build: cleans lib/, removes build cache, runs tsc --build
npm run build:src  # Build source only (tsc --build src/tsconfig.json)
npm run build:test # Build tests only (tsc --build test/tsconfig.json)
```

### Test
```bash
npm test                                    # Build tests and run all tests
npm run testcov                             # Run tests with code coverage
npx mocha --exit 'test/**/*-test.js'       # Run compiled tests directly
npx mocha --exit test/ChannelManager-test.js  # Run a single test file
```

### Bundle Tools
```bash
npm run bundle  # Bundle standalone tools (CommServer, PasswordRecoveryServer, GenerateIdentity)
```

### Start Services
```bash
npm run start-comm-server    # Start communication server on localhost:8000
npm run start-state-machine  # Start state machine tool
```

### Dependency Management
```bash
npm run cpcore  # Copy one.core dependencies locally for development
npm run cpall   # Copy all refinio dependencies
```

## Architecture

### Core Structure
The codebase implements models and infrastructure for the ONE platform, built on `@refinio/one.core`.

**Key directories:**
- `/src/models/` - Domain models for various data types (health data, documents, chat, etc.)
- `/src/api/` - High-level API layer with sub-APIs for different domains
- `/src/fileSystems/` - Virtual filesystem implementations for different data types
- `/src/recipes/` - Data serialization/deserialization recipes for ONE objects
- `/src/misc/` - Supporting utilities (connections, crypto, state machines, etc.)

### Key Models
- **ChannelManager** - Core component managing channel operations (note: multiple versions exist)
- **LeuteModel** - User/person management and profiles
- **TopicModel** - Chat/messaging functionality
- **ConnectionsModel** - Network connection management
- **Various health models** - ECG, BloodGlucose, HeartEvent, etc.

### Recipe System
Recipes define how data types are serialized/stored in the ONE object system:
- Stable recipes in `recipes-stable.ts`
- Experimental recipes in `recipes-experimental.ts`
- Each model type has corresponding recipe definitions
- Reverse maps provide type lookup functionality

### Connection Infrastructure
Complex connection management system in `/src/misc/ConnectionEstablishment/`:
- WebSocket-based connections with plugin architecture
- Communication server for relaying connections
- Multiple protocol implementations for handshakes and data exchange
- Encryption and fragmentation plugins

## TypeScript Configuration

- **Target:** ESNext with NodeNext module system
- **Strict mode enabled** with all strict checks
- **Composite project** with separate src/ and test/ builds
- **Import extensions required** - use `.js` in imports
- **Verbatim module syntax** enabled

## Code Style Rules (from .cursorrules)

- Use TypeScript for all code; prefer types over interfaces
- Avoid enums; use maps instead
- Use `function` keyword for pure functions (not arrow functions)
- Always write TSDoc for functions and components
- Use specific prefixes: `is` for type guards, `get`/`set` for accessors, `create`/`update`/`delete` for operations
- Import order: node_modules → @refinio packages → local → CSS
- Use `.js` extension in import paths

## Testing

- **Framework:** Mocha with Chai and Chai-as-promised
- **Test files:** Located in `/test/` with `-test.ts` suffix
- Tests compile to JavaScript before execution
- Source maps enabled for debugging
- Test utilities available in `/test/utils/`

## Important Notes

- The package is private and published to GitHub's npm registry
- Multiple ChannelManager implementations exist (original, new, newer) - verify which is active
- Known race condition in ChannelManager: cache updates after async object post - see CHANNEL_MANAGER_FIX.md
- AssertionVerifier recently added with proper recipe integration
- Build process removes `exports` field from package.json to use Node's default resolution
- Project uses ESM modules (`"type": "module"` in package.json)

## FileSystem Layer

Virtual filesystem implementations in `/src/fileSystems/`:
- **IFileSystem** - Base interface for all filesystem implementations
- **PairingFileSystem** - Generates invite files (txt/PNG QR) for device pairing on-demand
- **ChatFileSystem** - Chat/topic data access
- **JournalFileSystem** - Journal entry storage
- **ObjectsFileSystem** - Direct object storage access
- **ProfilesFileSystem** - User profile data
- **QuestionnairesFileSystem** - Questionnaire data
- **PersistentFileSystem** - Persistent storage layer
- **TemporaryFileSystem** - Temporary file storage
- **TypesFileSystem** - Type information access

FileSystem features:
- Common interface: `stat()`, `readDir()`, `readFile()`, `writeFile()`, `unlink()`, `mkdir()`, `rmdir()`
- Error types in FileSystemErrors.ts: FileNotFoundError, FileExistsError, etc.
- Helper utilities in FileSystemHelpers.ts
- Date-based hierarchical directory structures with caching (Years/Months/Days)

## API Layer

High-level API in `/src/api/One.ts` with domain-specific sub-APIs:
- **AIApi** - AI integration functionality
- **ChatApi** - Chat/messaging operations
- **DataApi** - General data operations
- **InternetOfMeApi** - IoM functionality
- **InternetOfPeopleApi** - IoP functionality
- **LeuteApi** - Person/user management
- **TrustApi** - Trust and certificate management

## Authenticator System

Multiple authentication strategies in `/src/models/Authenticator/`:
- **SingleUser** - Single user with password authentication
- **SingleUserNoAuth** - Single user without authentication
- **MultiUser** - Multiple user support with authentication
- Factory function `createAuthenticator()` selects appropriate strategy

## Connection Plugin Architecture

Connection plugins provide layered functionality for WebSocket connections:
- **EncryptionPlugin** - End-to-end encryption for connection data
- **FragmentationPlugin** - Handles message fragmentation for large payloads
- **KeepAlivePlugin** - Maintains connection liveness
- **NetworkPlugin** - Network-level connection management
- **PingPongPlugin** - Connection health monitoring
- **PromisePlugin** - Promise-based request/response pattern
- **StatisticsPlugin** - Connection statistics tracking
- **WebSocketPlugin** - WebSocket transport layer