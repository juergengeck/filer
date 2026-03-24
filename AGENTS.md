# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**Filer** is a multi-platform virtual filesystem for the ONE platform - a content-addressable storage and synchronization system. It exposes ONE database content as native filesystems on Windows (ProjFS), Linux/WSL (FUSE3), and macOS (File Provider).

The repository contains multiple interconnected packages:
- **Core Platform**: `one.core`, `one.models` - TypeScript libraries for content-addressable storage with CRDT support
- **Native Bridges**: `one.projfs`, `one.fuse3`, `one.provider` - Platform-specific filesystem adapters
- **API Server**: `refinio.api` - QUIC-based instance server with REST endpoints
- **CLI**: `refinio.cli` - Command-line client for ONE platform

## Key Build Commands

### Primary Development: macOS File Provider (`one.provider/`)

```bash
# Full build (TypeScript + Swift)
npm install && npm run build    # Build TypeScript IPC server
swift build                     # Build Swift extension library
# or combine: npm run build && npm run build:swift

# The File Provider extension is loaded by refinio.api, not run standalone
# See refinio.api for how to programmatically register domains

# Run connection integration test (requires refinio.api built)
npm run test:connection

# Run IPC bridge test
npm run test:ipc

# Clean build
npm run clean
rm -rf .build
```

### TypeScript Packages (`one.core/`, `one.models/`, `refinio.api/`, `refinio.cli/`)
```bash
# Build
npm run build

# Test
npm test

# Watch mode
npm run dev  # or npm run build:src -- --watch
```

### Other Platforms (for reference)
- **Linux FUSE** (`one.fuse3/`): `npm install && npm run build`
- **Windows ProjFS** (`one.projfs/`): `npm install && npm run build`

## Repository Structure

```
filer/
├── one.core/              # Content-addressable storage, crypto, versioning (TypeScript)
├── one.models/            # Models, connections, filesystems, recipes (TypeScript)
├── one.provider/          # macOS File Provider + Node.js IPC bridge (Swift + TypeScript)
│   ├── Sources/
│   │   └── OneFiler/          # File Provider implementation (includes ONEBridge IPC)
│   ├── node-runtime/          # TypeScript IPC server (JSON-RPC)
│   ├── packages/              # Vendored one.core and one.models
│   └── Package.swift          # Swift Package Manager config
├── one.fuse3/             # Linux FUSE3 filesystem bridge (N-API/C++)
├── one.projfs/            # Windows ProjFS filesystem bridge (N-API/C++)
├── refinio.api/           # QUIC-based API server (TypeScript)
├── refinio.cli/           # CLI client (TypeScript)
├── one.core.expo/         # React Native variant of one.core
└── specs/                 # Feature specifications (Specify framework)
    └── 001-apple-file-provider/
```

## Architecture Patterns

### 1. Cross-Platform Filesystem Abstraction

All filesystem bridges implement the `IFileSystem` interface from `one.models`:
- `stat(path)` - Get file/directory metadata
- `readDir(path)` - List directory contents
- `readFile(path)` / `readFileInChunks(...)` - Read file data
- `createDir(path)` / `createFile(path)` - Create files/directories
- `unlink(path)` / `rmdir(path)` - Delete files/directories
- `rename(src, dest)` - Move/rename files

**Platform-specific bridges**:
- **Windows**: `one.projfs` → ProjFS (N-API C++) → Explorer
- **Linux**: `one.fuse3` → FUSE3 (N-API C++) → File Manager
- **macOS**: `one.provider` → File Provider Extension (Swift) → Finder

### 2. Filesystem Composition (`one.models/src/fileSystems/`)

Multiple specialized filesystems combine via `CombinedFileSystem`:
- `/chats` - ChatFileSystem (topics, messages)
- `/objects` - ObjectsFileSystem (raw ONE objects)
- `/debug` - DebugFileSystem (connections, instance info)
- `/invites` - PairingFileSystem (invitation files for connections)
- `/types` - TypesFileSystem (recipe definitions)
- `/profiles` - ProfilesFileSystem (user profiles)
- `/questionnaires` - QuestionnairesFileSystem

**Cached Directories**: Date-based hierarchical lazy-loading (Years → Months → Days → Objects) minimizes memory usage.

### 3. macOS IPC Architecture (`one.provider/`)

