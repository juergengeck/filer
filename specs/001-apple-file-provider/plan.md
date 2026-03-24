# Implementation Plan: Apple File Provider Integration

**Branch**: `001-apple-file-provider` | **Date**: 2025-10-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-apple-file-provider/spec.md`

## Summary

Implement a native macOS/iOS File Provider extension (one.provider) that exposes refinio ONE storage through Finder/Files app, following the architectural patterns established in one.fuse3 (Linux) and one.projfs (Windows). The implementation leverages Apple's NSFileProviderReplicatedExtension API with Swift 5.9, integrating with one.core (content-addressed object storage) and one.models (file system abstractions) as the data foundation. Prior work in one.filer.mac provides a starting point with domain management and basic File Provider scaffolding.

## Technical Context

**Language/Version**: Swift 5.9+, macOS 13.0+ (Ventura), iOS 16.0+
**Primary Dependencies**:
- Apple FileProvider framework (NSFileProviderReplicatedExtension)
- SwiftUI (for management UI)
- one.core 0.6.1-beta-2 (TypeScript/Node.js - content-addressed storage)
- one.models 14.1.0-beta-4 (TypeScript/Node.js - file system abstractions)

**Storage**: Content-addressed object storage via one.core (SHA-256 hashing), TypeScript/Node.js runtime
**Testing**: XCTest (Swift unit/integration tests), Jest (TypeScript integration tests for Node.js bridge)
**Target Platform**: macOS 13.0+ (Ventura), iOS 16.0+ (architecture-agnostic, supports Apple Silicon and Intel)
**Project Type**: Native Apple platform application with File Provider extension (hybrid Swift + TypeScript)
**Performance Goals**:
- File listings: <3s for 1000 items
- Navigation: <2s to File Provider location
- File operations: <5s for files under 10MB
- Thumbnail generation: <2s for standard image formats
- Concurrent operations: 10+ without UI blocking

**Constraints**:
- File Provider extension runs in separate process with limited resources
- Must handle synchronous metadata requests with cached data
- Extension lifecycle managed by system (can be terminated at any time)
- Inter-process communication required between main app and extension
- Network operations must not block File Provider callbacks
- Offline queue required for operations during network unavailability

**Scale/Scope**:
- Support 10,000+ files per folder with pagination
- Handle file sizes from bytes to multi-GB (progressive loading)
- Support concurrent operations from multiple applications accessing files
- Multi-domain support (multiple ONE instances simultaneously)

**Integration Architecture**:
- Swift File Provider Extension → Swift/Actor Bridge (ONEBridge) → [NEEDS CLARIFICATION: Node.js IPC mechanism] → one.models (TypeScript) → one.core (TypeScript)

**Reference Implementations**:
- `/Users/gecko/src/filer/one.fuse3` - Linux FUSE3 implementation (C++ N-API bridge to Node.js)
- `/Users/gecko/src/filer/one.projfs` - Windows ProjFS implementation (C++ N-API with ContentCache pattern)
- `/Users/gecko/src/filer/one.filer.mac` - Existing macOS work (Swift, partial implementation)

**Unknowns Requiring Research**:
- [NEEDS CLARIFICATION: Swift ↔ Node.js bridge mechanism - XPC, subprocess with JSON-RPC, embedded JavaScript engine (JavaScriptCore), or compile one.core to native?]
- [NEEDS CLARIFICATION: Caching strategy - emulate one.projfs ContentCache in Swift, or rely on File Provider system caching?]
- [NEEDS CLARIFICATION: Change tracking - how to sync one.core mutations to File Provider sync anchors and NSFileProviderItemVersion?]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: Constitution file contains only template placeholders, no actual project principles defined. Proceeding with standard software engineering principles and patterns established in reference implementations.

**Assumed Principles** (based on user's CLAUDE.md and codebase patterns):
- ✓ **Fail Fast**: No fallbacks or delays - throw errors and fix root causes
- ✓ **Use What You Have**: Leverage existing one.core, one.models, and reference implementation patterns
- ✓ **Type Safety**: Use branded types (SHA256Hash, SHA256IdHash) consistently
- ✓ **Pattern Consistency**: Follow IFileSystem interface pattern from one.fuse3/one.projfs

**No violations detected** - implementation follows established patterns from Windows/Linux implementations.

## Project Structure

### Documentation (this feature)

```
specs/001-apple-file-provider/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
one.provider/                          # NEW: Target package for implementation
├── Package.swift                       # Swift Package Manager configuration
├── Sources/
│   ├── OneProviderApp/                # Main management application
│   │   ├── OneProviderApp.swift       # SwiftUI app entry point
│   │   ├── ContentView.swift          # Main UI
│   │   ├── AddDomainView.swift        # Add ONE instance UI
│   │   └── DomainManager.swift        # Domain lifecycle management
│   ├── OneProviderExtension/          # File Provider extension (sandboxed process)
│   │   ├── FileProviderExtension.swift         # NSFileProviderReplicatedExtension subclass
│   │   ├── FileProviderItem.swift              # NSFileProviderItem implementation
│   │   ├── FileProviderEnumerators.swift       # Folder enumeration
│   │   └── FileProviderChangeObserver.swift    # Change tracking
│   └── OneProviderCore/               # Shared core library
│       ├── ONEBridge.swift            # Swift ↔ Node.js bridge (Actor-based)
│       ├── Models/
│       │   ├── FileItem.swift         # File metadata
│       │   ├── FolderItem.swift       # Folder metadata
│       │   └── OperationQueue.swift   # Offline operation queue
│       ├── Cache/
│       │   ├── MetadataCache.swift    # In-memory metadata cache
│       │   └── ContentCache.swift     # On-disk content cache
│       └── IPC/
│           ├── NodeIPCBridge.swift    # IPC to Node.js runtime
│           └── IPCProtocol.swift      # Message protocol definitions
├── Tests/
│   ├── OneProviderCoreTests/
│   │   ├── ONEBridgeTests.swift
│   │   ├── CacheTests.swift
│   │   └── IPCTests.swift
│   └── OneProviderIntegrationTests/
│       └── FileProviderIntegrationTests.swift
├── Resources/
│   ├── Info.plist
│   └── Entitlements.entitlements
└── node-runtime/                      # Bundled Node.js runtime + dependencies
    ├── package.json
    ├── index.js                       # IPC server entry point
    └── node_modules/
        ├── one.core/                  # Vendored/linked
        └── one.models/                # Vendored/linked

