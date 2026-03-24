# Implementation Tasks: Apple File Provider Integration

**Feature Branch**: `001-apple-file-provider`
**Date**: 2025-10-17
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Overview

This document provides a dependency-ordered task breakdown for implementing the Apple File Provider integration (one.provider). Tasks are organized by user story to enable independent, incremental delivery following the pattern established by one.fuse3 (Linux) and one.projfs (Windows).

**Total Estimated Tasks**: 85
**MVP Scope**: User Story 1 only (25 tasks) - File System Access

---

## Implementation Strategy

### Incremental Delivery

Each user story is independently testable and delivers value:
1. **US1 (P1)**: File System Access - Users can browse files in Finder
2. **US2 (P2)**: File Operations - Users can create, rename, move, delete files
3. **US3 (P3)**: File Content Access - Users can open/edit files in external apps
4. **US4 (P4)**: Metadata & Thumbnails - Enhanced visual experience

### Parallel Execution Opportunities

Tasks marked with `[P]` can be executed in parallel with other `[P]` tasks **within the same phase**.

---

## Phase 1: Setup & Project Initialization

**Goal**: Create the one.provider package structure and configure build system.

**Duration**: ~2 hours

### Tasks

- [ ] T001 Create one.provider directory at /Users/gecko/src/filer/one.provider
- [ ] T002 Create Package.swift with Swift 5.9 configuration for macOS 13.0+ target
- [ ] T003 [P] Create Sources/OneProviderApp directory for management UI
- [ ] T004 [P] Create Sources/OneProviderExtension directory for File Provider extension
- [ ] T005 [P] Create Sources/OneProviderCore directory for shared library
- [ ] T006 [P] Create Tests/OneProviderCoreTests directory for unit tests
- [ ] T007 [P] Create node-runtime directory for Node.js IPC server
- [ ] T008 Create node-runtime/package.json with one.core and one.models dependencies
- [ ] T009 Link or vendor one.core 0.6.1-beta-2 in node-runtime/node_modules/
- [ ] T010 Link or vendor one.models 14.1.0-beta-4 in node-runtime/node_modules/
- [ ] T011 Create .gitignore for Swift build artifacts and node_modules
- [ ] T012 Verify swift build compiles successfully from one.provider directory

---

## Phase 2: Foundation - IPC Bridge

**Goal**: Establish Swift ↔ Node.js communication via JSON-RPC over stdin/stdout.

**Dependencies**: Phase 1 complete
**Duration**: ~8 hours

**Independent Test**: Can send JSON-RPC request from Swift and receive response from Node.js.

### Tasks

#### Node.js IPC Server

- [ ] T013 Create node-runtime/index.js with JSON-RPC 2.0 message parser
- [ ] T014 [P] Implement initialize() method in node-runtime/index.js per contracts/node-ipc-jsonrpc.md
- [ ] T015 [P] Implement getObject() method in node-runtime/index.js
- [ ] T016 [P] Implement getChildren() method with pagination in node-runtime/index.js
- [ ] T017 [P] Implement getContent() method with chunking in node-runtime/index.js
- [ ] T018 Add error handling with standard JSON-RPC error codes (-32000 to -32005) in node-runtime/index.js
- [ ] T019 Add stdin readline parser and stdout JSON writer in node-runtime/index.js
- [ ] T020 Test node-runtime/index.js standalone with echo commands

#### Swift IPC Bridge

- [ ] T021 Create Sources/OneProviderCore/IPC/IPCProtocol.swift with JSON-RPC message types
- [ ] T022 Implement JSONRPCRequest/Response/Error Codable structs in IPCProtocol.swift
- [ ] T023 Create Sources/OneProviderCore/IPC/NodeIPCBridge.swift with Process management
- [ ] T024 Implement spawn() method to launch Node.js subprocess in NodeIPCBridge.swift
- [ ] T025 Implement send() method for JSON-RPC requests in NodeIPCBridge.swift
- [ ] T026 Implement receive() method for JSON-RPC responses with ID matching in NodeIPCBridge.swift
- [ ] T027 Implement notification handling for onChange events in NodeIPCBridge.swift
- [ ] T028 Add process crash detection and recovery in NodeIPCBridge.swift
- [ ] T029 Create Tests/OneProviderCoreTests/NodeIPCBridgeTests.swift with spawn/send/receive tests