```
Finder/Files App
      ↓
File Provider Extension (Swift, sandboxed)
      ↓
ONEBridge (Swift Actor)
      ↓ JSON-RPC over stdin/stdout
Node.js Process (node-runtime/)
      ↓
IFileSystem interface (TypeScript)
      ↓
one.core + one.models (content-addressable storage)
```

**IPC Protocol**: JSON-RPC 2.0 with methods matching IFileSystem interface.

### 4. ONE Object System (`one.core/`)

**Core Concepts**:
- **Objects**: Content-addressable via SHA-256 hash of microdata representation
- **Recipes**: Define object schemas (`$type$`, property names/types)
- **Versioning**: ID Objects + Version Maps + Reverse Maps
- **Plans**: Idempotent object creation (same inputs = same results)

**Storage Strategies** (`STORE_AS`):
- `CHANGE` (default) - Sequential updates
- `MERGE` - CRDT merging from multiple sources
- `NO_VERSION_MAP` - Skip version trees

**Platform Support**: Multi-platform via `src/system/` (nodejs, browser, rn).
Build copies appropriate platform folder to `lib/system/` based on `package.json` `refinio.platform` field.

### 5. Connection & Synchronization (`one.models/`)

**Connection Establishment**:
1. **ConnectionRouteManager** - Low-level route management (WebSocket, direct sockets, CommServer relay)
2. **LeuteConnectionsModule** - Maps OneInstanceEndpoints to routes, manages connection groups
3. **Communication Server** - Central relay for incoming connections

**Protocols** (`src/misc/ConnectionEstablishment/protocols/`):
- **Chum**: Data sync protocol (import/export streams)
- **Pairing**: One-time authentication via invitation tokens
- **Debug/ExchangeInstanceIds/ExchangePersonIds**: Identity verification

**Plugin Architecture**: Composable message pipeline
- Plugins: WebSocket → Encryption → Fragmentation → KeepAlive → PingPong → Promise → Statistics → Network
- Order matters: forward for incoming, reverse for outgoing
- State machine: `connecting` → `open` → `closed`

### 6. Model Layer (`one.models/src/models/`)

All models extend base `Model` with StateMachine lifecycle:
- **LeuteModel**: Contact management, groups, profiles, identities
- **ChannelManager**: Message channels for chat/posts
- **TopicModel**: Chat topics and conversations
- **ConnectionsModel**: Orchestrates connection workflows
- **DocumentModel, QuestionnaireModel**: Domain-specific data
- **IoMManager**: Internet of Me (multi-instance personal data)

**Standard Pattern**:
```typescript
state: StateMachine<'Uninitialised' | 'Initialised', 'init' | 'shutdown'>
onUpdated: OEvent<() => void>
async init(): Promise<void>
async shutdown(): Promise<void>
```

**ALWAYS call `.init()` before using models**.

## Important Development Notes

### TypeScript Configuration
- **Module System**: ES modules (`"type": "module"`) - use `.js` extensions in imports even for `.ts` files
- **Target**: ES2022, NodeNext modules
- **Build Output**: `lib/` or `dist/` directories (gitignored)
- **Platform Selection** (`one.core`): Set `refinio.platform` in package.json (nodejs, browser, rn)

### Testing
- **one.core**: Tests run against `lib/`, **always build before testing**
- **one.models**: `npm run build:test && npx mocha --exit 'test/SpecificTest-test.js'`
- **one.provider**: `npm run test:connection` (integration test requires refinio.api built)
- Browser tests: Open `test/index.html` in browser

### Code Style Principles (from project AGENTS.md files)
- Prefer types over interfaces
- Avoid enums; use maps instead
- Avoid arrow functions when possible
- Write TSDoc for all functions
- Prefix conventions: `is` (type guards), `get`/`set` (accessors), `create`/`update`/`delete` (CRUD)
- Import with `.js` extensions (ESM requirement)
- Use absolute imports with `@/` for project source code (one.models only)

### Engineering Principles (from user's global AGENTS.md)
- **No fallbacks/mitigations**: Fail fast and throw errors. Fix problems, don't work around them
- **No delays**: Don't use setTimeout without strong justification
- **Use existing utilities**: Leverage `one.helpers`, `one.core` utilities before creating new code
- **SHA256Hash and SHA256IdHash**: Branded string types - they're strings with compile-time type safety
- **No Codex attribution in git commits**

