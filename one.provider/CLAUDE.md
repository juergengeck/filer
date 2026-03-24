# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**one.provider** is a complete ONE application for macOS that provides both native filesystem integration and full application server functionality. It bundles the entire ONE platform stack (one.core + one.models + refinio.api functionality) into a single macOS File Provider extension.

**Key capabilities**:
1. **Finder Integration**: Native filesystem access via File Provider API (`~/Library/CloudStorage/OneFiler-*/`)
2. **Full ONE Backend**: Complete application server with all models, networking, and sync
3. **Standalone Operation**: Self-contained ONE instance that doesn't require external servers

**Architecture approach**: Unlike one.fuse3 (Linux) and one.projfs (Windows) which are loaded as libraries by refinio.api, one.provider IS the complete application bundled as a macOS File Provider extension.

## Quick Start

### Most Common Commands

```bash
# Full rebuild and install (recommended for most changes)
./scripts/rebuild-and-install.sh

# Launch from DerivedData (for development/testing without installing)
open ~/Library/Developer/Xcode/DerivedData/OneFiler-*/Build/Products/Debug/OneFilerHost.app

# Enable HTTP REST API (optional, disabled by default)
export ONE_PROVIDER_HTTP_PORT=3000
./scripts/rebuild-and-install.sh

# Watch logs
log stream --predicate 'subsystem == "one.filer"' --level debug

# Kill stuck processes
killall OneFilerHost && killall fileproviderd && killall node

# Test IPC (fast, no installation needed)
npm run test:ipc

# Test HTTP API (if enabled)
curl http://localhost:3000/health
```

## Build Systems

This project supports **two build methods**:

### 1. Xcode (Recommended for Full Development)

The project uses **XcodeGen** to generate the Xcode project from `project.yml`.

```bash
# Generate/update Xcode project from project.yml
xcodegen generate

# Open in Xcode
open OneFiler.xcodeproj

# Or build from command line
xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug
```

**Xcode pre-build scripts automatically:**
- Build TypeScript IPC server (`npm run build`)
- Extract vendored dependencies (`npm run vendor:install`)
- Copy CLI into app bundle (`Contents/MacOS/onefiler`)
- Bundle Node.js binary and ICU libraries
- Copy node-runtime/lib and node_modules into extension resources

**Result**: Complete `OneFiler.app` at `.build/debug/OneFiler.app` (Debug) or derived data (Xcode).

### 2. Swift Package Manager (CLI and Library Only)

```bash
# Build just the CLI tool and extension library
swift build
# or
npm run build:swift

# CLI location: .build/debug/onefiler
# Library: .build/debug/libOneFilerExtension.dylib
# Does NOT create app bundle
```

### 3. Automated Build and Install (Recommended)

```bash
# Complete rebuild and install in one command
./scripts/rebuild-and-install.sh
```

This script handles:
1. TypeScript compilation (`npm run build`)
2. XcodeGen project generation
3. Node.js bundling (`scripts/bundle-node.sh`)
4. Xcode build
5. Installation to /Applications
6. Verification of all components

**Verifies**:
- ✅ Node binary exists (57MB)
- ✅ ICU dylibs present (13 files)
- ✅ `node_modules` directory (not `node_modules_resolved`)
- ✅ IPC server code compiled

### 4. Manual App Bundle Creation (SPM-based)

```bash
# Build TypeScript first (REQUIRED)
npm install
npm run build

# Build Swift
swift build

# Create app bundle manually
./scripts/create-app-bundle.sh

# Install to /Applications (optional)
./scripts/install-to-applications.sh
```

### Build Order (Critical)

**TypeScript must be built before Swift:**
1. `npm run build` compiles `node-runtime/index.ts` → `node-runtime/lib/index.js`
2. Vendored dependencies must be extracted: `cd node-runtime && npm run vendor:install`
3. `swift build` or Xcode embeds `node-runtime/lib/` and `node-runtime/node_modules/` as resources in extension

If you build Swift/Xcode first, the extension will bundle outdated or missing IPC server code.

### Testing

```bash
# Test IPC bridge (Swift <-> Node.js communication)
npm run test:ipc

# Full integration test (requires extension installed and enabled)
npm run test:connection
```

## Critical Build Requirements

### Node.js Bundling

The File Provider extension runs in a macOS sandbox and **cannot access system Node.js**. The build process must:

1. **Bundle Node.js binary** into extension Resources (`Resources/bin/node`)
2. **Bundle ICU dylibs** (13 files) into `Resources/dylibs/`
3. **Update dylib references** using `install_name_tool` to use `@loader_path`
4. **Name directory `node_modules`** not `node_modules_resolved`