#### High-Level Bridge Actor

- [ ] T030 Create Sources/OneProviderCore/ONEBridge.swift as Actor
- [ ] T031 Implement initialize(instancePath:) async method wrapping IPC initialize in ONEBridge.swift
- [ ] T032 Implement getObject(hash:) async method in ONEBridge.swift
- [ ] T033 Implement getChildren(hash:offset:limit:) async method in ONEBridge.swift
- [ ] T034 Implement getContent(hash:offset:length:) async method in ONEBridge.swift
- [ ] T035 Add error mapping from JSON-RPC errors to Swift errors in ONEBridge.swift
- [ ] T036 Create Tests/OneProviderCoreTests/ONEBridgeTests.swift with mock IPC tests

---

## Phase 3: User Story 1 - File System Access (P1)

**Goal**: Users can browse refinio ONE files and folders in Finder/Files app.

**Dependencies**: Phase 2 complete
**Duration**: ~12 hours

**Independent Test**: Navigate to File Provider location in Finder, view root folder structure, browse folders with files displaying correct names and basic metadata.

### Tasks

#### Data Models

- [ ] T037 [US1] Create Sources/OneProviderCore/Models/SHA256Hash.swift as branded type with validation
- [ ] T038 [US1] Create Sources/OneProviderCore/Models/FileItem.swift struct per data-model.md
- [ ] T039 [US1] Create Sources/OneProviderCore/Models/FolderItem.swift struct per data-model.md
- [ ] T040 [US1] Create Sources/OneProviderCore/Models/ProviderDomain.swift struct per data-model.md
- [ ] T041 [US1] Add Codable conformance to all model types
- [ ] T042 [US1] Create Tests/OneProviderCoreTests/ModelsTests.swift with validation tests

#### Metadata Cache

- [ ] T043 [US1] Create Sources/OneProviderCore/Cache/MetadataCache.swift as Actor
- [ ] T044 [US1] Implement get/set/invalidate methods in MetadataCache.swift
- [ ] T045 [US1] Add TTL-based expiration (5 minutes) in MetadataCache.swift
- [ ] T046 [US1] Implement prefetch() batch method in MetadataCache.swift
- [ ] T047 [US1] Create Tests/OneProviderCoreTests/MetadataCacheTests.swift

#### File Provider Extension

- [ ] T048 [US1] Create Sources/OneProviderExtension/FileProviderExtension.swift extending NSFileProviderReplicatedExtension
- [ ] T049 [US1] Implement init(domain:) in FileProviderExtension.swift
- [ ] T050 [US1] Implement item(for identifier:request:) returning NSFileProviderItem in FileProviderExtension.swift
- [ ] T051 [US1] Create Sources/OneProviderExtension/FileProviderItem.swift implementing NSFileProviderItem
- [ ] T052 [US1] Map FileItem/FolderItem to NSFileProviderItem properties in FileProviderItem.swift
- [ ] T053 [US1] Create Sources/OneProviderExtension/FileProviderEnumerators.swift
- [ ] T054 [US1] Implement RootEnumerator for root folder enumeration in FileProviderEnumerators.swift
- [ ] T055 [US1] Implement FolderEnumerator for subfolder enumeration in FileProviderEnumerators.swift
- [ ] T056 [US1] Add pagination support (100 items per page) in enumerators
- [ ] T057 [US1] Implement enumerator(for containerItemIdentifier:request:) in FileProviderExtension.swift

#### Management App