### Key Conventions
- **Microdata format is strict**: No spaces/newlines, exact format for consistent hashing
- **Property order matters**: Defined by recipe rules for deterministic hashing
- **Objects are immutable**: Never modified, only new versions created
- **Plans are idempotent**: Same inputs always return same cached results

## Common macOS Development Tasks

### Daily Development Workflow
```bash
cd one.provider

# 1. Build the extension
npm run build && swift build

# 2. The extension is loaded by refinio.api, not run standalone
# To test, run refinio.api with File Provider configuration:
cd ../refinio.api
npm run build
# Set REFINIO_FILER_PROVIDER=fileprovider in environment
npm start

# 3. In another terminal, watch logs
log stream --predicate 'subsystem == "com.one.provider"' --level debug

# 4. Verify filesystem is mounted (after refinio.api registers domain)
ls -la ~/Library/CloudStorage/ONE-Provider
```

### Testing

**IPC Bridge Test** (tests Swift ↔ Node.js communication):
```bash
cd one.provider
npm run test:ipc
```

**Connection Integration Test** (full end-to-end):
```bash
# Requires refinio.api to be built first
cd ../refinio.api && npm run build
cd ../one.provider
npm run test:connection
```

### Debugging

**View File Provider Logs**:
```bash
# Real-time log streaming (recommended)
log stream --predicate 'subsystem == "com.one.provider"'

# With debug level
log stream --predicate 'subsystem == "com.one.provider"' --level debug

# Broader filter for all ONE-related logs
log stream --predicate 'subsystem CONTAINS "one"' --level debug

# View recent logs in Console.app
open -a Console  # then filter by "com.one.provider"
```

**Check File Provider Extension Status**:
```bash
# List registered File Provider domains
pluginkit -m -v -p com.apple.fileprovider-nonui

# Check if extension is enabled
pluginkit -m | grep com.one.filer.mac.extension
```

**Debug Node.js IPC Server**:
```bash
# The IPC server runs as a child process of the app
# Check if node process is running
ps aux | grep node-runtime

# Node.js IPC server code is in node-runtime/
# Built output is in lib/
```

### Killing Stuck Processes
```bash
# Kill node processes (IPC server)
killall node

# Kill file provider daemon (careful - affects all File Providers!)
killall file providerd

# Full reset - restart refinio.api
killall node && sleep 1 && cd ../refinio.api && npm start
```

### Troubleshooting

**File Provider not mounting**:
1. Check System Settings → Privacy & Security → Extensions → File Provider
2. Verify entitlements in `OneFilerExtension.entitlements`
3. Check if refinio.api successfully registered the domain (check logs)
4. Try removing domain: `pluginkit -r <domain-id>`

**IPC communication failing**:
1. Verify `node-runtime` is built: `npm run build`
2. Check Node.js in PATH: `which node`
3. Inspect logs: `log stream --predicate 'subsystem == "com.one.provider"'`
4. Check if Node.js process spawned: `ps aux | grep node-runtime`

**Connection test failures**:
1. Ensure refinio.api is built: `cd ../refinio.api && npm run build`
2. Check ports free: 8000, 50123, 50125
3. Clean up processes: `killall node`
4. Ensure File Provider integration exists in refinio.api

## Specification Framework

This project uses Specify for feature planning:
- Specs in `specs/001-apple-file-provider/`
- Templates in `.specify/templates/`
- Constitution in `.specify/memory/constitution.md`

## Dependencies

### Core Platform Dependencies
- `@refinio/one.core` - Cryptographic primitives, recipes, versioning, storage
- `@refinio/one.models` - Models, connections, filesystems, protocols
- `tweetnacl` - Cryptography
- `ws`, `isomorphic-ws` - WebSocket support

### Native Add-on Dependencies
- **macOS**: Swift 5.9+, Xcode 15+
- **Linux**: FUSE3, libfuse3-dev, Node.js 20+
- **Windows**: Windows SDK, ProjFS headers, Visual Studio 2019+

### Development Tools
- TypeScript 5.0+
- Mocha, Chai - Testing
- Jest - Testing (refinio.api)
- XcodeGen - Xcode project generation (macOS)