**CRITICAL**: ES modules in Node.js ONLY resolve directories named `node_modules`. The directory MUST be named exactly `node_modules`, not `node_modules_resolved` or any other name. The `NODE_PATH` environment variable does NOT work with ES modules (only CommonJS).

### Automated Build and Install

Use the combined script for most development:

```bash
# Recommended: Full rebuild and install
./scripts/rebuild-and-install.sh
```

This script:
- Regenerates Xcode project from `project.yml`
- Builds TypeScript IPC server
- Extracts vendored dependencies
- Bundles Node.js with ICU libraries
- Builds via Xcode
- Installs to /Applications with proper permissions
- Verifies all components are present

## Architecture

### Complete Application Architecture

```
Finder/Files App ──┐
Web Browser ───────┼──> OneFiler.app
Mobile App* ───────┘         │
                             ├─> Swift Extension (filesystem proxy)
                             │   - Translates File Provider API
                             │   - JSON-RPC over stdin/stdout
                             │
                             └─> Node.js Server (bundled ONE backend)
                                   ├─> IPC Bridge (filesystem operations)
                                   ├─> HTTP REST API (optional, localhost)
                                   ├─> WebSocket server* (future)
                                   └─> ONE Backend
                                       ├─> one.core (storage)
                                       ├─> one.models (all models)
                                       ├─> ConnectionsModel (peer sync)
                                       ├─> LeuteModel (contacts)
                                       └─> WebSocket → CommServer

* Future functionality
```

### IPC Flow (Filesystem Operations)

```
Finder/Files App
      ↓
File Provider Extension (Swift, sandboxed .appex)
      ↓
ONEBridge (Swift Actor - manages Node.js process)
      ↓ JSON-RPC 2.0 over stdin/stdout
Node.js Application Server (node-runtime/index.ts)
      ↓
IFileSystem interface (TypeScript)
      ↓
TemporaryFileSystem with mounted filesystems:
  - /chats (ChatFileSystem)
  - /invites (PairingFileSystem)
  - /objects (ObjectsFileSystem)
  - /debug (DebugFileSystem)
  - /types (TypesFileSystem)
  - /profiles (ProfilesFileSystem)
  - /questionnaires (QuestionnairesFileSystem)
      ↓
one.core (content-addressable storage)
```

### Network Architecture

Network connections happen **inside the Node.js application server**, not in the Swift extension:

```
User/Application
      ↓ (filesystem read/write)
~/Library/CloudStorage/OneFiler-domain/
      ↓ (macOS File Provider API)
Swift File Provider Extension (sandboxed)
      ↓ (JSON-RPC over stdin/stdout - no network)
Node.js Application Server
      ↓ (one.core + one.models)
      ├─> ConnectionsModel ──→ WebSocket ──→ CommServer (wss://comm10.dev.refinio.one)
      ├─> LeuteModel ────────→ manages peer connections
      ├─> ChannelManager ────→ handles messaging/sync
      └─> ONE.core ──────────→ local storage (read/write instance files)
```

**Key Points**:

1. **Swift Extension**: Pure filesystem proxy, no networking
   - Translates File Provider API → JSON-RPC messages
   - Sandboxed but has network entitlement
   - Spawns Node.js process with inherited network access

2. **Node.js Server**: Does all the networking
   - Establishes WebSocket connections to CommServer
   - Manages peer-to-peer connections via one.models
   - Syncs data with other ONE instances
   - Reads/writes to local ONE instance storage

3. **Configuration** (`node-runtime/index.ts:224`):
   ```typescript
   const commServerUrl = process.env.REFINIO_COMM_SERVER_URL || 'wss://comm10.dev.refinio.one';
   const connectionsModel = new ConnectionsModel(leuteModel, {
       commServerUrl,
       acceptIncomingConnections: false,  // File Provider doesn't accept incoming
       establishOutgoingConnections: false, // Uses pairing flow instead
       allowPairing: true,                 // Enables invite-based pairing
   });
   ```

**Environment Variables** (passed to Node.js process):

```bash
# HTTP REST API (optional - disabled by default)
ONE_PROVIDER_HTTP_PORT=3000                  # Enable HTTP server on this port
ONE_PROVIDER_INVITE_URL_PREFIX=https://lama.one/invite  # Invite URL prefix (optional)

# CommServer and networking
REFINIO_COMM_SERVER_URL=wss://comm.example.com  # Override CommServer URL (optional)

# Instance credentials (must match instance creator if connecting to existing instance)
REFINIO_INSTANCE_EMAIL=user@example.com
REFINIO_INSTANCE_SECRET=secret-key
REFINIO_INSTANCE_NAME=my-instance
```

### Three-Component System

1. **File Provider Extension** (`Sources/OneFiler/`)
   - NSFileProviderReplicatedExtension implementation
   - Runs as sandboxed .appex bundle loaded by macOS
   - Communicates with Node.js via ONEBridge actor
   - FileProviderItem wraps ONE objects as NSFileProviderItem
   - FileProviderEnumerators handle directory listing

