# Research: Apple File Provider Integration

**Date**: 2025-10-17
**Feature**: Apple File Provider Integration
**Branch**: 001-apple-file-provider

## Purpose

This document resolves the unknowns identified in the Technical Context section of plan.md, providing technical decisions and rationale for the Apple File Provider implementation.

## Research Items

### 1. Swift ↔ Node.js Bridge Mechanism

**Question**: How should Swift communicate with the TypeScript/Node.js one.core and one.models runtime?

**Options Evaluated**:

1. **XPC (Apple's IPC framework)**
   - Native Apple technology for inter-process communication
   - Type-safe, bidirectional communication
   - Good for Mac-to-Mac processes
   - **Issue**: Requires both sides to be native code (Objective-C/Swift), no Node.js support

2. **Subprocess with JSON-RPC over stdin/stdout**
   - Simple text protocol, JSON messages
   - Node.js runs as child process managed by Swift
   - **Pattern used by one.fuse3 and one.projfs** (reverse: Node.js manages native)
   - Low overhead, easy to debug

3. **Embedded JavaScript engine (JavaScriptCore)**
   - Bundle one.core/one.models JavaScript in app
   - Execute in Apple's JavaScriptCore engine
   - No separate process
   - **Issue**: one.core depends on Node.js APIs (fs, crypto, etc.) not available in JavaScriptCore; would require extensive porting

4. **Compile one.core to native (via Bun/Deno or rewrite)**
   - Use alternative runtime that compiles to native
   - **Issue**: Massive engineering effort, diverges from canonical implementation, loses TypeScript tooling

**Decision**: **Subprocess with JSON-RPC over stdin/stdout**

**Rationale**:
- Mirrors the architecture of one.projfs and one.fuse3 (but reversed: native platform layer wraps Node.js instead of Node.js wrapping native)
- Proven pattern in refinio ONE ecosystem
- Maintains use of canonical one.core/one.models without modifications
- Simple debugging: can inspect JSON messages in logs
- Process isolation: Node.js crash doesn't crash File Provider extension
- Follows user's principle: "Use what you have first" - leverages existing Node.js packages

**Implementation Pattern**:
```
Swift FileProviderExtension
  ↓ (async/await)
ONEBridge (Actor)
  ↓ (Process.stdin/stdout)
NodeIPCBridge
  ↓ (JSON-RPC: {"jsonrpc":"2.0","method":"getObject","params":{"hash":"sha256..."},"id":1})
Node.js IPC Server (index.js)
  ↓
one.models (CombinedFileSystem)
  ↓
one.core (content-addressed storage)
```

**Protocol**: JSON-RPC 2.0
- Request: `{"jsonrpc": "2.0", "method": "methodName", "params": {...}, "id": 1}`
- Response: `{"jsonrpc": "2.0", "result": {...}, "id": 1}`
- Error: `{"jsonrpc": "2.0", "error": {"code": -32000, "message": "Error"}, "id": 1}`

**Methods Required**:
- `initialize(instancePath: String)` → ONE instance connection
- `getObject(hash: SHA256Hash)` → object data
- `getChildren(hash: SHA256Hash)` → array of child hashes
- `createObject(data: Object)` → hash
- `updateObject(hash: SHA256Hash, data: Object)` → new hash
- `deleteObject(hash: SHA256Hash)` → void
- `watchChanges()` → stream of change events

**Reference**: See `/Users/gecko/src/filer/one.projfs/src/ifsprojfs_bridge.cpp` for similar native→Node.js bridge pattern (uses N-API, but concept is same).

---

### 2. Caching Strategy

**Question**: Should we implement a ContentCache like one.projfs, or rely on Apple's File Provider system caching?

**Options Evaluated**:

1. **Emulate one.projfs ContentCache in Swift**
   - Pre-fetch metadata from one.core on enumeration
   - Store in-memory cache of file attributes
   - Serve synchronous File Provider requests from cache
   - **Advantage**: Fast metadata responses, proven pattern
   - **Disadvantage**: Duplicates File Provider's built-in caching

2. **Rely solely on File Provider system caching**
   - Let NSFileProviderExtension handle all caching
   - Always fetch from one.core on demand
   - **Advantage**: Simple, no duplicate caching logic
   - **Disadvantage**: Slower, more network requests, violates performance goals

3. **Hybrid approach**
   - Use File Provider's disk cache for content
   - Maintain lightweight in-memory metadata cache for listings
   - Invalidate on change notifications from one.core

**Decision**: **Hybrid approach - File Provider content cache + Swift metadata cache**

**Rationale**:
- **File Provider content cache**: Built-in, handles disk space management, survives extension restarts
- **Swift metadata cache**: Lightweight (just identifiers, sizes, dates), critical for meeting <3s listing performance goal with 1000+ items
- Follows user's principle: "Use what you have first" - leverages File Provider's content cache, adds minimal metadata cache only where needed for performance
- Pattern inspired by one.projfs ContentCache, but adapted to File Provider architecture

**Implementation**:

```swift
actor MetadataCache {
    private var cache: [SHA256Hash: FileItemMetadata] = [:]
    private var ttl: TimeInterval = 300 // 5 minutes

    func get(_ hash: SHA256Hash) -> FileItemMetadata? {
        // Check cache, return if fresh
    }

    func set(_ hash: SHA256Hash, metadata: FileItemMetadata) {
        // Store with timestamp
    }

    func invalidate(_ hash: SHA256Hash) {
        // Remove on change event
    }

    func prefetch(_ hashes: [SHA256Hash]) async {
        // Batch fetch from Node.js bridge
    }
}
```

**Content caching**: Delegate entirely to File Provider's built-in cache via:
- `NSFileProviderDomain` storage location
- `NSFileProviderItemContentPolicy` (download on demand vs. eager)
- Let system manage eviction based on disk pressure

**Change invalidation**: Subscribe to one.core change events via Node.js IPC bridge, invalidate affected cache entries.

---

### 3. Change Tracking and Sync Anchors

**Question**: How to sync one.core mutations to File Provider sync anchors and NSFileProviderItemVersion?

**Background**:
- File Provider uses "sync anchors" to track changes: opaque Data blobs representing a point in time
- Client requests changes since a sync anchor
- `NSFileProviderItemVersion` represents item version, must be comparable and monotonically increasing
- one.core uses SHA-256 content-addressed storage (immutable objects)

**Options Evaluated**:

1. **Use one.core object hash as version**
   - `NSFileProviderItemVersion` = SHA-256 hash
   - Sync anchor = most recent hash seen
   - **Issue**: Hashes aren't ordered, can't determine "since anchor X"

2. **Maintain separate version counter**
   - Increment counter on each change
   - Store mapping: `counter → [hashes changed]`
   - Sync anchor = counter value
   - **Advantage**: Simple, ordered, efficient delta calculation
   - **Disadvantage**: Requires persistent storage, must survive extension restarts

3. **Use one.core's versioned objects mechanism**
   - one.core already has versioning for objects
   - **Issue**: Unclear how to map this to File Provider's sync model (needs investigation of one.core internals)

**Decision**: **Maintain separate version counter with persistent storage**

**Rationale**:
- Clear separation of concerns: version tracking is a File Provider requirement, not a one.core concern
- Simple implementation: `UserDefaults` or SQLite for counter + change log
- Follows user's principle: "No fallbacks, fail fast" - explicit versioning prevents sync ambiguity
- Pattern from one.projfs: AsyncBridge tracks pending operations with IDs

**Implementation**:

```swift
actor ChangeTracker {
    private var currentVersion: UInt64 = 0
    private var changeLog: [UInt64: [ItemChange]] = [:]

    func recordChange(_ change: ItemChange) -> UInt64 {
        currentVersion += 1
        changeLog[currentVersion] = (changeLog[currentVersion] ?? []) + [change]
        persistVersion(currentVersion)
        return currentVersion
    }

    func changes(since anchor: NSFileProviderSyncAnchor) -> [ItemChange] {
        let anchorVersion = decode(anchor)
        return changeLog
            .filter { $0.key > anchorVersion }
            .sorted { $0.key < $1.key }
            .flatMap { $0.value }
    }

    func currentSyncAnchor() -> NSFileProviderSyncAnchor {
        return encode(currentVersion)
    }
}
```

**Sync anchor encoding**:
```swift
struct SyncAnchor: Codable {
    let version: UInt64
    let timestamp: Date
}

func encode(_ version: UInt64) -> NSFileProviderSyncAnchor {
    let anchor = SyncAnchor(version: version, timestamp: Date())
    let data = try! JSONEncoder().encode(anchor)
    return NSFileProviderSyncAnchor(data)
}

func decode(_ anchor: NSFileProviderSyncAnchor) -> UInt64 {
    let syncAnchor = try! JSONDecoder().decode(SyncAnchor.self, from: anchor.rawValue)
    return syncAnchor.version
}
```

**Change event subscription**: Node.js IPC server watches one.core for mutations, sends change events:
```json
{
  "jsonrpc": "2.0",
  "method": "onChange",
  "params": {
    "type": "created|modified|deleted",
    "hash": "sha256...",
    "path": "/objects/abc123.txt",
    "timestamp": "2025-10-17T10:30:00Z"
  }
}
```

Swift `ChangeTracker` receives these, increments version, updates change log, notifies File Provider via `NSFileProviderManager.signalEnumerator()`.

---

## Additional Research: File Provider Best Practices

### Offline Operation Queue

**Requirement**: FR-014 requires offline operation queueing.

**Implementation**: Persistent queue stored in `NSFileProviderDomain` storage location:

```swift
actor OperationQueue {
    private var queue: [FileOperation] = []

    func enqueue(_ operation: FileOperation) {
        queue.append(operation)
        persist()
    }

    func processQueue() async {
        for operation in queue {
            do {
                try await execute(operation)
                dequeue(operation)
            } catch {
                // Retry with exponential backoff (BUT no arbitrary delays - fail fast if unrecoverable)
                if isRecoverable(error) {
                    operation.retryCount += 1
                } else {
                    // Fail fast: throw to user
                    throw error
                }
            }
        }
    }
}
```

**Note**: User's principle "delays are for arseholes" means no arbitrary retry delays. If network is down, fail immediately and let the system retry when connectivity returns. Only retry if error is transient (e.g., rate limit) with exponential backoff, otherwise throw.

### Thumbnail Generation

**Requirement**: FR-011 requires thumbnail generation.

**Implementation**: Use Apple's `QLThumbnailGenerator` for supported types:

```swift
import QuickLookThumbnailing

func generateThumbnail(for item: NSFileProviderItem) async throws -> Data {
    let request = QLThumbnailGenerator.Request(
        fileAt: item.contentURL,
        size: CGSize(width: 256, height: 256),
        scale: 2.0,
        representationTypes: .thumbnail
    )

    let generator = QLThumbnailGenerator.shared
    let thumbnail = try await generator.generateBestRepresentation(for: request)
    return thumbnail.pngRepresentation
}
```

For unsupported types, return nil and let File Provider use default icons.

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **File Provider Extension** | Swift 5.9, NSFileProviderReplicatedExtension | File system integration |
| **Management App** | SwiftUI, macOS 13+ | Domain lifecycle UI |
| **Bridge Layer** | Swift Actor + Process | IPC coordination |
| **IPC Protocol** | JSON-RPC 2.0 over stdin/stdout | Native ↔ Node.js |
| **Node.js Runtime** | Node.js 20+, bundled | one.core/one.models host |
| **Data Layer** | one.core 0.6.1, one.models 14.1.0 | Content-addressed storage |
| **Metadata Cache** | Swift Dictionary + TTL | Performance optimization |
| **Content Cache** | File Provider built-in | Disk-backed caching |
| **Change Tracking** | UInt64 counter + log | Sync anchor implementation |
| **Operation Queue** | Persistent Swift queue | Offline support |
| **Thumbnails** | QLThumbnailGenerator | Image previews |
| **Testing** | XCTest, Jest | Unit + integration tests |

---

## Implementation Phases

Based on research findings, recommended implementation order:

**Phase 1**: Foundation
1. Node.js IPC server (index.js) with JSON-RPC protocol
2. Swift NodeIPCBridge (Process management + JSON-RPC client)
3. ONEBridge Actor (high-level API wrapping IPC)
4. Basic test: Swift can call one.core methods

**Phase 2**: Core File Provider
1. FileProviderItem (NSFileProviderItem implementation)
2. FileProviderExtension (basic enumeration)
3. MetadataCache Actor
4. Test: Can browse root folder in Finder

**Phase 3**: Operations
1. File read operations
2. File write operations (create, update)
3. File delete operations
4. File move/rename operations
5. Test: CRUD operations work end-to-end

**Phase 4**: Advanced Features
1. ChangeTracker Actor + sync anchor support
2. OperationQueue Actor + offline support
3. Thumbnail generation
4. Test: Offline operations + sync

**Phase 5**: Polish
1. Error handling and user-friendly messages
2. Performance optimization (batch operations, prefetching)
3. Multi-domain support
4. Integration tests

---

## Open Questions for Implementation Phase

1. **Node.js bundling**: Should we bundle Node.js runtime in the app (like Electron), or require user installation?
   - **Recommendation**: Bundle for simplicity, ~50MB overhead acceptable for macOS app

2. **one.core instance location**: Where should the ONE database files live?
   - **Recommendation**: `~/Library/Application Support/OneProvider/[domain-id]/` for each File Provider domain

3. **Extension activation**: How should the main app start/stop File Provider domains?
   - **Recommendation**: Use `NSFileProviderManager.add(_:completionHandler:)` and `remove()`

4. **Multi-domain**: Can multiple File Provider domains share one Node.js process?
   - **Recommendation**: One Node.js process per domain for isolation, but investigate shared process with multiplexing

These questions will be resolved during Phase 1-2 implementation based on practical constraints discovered.

---

## References

- Apple FileProvider Documentation: https://developer.apple.com/documentation/fileprovider
- NSFileProviderReplicatedExtension: https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension
- JSON-RPC 2.0 Spec: https://www.jsonrpc.org/specification
- one.projfs ContentCache pattern: `/Users/gecko/src/filer/one.projfs/src/content_cache.cpp`
- one.fuse3 N-API bridge: `/Users/gecko/src/filer/one.fuse3/fuse3_napi.cc`
- one.filer.mac prior work: `/Users/gecko/src/filer/one.filer.mac/Sources/`