one.filer.mac/                         # EXISTING: Reference and prior work
├── (use as reference for patterns)
└── packages/                          # Vendored dependencies
    ├── one.core/                      # 0.6.1-beta-2
    ├── one.models/                    # 14.1.0-beta-4
    └── one.leute.replicant/

one.core/                              # EXISTING: Foundation database
└── (external TypeScript package)

one.models/                            # EXISTING: File system abstractions
└── (external TypeScript package)

one.fuse3/                             # EXISTING: Linux reference
└── (C++ N-API bridge pattern reference)

one.projfs/                            # EXISTING: Windows reference
└── (ContentCache + AsyncBridge pattern reference)
```

**Structure Decision**: Native Apple platform application following the Mobile + API pattern (Option 3 adapted). The implementation consists of:
1. **one.provider** package (Swift) - Main implementation with File Provider extension
2. **node-runtime** embedded subprocess - one.core/one.models runtime accessed via IPC
3. Follows the architectural pattern from one.projfs (native platform layer + Node.js backend)

The one.provider directory will be the primary development location, with one.filer.mac serving as reference material for Swift patterns and UI components.

## Complexity Tracking

*No violations requiring justification - constitution file is template-only.*

**Design Decisions Requiring Justification**:

| Decision | Rationale | Alternative Considered |
|----------|-----------|------------------------|
| Swift + Node.js hybrid | one.core and one.models are TypeScript/Node.js; rewriting in Swift would duplicate 100K+ LOC and diverge from canonical implementation | Native Swift rewrite rejected: massive engineering effort, would diverge from Linux/Windows implementations, lose one.core's battle-tested content-addressing |
| NSFileProviderReplicatedExtension | Modern Apple File Provider API (macOS 13+) with built-in sync anchor support, replaces deprecated NSFileProviderExtension | Legacy API rejected: deprecated in macOS 13, lacks modern sync features, poor performance |
| Actor-based ONEBridge | Swift concurrency model (async/await + Actor) provides thread-safe access to IPC without locks | GCD/OperationQueue rejected: more complex, error-prone threading, worse composability with modern Swift |
| Separate extension process | Required by Apple's File Provider architecture for security/stability | Monolithic app rejected: not supported by FileProvider framework, would fail App Store review |