2. **Node.js Application Server** (`node-runtime/index.ts`)
   - JSON-RPC 2.0 server over stdin/stdout (IPC bridge for filesystem operations)
   - HTTP REST API server on localhost (optional, enabled via `ONE_PROVIDER_HTTP_PORT`)
   - Initializes ONE.core instance and all models (LeuteModel, ChannelManager, ConnectionsModel, etc.)
   - Creates complete filesystem hierarchy
   - Handles all networking (WebSocket to CommServer, peer connections, sync)
   - **Bundles complete refinio.api functionality** (including HTTP REST API)
   - **Must be built before Swift package** (embedded as resource)

3. **CLI Tool** (`Sources/OneFilerCLI/main.swift`)
   - Command-line interface for domain management
   - Commands: register, unregister, list, status
   - Writes domain config to App Group container
   - Calls macOS File Provider APIs to register/unregister domains
   - **Integration point for applications** (any app can call CLI to register domains)
   - Standalone executable - no dependencies on running extension

### App Bundle Structure

```
OneFiler.app/
├── Contents/
│   ├── MacOS/
│   │   └── onefiler           # CLI executable
│   ├── PlugIns/
│   │   └── OneFilerExtension.appex/
│   │       ├── Contents/
│   │       │   ├── MacOS/
│   │       │   │   └── OneFilerExtension  # Extension binary
│   │       │   ├── Resources/
│   │       │   │   ├── bin/
│   │       │   │   │   └── node           # Bundled Node.js (57MB)
│   │       │   │   ├── dylibs/            # ICU libraries (13 files)
│   │       │   │   ├── lib/               # Node.js app server (from node-runtime/lib)
│   │       │   │   └── node_modules/      # one.core + one.models (from node-runtime/node_modules)
│   │       │   └── Info.plist
│   │       └── ...
│   └── Info.plist
```

## Interacting with the Extension

Once the extension is loaded by macOS, you interact with it **only through the filesystem mount point**:

### Mount Point Location

```bash
~/Library/CloudStorage/OneFiler-{domain-identifier}/
```

For example, if you registered a domain named "ONE-Test":
```bash
~/Library/CloudStorage/OneFiler-ONE-Test/
```

### Filesystem Interactions

Applications and users interact with the extension through standard filesystem operations:

```bash
# List directories (triggers enumeration in extension)
ls ~/Library/CloudStorage/OneFiler-ONE-Test/invites/

# Read files (triggers readFile in extension)
cat ~/Library/CloudStorage/OneFiler-ONE-Test/invites/iop_invite.txt

# Watch for changes
fswatch ~/Library/CloudStorage/OneFiler-ONE-Test/

# Any standard filesystem operation works
find ~/Library/CloudStorage/OneFiler-ONE-Test/ -name "*.txt"
```

### From Applications

Applications use standard file APIs:

```javascript
import fs from 'fs';

// Read invite file through mount point
const mountPoint = '/Users/user/Library/CloudStorage/OneFiler-server-provider-instance';
const inviteContent = fs.readFileSync(`${mountPoint}/invites/iop_invite.txt`, 'utf8');

// The extension handles the request transparently
```

### What You CANNOT Do

- **No runtime configuration**: Cannot send commands or config to running extension
- **No direct control**: Cannot restart, pause, or control extension behavior
- **No RPC/API**: No way to call methods on the extension directly
- **No status queries**: Cannot ask extension for its state (only via logs)

### Available Control Points

1. **CLI Tool** (before/after extension loads):
   - `onefiler register` - Register domain
   - `onefiler unregister` - Unregister domain
   - `onefiler list` - Show registered domains
   - `onefiler status` - Check domain status

2. **System Settings**:
   - Enable/disable extension (System Settings → Privacy & Security → Extensions)

3. **Process Management**:
   - `killall fileproviderd` - Restart ALL File Provider extensions (heavy-handed)
   - `killall node` - Kill Node.js servers (extension will respawn)

4. **Logs** (read-only monitoring):
   ```bash
   log stream --predicate 'subsystem == "one.filer"' --level debug
   ```

### Comparison to iCloud Drive

The interaction model is identical to iCloud Drive:
- **iCloud Drive**: Read/write files in `~/Library/Mobile Documents/`
- **OneFiler**: Read/write files in `~/Library/CloudStorage/OneFiler-{domain}/`
- **Both**: Extensions handle requests transparently
- **Both**: No direct control over the extension itself

## HTTP REST API

The Node.js application server includes an **optional HTTP REST API** for programmatic access to ONE functionality. This is disabled by default and must be explicitly enabled.