- [ ] T058 [US1] Create Sources/OneProviderApp/OneProviderApp.swift with SwiftUI @main
- [ ] T059 [US1] Create Sources/OneProviderApp/ContentView.swift with domain list UI
- [ ] T060 [US1] Create Sources/OneProviderApp/AddDomainView.swift with form (name, instance path)
- [ ] T061 [US1] Create Sources/OneProviderApp/DomainManager.swift for NSFileProviderManager operations
- [ ] T062 [US1] Implement addDomain() method in DomainManager.swift
- [ ] T063 [US1] Implement removeDomain() method in DomainManager.swift
- [ ] T064 [US1] Store domain configuration in shared UserDefaults between app and extension

#### Integration

- [ ] T065 [US1] Add FileProvider.framework to Package.swift dependencies
- [ ] T066 [US1] Create Info.plist for OneProviderExtension with NSExtension keys
- [ ] T067 [US1] Create Entitlements.entitlements with com.apple.security.files.provider capability
- [ ] T068 [US1] Configure code signing for both app and extension targets
- [ ] T069 [US1] Build and run OneProviderApp, verify it launches without errors
- [ ] T070 [US1] Add test domain via UI, verify domain appears in Finder sidebar
- [ ] T071 [US1] Click domain in Finder, verify root folder enumerates and displays files/folders
- [ ] T072 [US1] Navigate into subfolder, verify children enumerate correctly
- [ ] T073 [US1] Verify file metadata (name, size, date) displays in Finder list view

**✓ Milestone**: US1 Complete - Users can browse files in Finder

---

## Phase 4: User Story 2 - File Operations (P2)

**Goal**: Users can create, rename, move, and delete files through Finder/Files app.

**Dependencies**: User Story 1 complete
**Duration**: ~10 hours

**Independent Test**: Drag file into Finder location (upload), rename file, move file to different folder, delete file, verify all operations persist in ONE storage.

### Tasks

#### IPC Operations (Node.js)

- [ ] T074 [US2] Implement createObject() method in node-runtime/index.js per contracts
- [ ] T075 [US2] Implement updateObject() method for rename in node-runtime/index.js
- [ ] T076 [US2] Implement deleteObject() method with recursive support in node-runtime/index.js
- [ ] T077 [US2] Implement moveObject() method in node-runtime/index.js
- [ ] T078 [US2] Test all write operations standalone via echo commands

#### Swift Bridge Operations

- [ ] T079 [US2] Implement createObject() async method in ONEBridge.swift
- [ ] T080 [US2] Implement updateObject() async method in ONEBridge.swift
- [ ] T081 [US2] Implement deleteObject() async method in ONEBridge.swift
- [ ] T082 [US2] Implement moveObject() async method in ONEBridge.swift

#### File Provider Operations

- [ ] T083 [US2] Implement createItem(basedOn:fields:contents:options:request:) in FileProviderExtension.swift
- [ ] T084 [US2] Implement modifyItem(identifier:baseVersion:changedFields:contents:options:request:) in FileProviderExtension.swift
- [ ] T085 [US2] Implement deleteItem(identifier:baseVersion:options:request:) in FileProviderExtension.swift
- [ ] T086 [US2] Implement reparentItem(identifier:toParentItemWithIdentifier:newName:options:request:) for move in FileProviderExtension.swift
- [ ] T087 [US2] Add progress reporting for create/upload operations
- [ ] T088 [US2] Add error handling with NSFileProviderError codes

#### Offline Queue

- [ ] T089 [US2] Create Sources/OneProviderCore/Models/FileOperation.swift per data-model.md
- [ ] T090 [US2] Create Sources/OneProviderCore/Models/OperationQueue.swift as Actor
- [ ] T091 [US2] Implement enqueue() method with persistence in OperationQueue.swift
- [ ] T092 [US2] Implement processQueue() async method with retry logic in OperationQueue.swift
- [ ] T093 [US2] Store queue in UserDefaults or SQLite in NSFileProviderDomain storage location
- [ ] T094 [US2] Integrate OperationQueue into FileProviderExtension for offline operations

#### Testing

- [ ] T095 [US2] Test create: Drag file from Desktop into Finder location, verify upload
- [ ] T096 [US2] Test rename: Right-click file → Rename, verify change persists
- [ ] T097 [US2] Test move: Drag file to different folder, verify new location
- [ ] T098 [US2] Test delete: Move file to Trash, verify removal from ONE storage
- [ ] T099 [US2] Test offline: Disable network, perform operations, verify queue, re-enable network, verify sync
- [ ] T100 [US2] Test error: Attempt operation that fails, verify clear error message in Finder

