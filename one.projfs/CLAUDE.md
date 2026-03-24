# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**one.projfs** is a native Node.js addon that bridges the ONE platform's IFileSystem interface to Windows Projected File System (ProjFS). It enables ONE database content to be exposed as a native Windows virtual drive, allowing users to browse ONE content (chats, objects, files) in Windows Explorer.

This module replaces a complex 7-layer abstraction stack with a clean 2-layer architecture, providing 10-100x performance improvements for file operations.

## Key Commands

### Building the Native Addon

```bash
# Install dependencies and build native C++ addon
npm install

# The build happens automatically via node-gyp during npm install
# To rebuild manually:
npx node-gyp rebuild

# Clean build artifacts
npx node-gyp clean
```

**Build Requirements**:
- Windows 10 version 1809 or later
- Windows SDK with ProjFS headers (ProjectedFSLib.h)
- Visual Studio 2019 or later
- Node.js 14+
- ProjFS feature enabled: `Enable-WindowsOptionalFeature -Online -FeatureName Client-ProjFS -NoRestart`

### Testing

```bash
# Run integration test (requires refinio.api built)
node test/integration/connection-test.js

# The integration test:
# 1. Starts refinio.api with ProjFS mount
# 2. Verifies ProjFS exposes invite files
# 3. Tests connection establishment via invites
# 4. Verifies bidirectional contact creation
# 5. Cleans up and unmounts

# Environment variables for testing
ONE_FILER_MOUNT=C:\OneFiler-Test  # Override default mount point
```

**Important**: The integration test requires `refinio.api` to be built at `../refinio.api` (relative to this package).

## Architecture

### Layer Structure

**Before (7-layer stack)**:
```
Windows Explorer → ProjFS → projfs-fuse.one → FUSE emulation
→ FuseApiToIFileSystemAdapter → IFileSystemToProjFSAdapter
→ IFileSystem → ONE Models
```

**After (2-layer architecture)**:
```
Windows Explorer → ProjFS → one.projfs → IFileSystem → ONE Models
```

### Core Components

**C++ Native Module** (`src/`):
- `projfs_provider.cpp/h` - Main ProjFS integration, implements Windows ProjFS callbacks
- `async_bridge.cpp/h` - Bridges synchronous ProjFS callbacks to async JavaScript IFileSystem calls
- `content_cache.cpp/h` - Thread-safe in-memory cache for file metadata and content
- `sync_storage.cpp/h` - Direct disk access for BLOB/CLOB files (images, PDFs)
- `ifsprojfs_bridge.cpp` - N-API bindings connecting C++ to JavaScript

**JavaScript Wrapper** (`IFSProjFSProvider.js`):
- Wraps native module with EventEmitter
- Implements IFileSystem callback handlers (getFileInfo, readFile, readDirectory, createFile)
- Provides logging and path normalization
- Main entry point for ONE platform integration

**TypeScript Definitions** (`index.d.ts`, `IFSProjFSProvider.d.ts`):
- Type definitions for IFileSystem interface compatibility
- Ensures type safety when integrating with ONE platform

### ERROR_IO_PENDING Pattern

ProjFS requires **synchronous** responses from callbacks, but IFileSystem is **asynchronous**. The module solves this with:

1. **Cache-First Strategy**: On file/directory access, check cache and return immediately if available
2. **Pending Command Tracking**: If content not in cache, return `ERROR_IO_PENDING` and store command details (CommandId, virtualization context, GUID)
3. **Background Fetch**: AsyncBridge triggers JavaScript IFileSystem fetch in background
4. **Command Completion**: When content arrives, call `PrjCompleteCommand` with 4-parameter signature to resume Windows operation
5. **User Experience**: Windows Explorer shows loading indicator, then displays content seamlessly

**Key Implementation Details**:
- `GetFileDataCallback` returns `ERROR_IO_PENDING` on cache miss (`projfs_provider.cpp:300-350`)
- Pending requests stored in thread-safe map: `std::unordered_map<INT32, PendingFileRequest>`
- `CompletePendingFileRequests` method completes commands when content is available
- Uses correct `PrjCompleteCommand(context, commandId, dataHr, nullptr)` signature (4 params, not 3)

### Hybrid Content Delivery

- **BLOBs/CLOBs**: Direct disk reads from instance storage via SyncStorage (no async overhead)
- **Metadata**: Async JavaScript callbacks to IFileSystem (directory listings, file stats)
- **Caching**: In-memory cache provides sync responses while background updates maintain freshness

## Integration with ONE Platform