### Enabling the HTTP Server

Set the `ONE_PROVIDER_HTTP_PORT` environment variable before the extension loads:

```bash
# Enable HTTP REST API on port 3000
export ONE_PROVIDER_HTTP_PORT=3000

# Rebuild and install with HTTP server enabled
./scripts/rebuild-and-install.sh
```

The HTTP server runs on `localhost` and is only accessible from the local machine.

### REST API Endpoints

#### Health Check
```bash
GET /health
```
Returns server health status.

**Response:**
```json
{
  "status": "ok",
  "service": "one.provider"
}
```

#### Instance Status
```bash
GET /api/status
```
Returns ONE instance information.

**Response:**
```json
{
  "instanceId": "sha256hash...",
  "ownerId": "sha256hash...",
  "contacts": 5
}
```

#### Create Invitation
```bash
POST /api/connections/create-invite
```
Creates an IOP (Instance-to-Instance Pairing) invitation for connecting with another ONE instance.

**Response:**
```json
{
  "inviteUrl": "https://lama.one/invite#%7B...encoded-invite-data...%7D"
}
```

#### Accept Invitation
```bash
POST /api/connections/invite
Content-Type: application/json

{
  "inviteUrl": "https://lama.one/invite#%7B...%7D"
}
```
Accepts an invitation and establishes a connection with the remote instance.

**Response:**
```json
{
  "personId": "sha256hash...",
  "instanceId": "sha256hash...",
  "connectionId": "sha256hash...",
  "contactCreated": true
}
```

#### List Connections
```bash
GET /api/connections
```
Returns active connections to remote instances.

**Response:**
```json
[
  {
    "instanceId": "sha256hash...",
    "personId": "sha256hash...",
    "state": "open"
  }
]
```

#### List Contacts
```bash
GET /api/contacts
```
Returns all contacts from LeuteModel.

**Response:**
```json
[
  // Array of SomeoneModel objects
]
```

### Example Usage

```bash
# Health check
curl http://localhost:3000/health

# Get instance status
curl http://localhost:3000/api/status

# Create invitation
curl -X POST http://localhost:3000/api/connections/create-invite

# Accept invitation
curl -X POST http://localhost:3000/api/connections/invite \
  -H "Content-Type: application/json" \
  -d '{"inviteUrl": "https://lama.one/invite#..."}'

# List connections
curl http://localhost:3000/api/connections

# List contacts
curl http://localhost:3000/api/contacts
```

### Security Considerations

- HTTP server binds to `localhost` only (not accessible from network)
- No authentication implemented (assumes trusted local environment)
- For production use, consider adding authentication layer
- CORS is enabled for local development (`Access-Control-Allow-Origin: *`)

## Key Differences from one.fuse3 and one.projfs

### Standalone vs Library

- **one.fuse3/one.projfs**: Native Node.js modules loaded directly by applications like refinio.api
- **one.provider**: Complete standalone application installed as system extension, loaded by macOS

### No Application Control

- **one.fuse3/one.projfs**: Controlled by host application (start/stop, configuration)
- **one.provider**: Loaded on-demand by macOS when mount point accessed, cannot be controlled by applications

### IPC vs Direct Calls

- **one.fuse3/one.projfs**: Direct function calls to IFileSystem
- **one.provider**: JSON-RPC over pipes (process boundary)

### Installation Requirements

- **one.fuse3/one.projfs**: npm install adds native module
- **one.provider**: Requires:
  1. Build app bundle (`./scripts/rebuild-and-install.sh`)
  2. Code signing (ad-hoc for development, Apple Developer cert for production)
  3. System installation to /Applications
  4. User enabling in System Settings → Privacy & Security → Extensions → File Provider

### Sandboxing

- **one.fuse3/one.projfs**: Run in application process space
- **one.provider**: Runs in sandboxed extension, communicates via App Group container

### Bundled Stack

- **one.fuse3/one.projfs**: Use application's one.core/one.models
- **one.provider**: Bundles complete one.core + one.models + refinio.api functionality

## Important Implementation Details

### Node.js Application Server Initialization

The Node.js server (`node-runtime/index.ts`) initializes the complete ONE stack:

1. **Sets storage directory** via `initInstance({ directory: instancePath })`
2. **Imports all recipes** (core + stable + experimental)
3. **Initializes ONE.core instance** via `initInstance()`
4. **Creates and initializes all models**:
   - LeuteModel (contacts, connections)
   - ChannelManager (messaging)
   - TopicModel (chat topics)
   - ConnectionsModel (peer-to-peer sync)
   - IoMManager (multi-instance)
   - QuestionnaireModel
   - Notifications
5. **Mounts filesystems** into TemporaryFileSystem root