**✓ Milestone**: US2 Complete - Users can manipulate files

---

## Phase 5: User Story 3 - File Content Access (P3)

**Goal**: Users can open/edit files in external applications with automatic sync.

**Dependencies**: User Story 2 complete
**Duration**: ~8 hours

**Independent Test**: Double-click file in Finder, edit in TextEdit/Preview, save, verify changes persist in ONE storage.

### Tasks

#### Content Fetching

- [ ] T101 [US3] Implement fetchContents(for itemIdentifier:version:request:) in FileProviderExtension.swift
- [ ] T102 [US3] Add progressive download for large files (>10MB) with chunking
- [ ] T103 [US3] Use File Provider's built-in content cache (NSFileProviderDomain storage location)
- [ ] T104 [US3] Implement content eviction policy based on last access time

#### Content Writing

- [ ] T105 [US3] Handle write operations from external apps via modifyItem with contents URL
- [ ] T106 [US3] Upload modified content to ONE storage via IPC
- [ ] T107 [US3] Update FileItem version identifier after successful write

#### Change Tracking

- [ ] T108 [US3] Create Sources/OneProviderCore/Models/ChangeEvent.swift per data-model.md
- [ ] T109 [US3] Create Sources/OneProviderCore/Cache/ChangeTracker.swift as Actor
- [ ] T110 [US3] Implement recordChange() with UInt64 version counter in ChangeTracker.swift
- [ ] T111 [US3] Implement changes(since:) returning delta in ChangeTracker.swift
- [ ] T112 [US3] Implement currentSyncAnchor() encoding version to NSFileProviderSyncAnchor
- [ ] T113 [US3] Store change log in SQLite in NSFileProviderDomain storage location
- [ ] T114 [US3] Integrate ChangeTracker into FileProviderExtension
- [ ] T115 [US3] Subscribe to onChange notifications from Node.js IPC
- [ ] T116 [US3] Call NSFileProviderManager.signalEnumerator() on remote changes
- [ ] T117 [US3] Create Sources/OneProviderExtension/FileProviderChangeObserver.swift
- [ ] T118 [US3] Implement changeObserver(with request:) in FileProviderExtension.swift

#### Testing

- [ ] T119 [US3] Test open: Double-click file, verify opens in default app
- [ ] T120 [US3] Test edit: Modify file in TextEdit, save, verify content updates in ONE
- [ ] T121 [US3] Test large file: Open 50MB file, verify progressive download
- [ ] T122 [US3] Test offline edit: Edit file offline, re-enable network, verify sync
- [ ] T123 [US3] Test concurrent edit: Edit same file in two apps, verify conflict handling (last-write-wins)
- [ ] T124 [US3] Test external change: Modify file via another client, verify Finder refreshes

**✓ Milestone**: US3 Complete - Users can seamlessly edit files

---

## Phase 6: User Story 4 - Metadata & Thumbnails (P4)

**Goal**: Enhanced visual experience with thumbnails and rich metadata.

**Dependencies**: User Story 3 complete
**Duration**: ~6 hours

**Independent Test**: View files in icon/gallery view, verify thumbnails display for images/documents.

### Tasks

#### Thumbnail Generation

- [ ] T125 [US4] Create Sources/OneProviderCore/Models/ThumbnailData.swift per data-model.md
- [ ] T126 [US4] Implement generateThumbnail(for item:) using QLThumbnailGenerator in FileProviderExtension.swift
- [ ] T127 [US4] Add thumbnail caching with 7-day expiration in NSFileProviderDomain storage
- [ ] T128 [US4] Implement invalidation on file modification (check generatedAt vs modifiedAt)
- [ ] T129 [US4] Implement fetchThumbnails(for itemIdentifiers:size:) in FileProviderExtension.swift
- [ ] T130 [US4] Return nil for unsupported types, let File Provider use default icons