### Usage in one.filer

```javascript
import { IFSProjFSProvider } from '@refinio/one.projfs';
import { CombinedFileSystem } from '@refinio/one.models/lib/fileSystems/CombinedFileSystem.js';

// Create combined filesystem
const rootFS = new CombinedFileSystem([
    new ChatFileSystem(leuteModel, topicModel, channelManager),
    new ObjectsFileSystem(),
    new DebugFileSystem(instance),
    new TypesFileSystem()
]);

// Mount via ProjFS
const provider = new IFSProjFSProvider({
    instancePath: 'C:/data/instance-hash',  // Where BLOBs/objects are stored
    virtualRoot: 'C:\\OneFiler',            // Mount point in Windows Explorer
    fileSystem: rootFS,
    debug: false
});

// Register callbacks (required before start)
provider.registerCallbacks({
    getFileInfo: async (path) => { /* return FileInfo */ },
    readFile: async (path) => { /* return Buffer */ },
    readDirectory: async (path) => { /* return FileInfo[] */ },
    createFile: async (path, content) => { /* create file */ }
});

await provider.start('C:\\OneFiler');
// Users can now browse ONE content in Explorer at C:\OneFiler

await provider.stop();
```

### What Users See

When mounted, users see a virtual Windows drive:
```
C:\OneFiler\
├── chats/              # From ChatFileSystem
│   ├── person@example.com/
│   │   └── general/
│   │       ├── message1.txt
│   │       └── message2.txt
├── objects/            # From ObjectsFileSystem (raw ONE objects)
├── debug/              # From DebugFileSystem (connections, instance info)
├── invites/            # From PairingFileSystem (invitation files)
└── types/              # From TypesFileSystem (recipe definitions)
```

## Build System

**binding.gyp** defines the native build configuration:
- Target: `ifsprojfs.node` (native addon)
- Sources: All `.cpp` files in `src/`
- Libraries: `ProjectedFSLib.lib` (Windows ProjFS)
- Compiler: C++17 with exceptions enabled
- Platform: Windows only (`_WIN32_WINNT=0x0A00`)

**Build Output**:
- Native addon: `build/Release/ifsprojfs.node`
- Loaded by JavaScript via `require('./build/Release/ifsprojfs.node')`

## Thread Safety

All cache operations use read-write locks (`std::shared_mutex`) for thread safety:
- Multiple readers can access cache simultaneously
- Writers get exclusive access
- JavaScript callbacks use N-API's ThreadSafeFunction for safe cross-thread calls
- Pending requests map protected by `std::mutex`

## Performance Characteristics

| Operation | Old 7-Layer Stack | one.projfs | Improvement |
|-----------|-------------------|------------|-------------|
| BLOB read | 5-20ms | <1ms | 10-20x |
| Directory list | 10-50ms | 1-5ms | 5-10x |
| Metadata (cached) | 5-15ms | <0.1ms | 50-150x |
| File open | 20-100ms | 5-10ms | 4-10x |

## Troubleshooting

### ProjFS Not Available
```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Client-ProjFS -NoRestart
```

### Build Failures
- Ensure Windows SDK is installed with ProjFS headers
- Check Visual Studio 2019+ is available
- Verify node-gyp can find Visual Studio: `npx node-gyp configure`

### Native Module Load Failures
- Rebuild for correct Node.js version: `npx node-gyp rebuild`
- Check `build/Release/ifsprojfs.node` exists
- Verify Windows architecture matches Node.js (x64 vs x86)

### Mount Failures
- Ensure mount point directory doesn't exist or is empty
- Check ProjFS feature is enabled
- Verify no other process is using the mount point
- Look for Windows Event Log entries (Application log)

### Performance Issues
The module tracks statistics accessible via `provider.getStats()`:
- `cacheHits` / `cacheMisses` - Cache effectiveness
- `fileDataRequests` - File read operations
- `directoryEnumerations` - Directory listing operations
- `bytesRead` - Total data transferred

## Key Files Reference

- `src/projfs_provider.cpp:300-350` - ERROR_IO_PENDING implementation in GetFileDataCallback
- `src/projfs_provider.cpp:360-449` - Command completion with PrjCompleteCommand
- `src/projfs_provider.h:149-157` - PendingFileRequest struct definition
- `IFSProjFSProvider.js:76-82` - JavaScript callback registration
- `test/integration/connection-test.js` - Full integration test workflow
- `ERROR_IO_PENDING_IMPLEMENTATION.md` - Detailed documentation of async pattern