**Critical**: The instance can either:
- **Create new instance** (`wipeStorage: true`) - Extension manages its own instance
- **Connect to existing instance** (`wipeStorage: false`) - Shares instance with other applications

The instance credentials (email, secret, name) must match between creator and connector.

### ONEBridge Actor Pattern

ONEBridge is a Swift Actor that:
- Spawns Node.js process with bundled binary (`Resources/bin/node`)
- Manages request/response correlation using auto-incrementing IDs
- Uses CheckedContinuation for async/await bridging
- Handles process lifecycle (connect, disconnect, error recovery)
- Queues writes to prevent pipe corruption
- Buffers stdout reads to handle partial JSON-RPC messages

### JSON-RPC 2.0 Protocol

All methods map directly to IFileSystem interface:
- `initialize(instancePath)` - Setup filesystem
- `stat(path)` - Get metadata
- `readDir(path)` - List directory
- `readFile(path)` - Read file (returns base64)
- `readFileInChunks(path, length, position)` - Chunked read
- `createDir(path, mode)` - Create directory
- `createFile(path, fileHash, fileName, mode)` - Create file
- `unlink(path)` - Delete file
- `rmdir(path)` - Remove directory
- `rename(src, dest)` - Move/rename

Error codes follow JSON-RPC 2.0 spec (-32700 to -32603) plus custom codes (-32000 to -32004).

### Full IoM (Internet of Me) Configuration

one.provider is configured for **full IoM mode**, enabling complete incremental backup of peer data:

**Configuration** (`node-runtime/index.ts`):
- **IoM Mode**: `'full'` - Complete data replication (vs `'light'` which only establishes identity/communication)
- **PairingFileSystem**: Initialized with `'full'` mode for full backup capability
- **ConnectionsModel**:
  - `acceptIncomingConnections: true` - Accepts connections via CommServer relay
  - `establishOutgoingConnections: true` - Can initiate connections
  - `allowPairing: true` - Enables invite-based pairing
  - `noImport: false` - Import enabled (receives all peer data)
  - `noExport: false` - Export enabled (shares data with peers)
- **IoMManager**: Properly initialized with LeuteModel and CommServer URL
- **Filesystems mounted**: `/chats`, `/invites`, `/objects`, `/profiles`, `/questionnaires`, `/types`, `/debug`

**What this means**: When paired with another ONE instance via full IoM invitation, one.provider becomes a complete incremental backup, replicating all data from all channels of the peer.

**Note**: `/journal` filesystem is not currently mounted (JournalModel may change).

### App Group Configuration

**CRITICAL**: The app group identifier is **`group.one.filer`** (not `group.com.one.filer`).

**Container Location**: `~/Library/Group Containers/group.one.filer/`

**Configuration Files**:
- `domains.json` - Domain name to instance path mapping
- `status.json` - Domain connection status (written by extension)
- `logs/` - Debug logs directory

**Entitlements**:
- `Resources/OneFiler.entitlements` - Host app entitlements
- `Resources/Extension.entitlements` - Extension entitlements

Both must specify `group.one.filer` in `com.apple.security.application-groups` array.

**Known Issue**: An old `OneFilerExtension.entitlements` file with incorrect app group was removed. Always use files in `Resources/` directory.

### Status Monitoring

**Current State**: Status monitoring is **disabled** to avoid permission dialog loop.

The StatusMonitor polls App Group container every 2 seconds, which triggered macOS permission dialogs repeatedly. This has been temporarily disabled in `MenuBarApp.swift`:

```swift
// DISABLED: Start monitoring (causes permission dialog loop)
// statusMonitor.startMonitoring()
```

**To Re-enable**: Fix the permission check to only access container after initial permission is granted, then uncomment the line.

### Domain Registration Flow

1. **Application or user calls CLI tool** (`onefiler register --name NAME --path PATH`)
   - CLI locations:
     - After `swift build`: `.build/debug/onefiler`
     - After `create-app-bundle.sh`: `.build/debug/OneFiler.app/Contents/MacOS/onefiler`
     - After installing: `/Applications/OneFiler.app/Contents/MacOS/onefiler`
   - Can be called by any application or user

2. **CLI writes to App Group container**: `group.one.filer/domains.json`
   ```json
   {
     "domain-identifier": "/path/to/instance"
   }
   ```
   Container location: `~/Library/Group Containers/group.one.filer/`

3. **CLI calls `NSFileProviderManager.add()`** to register domain with macOS
4. **macOS creates mount point**: `~/Library/CloudStorage/OneFiler-{domain-identifier}/`
5. **User must enable** in System Settings → Privacy & Security → Extensions → File Provider
6. **Extension loads independently** on first access (not controlled by calling application)
7. **ONEBridge spawns Node.js** and reads config from App Group container
8. **Node.js server initializes** ONE instance and filesystems