#### Rich Metadata

- [ ] T131 [US4] Implement contentType property with UTType detection in FileProviderItem.swift
- [ ] T132 [US4] Map MIME types from ONE objects to UTType identifiers
- [ ] T133 [US4] Add document identifier and file system flags to FileProviderItem
- [ ] T134 [US4] Implement typeIdentifier property for proper icon selection

#### Testing

- [ ] T135 [US4] Test thumbnails: View image files in icon view, verify previews generate
- [ ] T136 [US4] Test metadata: View files in list view, verify size/date/type display correctly
- [ ] T137 [US4] Test refresh: Modify file externally, verify metadata and thumbnail update
- [ ] T138 [US4] Test unsupported: Verify unknown file types show default icon
- [ ] T139 [US4] Test performance: Folder with 100 images loads thumbnails within 10 seconds

**✓ Milestone**: US4 Complete - Visual polish complete

---

## Phase 7: Polish & Cross-Cutting Concerns

**Goal**: Production-ready quality with error handling, performance optimization, and comprehensive testing.

**Dependencies**: All user stories complete
**Duration**: ~8 hours

### Tasks

#### Error Handling

- [ ] T140 [P] Create Sources/OneProviderCore/Errors/ValidationError.swift for entity validation failures
- [ ] T141 [P] Create Sources/OneProviderCore/Errors/IPCError.swift for Node.js communication failures
- [ ] T142 [P] Create Sources/OneProviderCore/Errors/ONEError.swift for one.core/one.models errors
- [ ] T143 Add user-friendly error messages for common failures in FileProviderExtension.swift
- [ ] T144 Implement error recovery strategies (no arbitrary delays, fail fast per user principles)
- [ ] T145 Add comprehensive logging with os_log subsystem: com.refinio.one.provider

#### Performance Optimization

- [ ] T146 [P] Implement batch prefetching for folder enumeration (fetch metadata for all children in one IPC call)
- [ ] T147 [P] Add connection pooling for multiple concurrent IPC requests
- [ ] T148 Optimize MetadataCache hit rate with adaptive TTL based on access patterns
- [ ] T149 Add telemetry for operation timing to verify success criteria (SC-001 through SC-010)
- [ ] T150 Profile and optimize for <3s folder listing with 1000 items (SC-002)

#### Multi-Domain Support

- [ ] T151 Verify multiple domains can run simultaneously (one Node.js process per domain)
- [ ] T152 Add domain isolation: ensure separate caches and change trackers per domain
- [ ] T153 Test switching between domains in Finder without crashes or data mixing

#### Documentation

- [ ] T154 [P] Create README.md in one.provider with build instructions
- [ ] T155 [P] Document IPC protocol extensions beyond base contract in PROTOCOL.md
- [ ] T156 [P] Add inline code documentation for all public APIs
- [ ] T157 Update quickstart.md with any deviations from plan

#### Integration Testing

- [ ] T158 Create Tests/OneProviderIntegrationTests/FileProviderIntegrationTests.swift
- [ ] T159 Test complete user journey: install → add domain → browse → create → edit → delete
- [ ] T160 Test offline scenario end-to-end: queue operations → sync on reconnect
- [ ] T161 Test concurrent operations: 10 parallel file operations without corruption (SC-006)
- [ ] T162 Test large scale: folder with 10,000 items enumerates correctly (SC-002)
- [ ] T163 Test stress: rapid create/delete cycles, verify no memory leaks or crashes
- [ ] T164 Verify 95% operation success rate under normal network conditions (SC-007)

#### Final Validation

- [ ] T165 Run all unit tests, verify 100% pass rate
- [ ] T166 Run all integration tests, verify all success criteria met (SC-001 through SC-010)
- [ ] T167 Perform user acceptance testing with real ONE database
- [ ] T168 Verify no Claude attribution in git commits per user principles
- [ ] T169 Final code review against user principles (fail fast, no delays, use what you have)
- [ ] T170 Tag release as v1.0.0 in git

**✓ Milestone**: Production Ready

---