### App Group Container

The extension communicates domain configuration via **App Group**:
- **Identifier**: `group.one.filer` (configured in `project.yml`)
- **Container location**: `~/Library/Group Containers/group.one.filer/`
- **Config file**: `domains.json` in container root

This allows the sandboxed extension to read domain mappings written by the CLI tool.

## Integration via CLI Tool

Applications can integrate with one.provider by calling the CLI tool:

```bash
# Any application can register a domain programmatically
/Applications/OneFiler.app/Contents/MacOS/onefiler register \
  --name "MyDomain" \
  --path "/path/to/one/instance"
```

**Example**: An application could call the CLI tool to register domains automatically on startup.

**Important Architectural Boundaries**:
- **CLI tool**: Can be called by any application to register domains
- **Extension**: Blackbox loaded by macOS, no application control once loaded
- **Node.js server**: Spawned by extension, independent of calling application

Once a domain is registered, the extension operates completely independently - applications have no control over when it loads, when it spawns Node.js, or how it operates.

**Integration pattern**:
```bash
# Application calls CLI to register domain
/Applications/OneFiler.app/Contents/MacOS/onefiler register \
  --name "domain-name" \
  --path "/path/to/instance"

# CLI writes config and calls macOS APIs
# Application's job is done - extension operates independently
```

## Development Workflow

### 0. Quick Development Cycle

For most development work:

```bash
# Full rebuild and install (handles everything)
./scripts/rebuild-and-install.sh

# Then test
ls ~/Library/CloudStorage/OneFiler-ONE-Test/
log stream --predicate 'subsystem == "one.filer"' --level debug
```

This is the recommended approach as it ensures:
- Node.js is properly bundled with ICU libraries
- ES module resolution works (`node_modules` naming)
- All dylib references are correctly updated
- Extension is installed with proper permissions

### 1. TypeScript Application Server Changes

```bash
# Option A: Let Xcode handle it (rebuilds automatically via pre-build script)
open OneFiler.xcodeproj  # Just hit Cmd+B

# Option B: Manual build (for SPM workflow or quick iteration)
npm run build
# Then rebuild in Xcode or kill extension: killall OneFilerExtension
```

### 2. Swift Extension Changes

```bash
# Option A: Build via Xcode (recommended, handles everything)
open OneFiler.xcodeproj  # Cmd+B
# Product: .build/debug/OneFiler.app or Derived Data

# Option B: SPM + manual bundle creation
npm run build && swift build && ./scripts/create-app-bundle.sh

# After building, reinstall if needed
./scripts/install-to-applications.sh

# Re-register domain (required after reinstall to /Applications)
/Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name test
/Applications/OneFiler.app/Contents/MacOS/onefiler register --name test --path ~/.refinio/instance

# Kill extension to force reload
killall fileproviderd
```

### 3. CLI Tool Changes

```bash
# Changes to Sources/OneFilerCLI/main.swift

# Option A: Build via Xcode (includes in app bundle)
open OneFiler.xcodeproj  # Cmd+B

# Option B: Quick iteration via SPM
swift build --product onefiler
.build/debug/onefiler list  # Test directly
```

### 4. XcodeGen Configuration Changes

```bash
# After editing project.yml
xcodegen generate
# Then rebuild in Xcode or via xcodebuild
```

### 5. Testing IPC Communication

```bash
# Test without full File Provider setup
npm run test:ipc

# This tests:
# - Node.js process spawning
# - JSON-RPC request/response
# - Basic filesystem operations (with stub data)
```

### 6. Full Integration Test

```bash
# Requires extension installed and enabled
npm run test:connection

# This tests:
# - Domain registration via CLI
# - Mount point creation
# - Extension loading
# - Reading files from mount
# - IPC communication end-to-end
```

## Debugging

### View Extension Logs

```bash
# Real-time logs (recommended - ONEBridge uses com.one.provider subsystem)
log stream --predicate 'subsystem == "one.filer"' --level debug

# Include File Provider daemon logs
log stream --predicate 'subsystem CONTAINS "FileProvider"' --level debug

# Watch all ONE-related logs
log stream --predicate 'subsystem CONTAINS "one"' --level debug

# Console.app (GUI)
open -a Console  # Filter by "one.filer"
```

### Check Extension Status

```bash
# List all File Provider extensions
pluginkit -m -v -p com.apple.fileprovider-nonui

# Check if OneFiler is registered (bundle ID: one.filer.extension)
pluginkit -m | grep one.filer

# View registered domains
/Applications/OneFiler.app/Contents/MacOS/onefiler list
# Or from build dir:
.build/debug/onefiler list
```

### Common Issues

**"Domain disabled" (Error FP -2011)**
- Extension is installed but user hasn't enabled it
- Fix: System Settings → Privacy & Security → Extensions → File Provider → Enable OneFiler

**"Server unreachable"**
- Node.js not in PATH for sandboxed extension
- Node.js process failed to spawn
- Check logs: `log show --predicate 'subsystem == "one.filer"' --last 5m`

**"Failed to read domain configuration"**
- Domain not registered via CLI tool
- App Group container path incorrect
- Fix: Re-register domain with correct path

**"Cannot find package '@refinio/one.core'"**
- Node.js cannot resolve ES modules
- Extension Resources has `node_modules_resolved` instead of `node_modules`
- ES modules don't use `NODE_PATH` - directory MUST be named `node_modules`
- Fix: Rename directory or use `./scripts/rebuild-and-install.sh`

**"dyld: Library not loaded: libicui18n"**
- Node.js ICU libraries not bundled or references not updated
- Fix: Run `./scripts/bundle-node.sh` then rebuild
- Verify: Check `Resources/dylibs/` contains ICU .dylib files

**IPC timeout / no response**
- Node.js process crashed
- Check crash logs: `ls -lt ~/Library/Logs/DiagnosticReports/ | grep node | head -5`
- Verify server builds: `npm run build && ls -l node-runtime/lib/index.js`

**Mount point doesn't appear**
- Domain registration failed
- Extension not code-signed properly
- Check: `ls -la ~/Library/CloudStorage/ | grep OneFiler`

### Kill Stuck Processes

```bash
# Kill File Provider extension
killall OneFilerExtension

# Restart File Provider daemon (restarts all extensions)
killall fileproviderd

# Kill all node processes (if server stuck)
killall node
```

## Code Signing

Code signing is configured in `project.yml` (XcodeGen):
- **Bundle IDs**:
  - Host app: `one.filer`
  - Extension: `one.filer.extension`
- **App Groups**: `group.one.filer`
- **Development Team**: Set in `project.yml` `settings.DEVELOPMENT_TEAM`

### Development (Automatic Signing via Xcode)

1. **Update your Team ID** in `project.yml`:
   ```yaml
   settings:
     DEVELOPMENT_TEAM: "YOUR_TEAM_ID"
   ```

2. **Regenerate Xcode project**:
   ```bash
   xcodegen generate
   ```

3. **Build in Xcode** - signing handled automatically:
   ```bash
   open OneFiler.xcodeproj  # Cmd+B
   # Or via command line:
   xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost
   ```

### Production (Release Configuration)

For distribution:
1. Update `CODE_SIGN_IDENTITY` in `project.yml` if needed
2. Build with Release configuration:
   ```bash
   xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Release
   ```

### Manual Signing (SPM-based Bundle)

The `create-app-bundle.sh` script uses **ad-hoc signing** by default:
- Works for local testing
- Extension may not load in production without proper signing
- For quick iteration on IPC communication

### Required Entitlements

Configured in `project.yml` and `Resources/*.entitlements`:
- **App Sandbox**: `com.apple.security.app-sandbox`
- **App Groups**: `group.one.filer`
- **File Provider**: `com.apple.security.files.user-selected.read-write` (extension only)
- **Network Client**: `com.apple.security.network.client` (allows Node.js to connect to CommServer)

## Vendored Dependencies

Dependencies exist in multiple locations for different purposes:

1. **Root directories** (`one.core/`, `one.models/`): Local development copies
2. **packages/** directory (`packages/one.core/`, `packages/one.models/`): For TypeScript path resolution (tsconfig.json paths)
3. **vendor/** directory: Tarballs for reproducible builds
   - `vendor/refinio-one.core-*.tgz`
   - `vendor/refinio-one.models-*.tgz`
4. **node-runtime/node_modules/@refinio/**: Extracted from vendor tarballs via `npm run vendor:install`
5. **Extension Resources/node_modules/**: Copied from node-runtime during Xcode build

**Why vendored?**
- File Provider extension runs in sandbox without access to npm registry
- Ensures reproducible builds with locked versions
- Reduces build complexity (no npm install in sandboxed environment)
- TypeScript compilation uses `packages/` via path mappings in tsconfig.json

### Updating Vendored Dependencies

To update one.core or one.models versions:

1. **Build updated packages** in their respective directories:
   ```bash
   cd ../one.core && npm run build && npm pack
   cd ../one.models && npm run build && npm pack
   ```

2. **Copy tarballs to vendor/**:
   ```bash
   cp ../one.core/refinio-one.core-*.tgz vendor/
   cp ../one.models/refinio-one.models-*.tgz vendor/
   ```

3. **Update local copies** (if using root-level directories for development):
   ```bash
   # Option A: Copy from parent directory
   rsync -av --delete ../one.core/ one.core/
   rsync -av --delete ../one.models/ one.models/

   # Option B: Symlink packages/ to root directories
   ln -sf ../one.core packages/one.core
   ln -sf ../one.models packages/one.models
   ```

4. **Update version in node-runtime/package.json** to match tarball versions

5. **Clean and reinstall**:
   ```bash
   cd node-runtime
   rm -rf node_modules
   npm run vendor:install
   cd ..
   ./scripts/rebuild-and-install.sh
   ```

## Project Structure

```
one.provider/
├── Sources/
│   ├── OneFiler/                      # File Provider extension library
│   │   ├── FileProviderExtension.swift    # NSFileProviderReplicatedExtension
│   │   ├── FileProviderItem.swift         # NSFileProviderItem wrapper
│   │   ├── FileProviderEnumerators.swift  # Directory enumeration
│   │   └── ONEBridge.swift                # IPC bridge actor
│   ├── OneFilerCLI/                   # CLI tool for domain management
│   │   └── main.swift
│   └── OneFilerHost/                  # Host app (minimal, required for .app bundle)
│       └── main.swift
├── Resources/                         # Xcode project resources
│   ├── Info.plist                         # Host app Info.plist
│   ├── ExtensionInfo.plist                # Extension Info.plist
│   ├── OneFiler.entitlements              # Host app entitlements
│   └── Extension.entitlements             # Extension entitlements
├── node-runtime/                      # Node.js application server
│   ├── index.ts                           # IPC bridge + ONE backend
│   ├── lib/                               # Compiled output (bundled in extension)
│   └── node_modules/                      # Extracted from vendor/ tarballs
│       └── @refinio/
│           ├── one.core/
│           └── one.models/
├── one.core/                          # ONE core library (local copy)
├── one.models/                        # ONE models library (local copy)
├── packages/                          # Package dependencies
│   ├── one.core/                          # Symlink or copy for TypeScript paths
│   ├── one.models/                        # Symlink or copy for TypeScript paths
│   └── connection.core/                   # Connection utilities
├── vendor/                            # Vendored dependency tarballs
│   ├── refinio-one.core-*.tgz
│   └── refinio-one.models-*.tgz
├── test/
│   ├── ipc-bridge-test.js                 # IPC communication test
│   └── integration/
│       └── connection-test.js             # End-to-end test
├── scripts/
│   ├── rebuild-and-install.sh             # Complete rebuild and install
│   ├── bundle-node.sh                     # Bundle Node.js + ICU libs
│   ├── create-app-bundle.sh               # Build complete .app bundle (SPM-based)
│   └── install-to-applications.sh         # Install to /Applications
├── project.yml                        # XcodeGen configuration
├── OneFiler.xcodeproj/                # Generated Xcode project (via XcodeGen)
├── Package.swift                      # Swift Package Manager config
├── package.json                       # Node.js config
└── tsconfig.json                      # TypeScript config
```

## Distribution

For distributing one.provider to users, see **DISTRIBUTION.md** for the complete guide.

### Quick Distribution Build

```bash
# Prerequisites:
# 1. Apple Developer Account with Developer ID certificate installed
# 2. Notarization credentials configured

# Set up credentials
export NOTARIZATION_APPLE_ID="your@apple.id"
export NOTARIZATION_PASSWORD="app-specific-password"

# Build signed, notarized package
./scripts/build-distribution.sh
```

**Output:**
- `dist/OneFiler-1.0.0.dmg` - Disk image for drag-and-drop installation
- `dist/OneFiler-1.0.0.pkg` - Package installer

### Distribution Requirements

- ✅ **Developer ID Application certificate** (not Apple Development)
- ✅ **Hardened Runtime** enabled
- ✅ **Code signed** with timestamp
- ✅ **Notarized** by Apple
- ✅ **Stapled** notarization ticket
- ✅ All bundled binaries signed (Node.js, CLI, extension)

### Key Differences from Development Build

| Aspect | Development | Distribution |
|--------|-------------|--------------|
| Certificate | Apple Development | Developer ID Application |
| Hardened Runtime | Optional | Required |
| Notarization | Not required | Required for macOS 10.15+ |
| Installation | Manual copy | DMG or PKG installer |
| Gatekeeper | May show warnings | No warnings |

See DISTRIBUTION.md for detailed instructions, troubleshooting, and security considerations.

## References

- **IFileSystem interface**: `one.models/src/fileSystems/IFileSystem.ts`
- **Apple File Provider docs**: https://developer.apple.com/documentation/fileprovider
- **XcodeGen docs**: https://github.com/yonaskolb/XcodeGen
- **Specification**: `specs/001-apple-file-provider/`
- **Status docs**: STATUS.md, INTEGRATION.md, NEXT_STEPS.md (historical context)
- **Distribution**: DISTRIBUTION.md (signing, notarization, packaging)