## Dependencies Graph

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundation - IPC Bridge)
    ↓
Phase 3 (US1 - File System Access) → MVP READY
    ↓
Phase 4 (US2 - File Operations)
    ↓
Phase 5 (US3 - File Content Access)
    ↓
Phase 6 (US4 - Metadata & Thumbnails)
    ↓
Phase 7 (Polish & Testing) → PRODUCTION READY
```

**Key**: Each phase depends on the previous phase completing. Tasks within a phase marked `[P]` can run in parallel.

---

## Parallel Execution Examples

### Phase 1 (Setup)
**Parallel Set**: T003, T004, T005, T006, T007 (directory creation - no dependencies)

### Phase 2 (Foundation)
**Parallel Set 1**: T014, T015, T016, T017 (Node.js IPC methods - independent implementations)

**Parallel Set 2**: T037, T038, T039, T040 (Data model types - independent files)

### Phase 4 (US2)
**Parallel Set**: T074, T075, T076, T077 (Node.js write operations - independent methods)

### Phase 7 (Polish)
**Parallel Set 1**: T140, T141, T142 (Error types - independent files)

**Parallel Set 2**: T146, T147 (Performance optimizations - independent concerns)

**Parallel Set 3**: T154, T155, T156 (Documentation - independent documents)

---

## Success Criteria Mapping

| Criterion | Verified By Tasks |
|-----------|-------------------|
| SC-001: Navigate within 2s | T070, T071, T149 |
| SC-002: List 1000 items in 3s | T056, T150, T162 |
| SC-003: Operations complete in 5s | T095-T100, T164 |
| SC-004: Open files in 5s | T119-T121 |
| SC-005: Thumbnails in 2s | T135, T139 |
| SC-006: 10 concurrent ops | T161 |
| SC-007: 95% success rate | T164 |
| SC-008: Offline access in 1s | T099, T122 |
| SC-009: 100% metadata consistency | T137, T166 |
| SC-010: 4/5 user satisfaction | T167 (user acceptance testing) |

---

## File Path Reference

**Swift Sources**:
- `/Users/gecko/src/filer/one.provider/Sources/OneProviderApp/*.swift`
- `/Users/gecko/src/filer/one.provider/Sources/OneProviderExtension/*.swift`
- `/Users/gecko/src/filer/one.provider/Sources/OneProviderCore/**/*.swift`

**Node.js Runtime**:
- `/Users/gecko/src/filer/one.provider/node-runtime/index.js`
- `/Users/gecko/src/filer/one.provider/node-runtime/package.json`

**Tests**:
- `/Users/gecko/src/filer/one.provider/Tests/OneProviderCoreTests/*.swift`
- `/Users/gecko/src/filer/one.provider/Tests/OneProviderIntegrationTests/*.swift`

**Configuration**:
- `/Users/gecko/src/filer/one.provider/Package.swift`
- `/Users/gecko/src/filer/one.provider/Resources/Info.plist`
- `/Users/gecko/src/filer/one.provider/Resources/Entitlements.entitlements`

**Reference Implementations**:
- `/Users/gecko/src/filer/one.fuse3/` (Linux patterns)
- `/Users/gecko/src/filer/one.projfs/` (Windows patterns)
- `/Users/gecko/src/filer/one.filer.mac/` (Prior macOS work)

---

## Notes

- **No delays**: Per user principles, no arbitrary retry delays. Fail fast and let system handle recovery.
- **No fallbacks**: Throw errors immediately; don't silently mitigate.
- **Use what you have**: Leverage one.core, one.models, and File Provider's built-in caching.
- **No Claude attribution**: Ensure git commits follow user's commit guidelines.
- **Branded types**: Use SHA256Hash and SHA256IdHash consistently for type safety.
- **Testing**: No TDD approach specified, but integration tests critical for success criteria validation.

---

## Suggested Next Command

Start with MVP implementation:

```bash
# Begin Phase 1: Setup
# Execute tasks T001-T012 sequentially, with parallel execution of T003-T007
```

Or for automated task tracking:

```bash
/speckit.implement
```
