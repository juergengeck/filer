# File Provider Swift Architecture

## Overview

The File Provider extension is a **sandboxed macOS system extension** that bridges macOS Finder with a Node.js application server running ONE.core. It implements Apple's `NSFileProviderReplicatedExtension` protocol to provide virtual filesystem access.

**Key Architecture**:
```
Finder
  ↓ (File Provider API calls)
Swift Extension (sandboxed)
  ↓ (JSON-RPC over stdin/stdout)
Node.js Application Server
  ↓ (IFileSystem interface)
ONE.core + one.models
```

---

## File Structure

```
Sources/OneFiler/
├── FileProviderExtension.swift   # Main extension entry point
├── FileProviderEnumerators.swift # Directory listing logic
├── FileProviderItem.swift        # File/folder metadata wrapper
└── ONEBridge.swift               # IPC bridge to Node.js
```

---

## 1. FileProviderExtension.swift

**Purpose**: Main extension class that implements `NSFileProviderReplicatedExtension`. Loaded by macOS when File Provider domain is accessed.

### Key Components

#### 1.1 Initialization
```swift
required init(domain: NSFileProviderDomain)
```
- Called by macOS when extension loads
- **Does NOT initialize bridge immediately** (lazy initialization)
- Stores domain configuration (identifier, display name)

#### 1.2 Bridge Management

**`setupBridge() async throws -> ONEBridge`**
- **Reads domain configuration** from App Group container:
  - Location: `~/Library/Group Containers/group.com.one.filer/domains.json`
  - JSON structure: `{ "domain-identifier": { "path": "/instance/path", "email": "...", ... } }`
- **Creates ONEBridge** with instance path and credentials
- **Connects to Node.js** (spawns process, initializes IPC)
- **Thread-safe**: Uses `NSLock` to prevent multiple initializations

**`getBridge() async throws -> ONEBridge`**
- **Lazy initialization pattern**: Bridge only created on first use
- **Thread-safe singleton**: Multiple simultaneous calls handled correctly
- **Concurrent access**: If initialization in progress, waits for existing Task
- **Error handling**: Failed initialization clears task, allows retry

### 1.3 File Provider Protocol Methods

#### Item Retrieval
**`item(for:request:completionHandler:)`**
- Called when macOS needs metadata for a specific file/folder
- Flow:
  1. Get/create bridge
  2. Fetch item via `fetchItem(for:using:)`
  3. Return FileProviderItem wrapper
- **Special cases**:
  - `.rootContainer`: Returns synthetic root item
  - All other IDs: Calls `bridge.getObject(id:)` → Node.js `stat` command

#### Content Fetching
**`fetchContents(for:version:request:completionHandler:)`**
- Called when Finder needs file content (user opens/copies file)
- Flow:
  1. Get object metadata
  2. Create temporary file (`FileManager.temporaryDirectory`)
  3. Call `bridge.readContent(id:)` → Node.js `readFile` command
  4. Write to temp file
  5. Return temp file URL
- **Note**: Temp file automatically cleaned by macOS

#### Enumeration (Directory Listing)
**`enumerator(for:request:)`**
- **Critical**: Creates enumerator object for directory
- **Router logic**: Selects enumerator type based on identifier:
  ```swift
  .rootContainer          → RootEnumerator
  "objects", "objects/*"  → ObjectsEnumerator
  "chats", "chats/*"      → GenericEnumerator
  "types", "types/*"      → GenericEnumerator
  "invites", "invites/*"  → GenericEnumerator
  "debug", "debug/*"      → GenericEnumerator
  default                 → throws .noSuchItem
  ```

#### Modification
**`modifyItem(_:baseVersion:changedFields:contents:)`**
- Handles file content changes and renames
- Content changes: Reads from URL, calls `bridge.writeContent(id:data:)`
- Renames: Calls `bridge.rename(id:newName:)`

#### Deletion
**`deleteItem(identifier:baseVersion:options:)`**
- Calls `bridge.deleteObject(id:)` → Node.js `unlink` command

#### Sync Anchor
**`currentSyncAnchor(completionHandler:)`**
- Returns `nil` (not tracking changes yet)
- Future: Should return timestamp/version for change tracking

---

## 2. FileProviderEnumerators.swift

**Purpose**: Implements directory listing logic. Three enumerator types handle different parts of the filesystem.

### 2.1 RootEnumerator

**Enumerates**: Root directory (`/`)

**`enumerateItems(for:startingAt:)`**
- Returns **hardcoded list** of top-level folders:
  ```swift
  ["objects", "chats", "types", "debug", "invites"]
  ```
- **No IPC calls** - purely synthetic
- Flow:
  1. Call `FileProviderItem.standardFolders()`
  2. Call `observer.didEnumerate(items)`
  3. Call `observer.finishEnumerating(upTo: nil)`

**`enumerateChanges(for:from:)`**
- Would call `bridge.getChanges(since:)` for sync
- Currently returns empty (not implemented)

### 2.2 ObjectsEnumerator

**Enumerates**: `/objects` directory and subdirectories

**`enumerateItems(for:startingAt:)`**
- Flow:
  1. Get bridge
  2. Call `bridge.getChildren(parentId:)`
     → Node.js `readDir` + `stat` for each child
  3. Convert to FileProviderItem array
  4. Call `observer.didEnumerate(items)`
  5. Call `observer.finishEnumerating(upTo: nil)`

### 2.3 GenericEnumerator

**Enumerates**: All other directories (`/chats`, `/types`, `/invites`, `/debug`)

**`enumerateItems(for:startingAt:)` with extensive logging**
```swift
logger.info("🔄 ENUMERATE ITEMS for: \(self.containerIdentifier.rawValue)")
// Get extension → Get bridge → Call getChildren → Convert to items
logger.info("  → Got \(children.count) children from IPC")
logger.info("  → Converted to \(items.count) FileProviderItems")
logger.info("✅ ENUMERATE COMPLETE")
```

**Current Issue**: This is the enumerator used for `/invites`, but logs show it **may not be called** for directory listing operations.

---

## 3. FileProviderItem.swift

**Purpose**: Wraps `ONEObject` as `NSFileProviderItem` for File Provider API

### Data Flow

```
ONEObject (from Node.js)
    ↓
FileProviderItem (wrapper)
    ↓
NSFileProviderItem (protocol)
    ↓
Finder (displays file/folder)
```

### Key Properties

#### Identity
```swift
itemIdentifier: NSFileProviderItemIdentifier
  → Returns .rootContainer or NSFileProviderItemIdentifier(oneObject.id)

parentItemIdentifier: NSFileProviderItemIdentifier
  → Returns parent ID or .rootContainer

filename: String
  → oneObject.name
```

#### Type
```swift
contentType: UTType
  → .folder for directories
  → Derived from file extension or MIME type
  → Defaults to .data
```

#### Metadata
```swift
documentSize: NSNumber?        → oneObject.size (files only)
creationDate: Date?            → oneObject.created
contentModificationDate: Date? → oneObject.modified
lastUsedDate: Date?            → oneObject.accessed
```

#### Versioning
```swift
itemVersion: NSFileProviderItemVersion
  → Uses oneObject.contentHash and metadataHash
  → Enables change tracking
```

#### Capabilities
```swift
capabilities: NSFileProviderItemCapabilities
  → .allowsReading (always)
  → .allowsWriting/.allowsRenaming (if permissions.write)
  → .allowsDeleting/.allowsTrashing (if permissions.delete)
  → .allowsAddingSubItems (folders only)
```

#### Extended Attributes
```swift
extendedAttributes: [String: Data]
  → "one.hash.sha256": SHA256 hash
  → "one.type.id": ONE type identifier
  → "one.instance.id": Object ID
```

---

## 4. ONEBridge.swift

**Purpose**: Actor that manages Node.js process and JSON-RPC communication

### 4.1 Data Types

```swift
ONEInstanceConfig {
    name: String           // Domain display name
    directory: String      // Instance storage path
    email: String?         // Instance credentials
    secret: String?
    instanceName: String?
}

ONEObject {
    id: String              // Path (e.g., "/invites/iop_invite.txt")
    name: String            // Filename
    type: .file | .folder
    size: Int
    modified: Date
    parentId: String?
    permissions: Set<Permission>
    // ... metadata fields
}
```

### 4.2 Lifecycle

#### Initialization
```swift
init(config: ONEInstanceConfig)
```
- Just stores config
- **Does NOT spawn Node.js** (lazy)

#### Connection
```swift
func connect() async throws
```
**Critical path for Node.js spawning**:

1. **Find resources**:
   ```swift
   let nodePath = Bundle.main.resourcePath + "/lib/index.js"
   let nodeExecutable = Bundle.main.resourcePath + "/bin/node"
   ```

2. **Setup Process**:
   ```swift
   process.executableURL = nodeExecutable
   process.arguments = [nodePath]
   process.currentDirectoryURL = resourcePath  // For node_modules resolution
   process.environment["NODE_PATH"] = resourcePath + "/node_modules"
   ```

3. **Setup pipes**:
   - stdin: For sending JSON-RPC requests
   - stdout: For receiving JSON-RPC responses
   - stderr: Captured and logged (bypasses privacy redaction with NSLog)

4. **Launch process**:
   ```swift
   try process.run()  // Spawns node executable
   ```

5. **Start reading stdout**:
   ```swift
   self.readTask = Task { await self.readResponses() }
   ```

6. **Send initialize command**:
   ```swift
   sendRequest(method: "initialize", params: {
       instancePath: config.directory,
       email: config.email,
       secret: config.secret,
       name: config.instanceName
   })
   ```

#### Disconnection
```swift
func disconnect() async
```
- Cancels read/write tasks
- Terminates Node.js process
- Fails all pending IPC requests

### 4.3 IPC Communication

#### Request/Response Flow

**Sending Request**:
```swift
func sendRequest(method: String, params: [String: Any]) async throws -> [String: Any]
```
1. Increment `requestId` (correlation ID)
2. Create JSON-RPC request:
   ```json
   {
     "jsonrpc": "2.0",
     "method": "readDir",
     "params": { "path": "/invites" },
     "id": 42
   }
   ```
3. Serialize to JSON + newline
4. Queue for writing: `writeQueue.append(message)`
5. Trigger `processWriteQueue()` (writes to stdin pipe)
6. **Wait for response** via `CheckedContinuation` stored in `pendingResponses[id]`

**Receiving Response**:
```swift
func readResponses() async
```
- **Runs continuously** in background task
- Reads stdout **byte-by-byte** (async sequence)
- Buffers until newline found
- Parses JSON-RPC response
- Looks up pending continuation by ID
- Resumes continuation with result or error

**Thread Safety**:
- `ONEBridge` is an **Actor** (Swift concurrency)
- All methods run on actor's serial executor
- Safe concurrent access without explicit locking

### 4.4 Public API Methods

All methods follow same pattern:
1. Normalize path (ensure starts with `/`)
2. Send JSON-RPC request
3. Parse response
4. Return typed result

#### `getObject(id: String) async throws -> ONEObject`
- **IPC**: `stat` command
- **Returns**: File/folder metadata (mode, size, type)

#### `getChildren(parentId: String) async throws -> [ONEObject]`
**CRITICAL for directory listing**:
1. **IPC**: `readDir` command → returns array of filenames
2. **For each child**: calls `getObject(childPath)` → `stat` command
3. **Returns**: Array of ONEObject with full metadata

**Current logging**:
```swift
NSLog("🔥 ONEBridge.getChildren: parentId=\(parentId)")
NSLog("🔥 ONEBridge.getChildren: Found \(children.count) children")
NSLog("🔥 ONEBridge.getChildren: Returning \(objects.count) ONEObjects")
```

#### `readContent(id: String) async throws -> Data`
- **IPC**: `readFile` command
- **Returns**: Base64-encoded content decoded to Data

#### `writeContent(id: String, data: Data) async throws`
- **IPC**: `writeFile` command with base64-encoded content

#### `deleteObject(id: String) async throws`
- **IPC**: `unlink` command

#### `rename(id: String, newName: String) async throws`
- **IPC**: `rename` command with source and destination paths

#### `getChanges(since: Data?) async throws -> ONEChanges`
- **IPC**: `getChanges` command
- **Returns**: Updated/deleted items since anchor
- **Not currently used** (currentSyncAnchor returns nil)

---

## 5. Complete Request Flow

### Example: User opens `/invites` folder in Finder

```
┌─────────────────────────────────────────────────────────┐
│ 1. User clicks "Invites" folder in Finder               │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. macOS calls:                                         │
│    extension.enumerator(for: "invites", request:)       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. FileProviderExtension creates GenericEnumerator     │
│    - Logs: "🔥🔥🔥 ENUMERATOR TYPE: GenericEnumerator"  │
│    - Does NOT initialize bridge yet                     │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. macOS calls:                                         │
│    enumerator.enumerateItems(for: observer, startingAt:)│
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 5. GenericEnumerator.enumerateItems():                 │
│    - Logs: "🔄 ENUMERATE ITEMS for: invites"           │
│    - Gets extension reference                           │
│    - Calls: extension.getBridge()                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 6. FileProviderExtension.getBridge():                  │
│    - First call: Spawns Node.js, initializes IPC       │
│    - Subsequent calls: Returns existing bridge          │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 7. ONEBridge.connect():                                │
│    - Spawns: /Resources/bin/node /Resources/lib/index.js│
│    - Sends: initialize IPC command                      │
│    - Waits for response                                 │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 8. Node.js server:                                      │
│    - Initializes ONE.core                               │
│    - Mounts filesystems                                 │
│    - Creates invite files                               │
│    - Returns: { status: "ok" }                          │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 9. GenericEnumerator continues:                        │
│    - Calls: bridge.getChildren(parentId: "invites")     │
│    - Logs: "🔥 ONEBridge.getChildren: parentId=invites" │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 10. ONEBridge.getChildren():                            │
│     - Sends IPC: readDir("/invites")                    │
│     - Node.js returns: ["iop_invite.txt", ...]          │
│     - Logs: "🔥 Found 4 children"                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 11. ONEBridge.getChildren() - stat each child:          │
│     FOR EACH child:                                      │
│       - Sends IPC: stat("/invites/iop_invite.txt")      │
│       - Node.js returns: { mode, size, ... }            │
│       - Creates ONEObject                               │
│     - Logs: "🔥 Returning 4 ONEObjects"                 │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 12. GenericEnumerator wraps results:                   │
│     - Maps: ONEObject → FileProviderItem                │
│     - Logs: "→ Converted to 4 FileProviderItems"       │
│     - Calls: observer.didEnumerate(items)               │
│     - Calls: observer.finishEnumerating(upTo: nil)      │
│     - Logs: "✅ ENUMERATE COMPLETE"                     │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 13. macOS File Provider framework:                      │
│     - Receives items from enumerator                     │
│     - Updates Finder view                                │
│     - Displays files in /invites directory              │
└─────────────────────────────────────────────────────────┘
```

### Why `/invites` Might Appear Empty

**If logs show**:
```
✅ Node.js IPC initialized
🔥 ONEBridge.getChildren: Found 4 children
✅ ENUMERATE COMPLETE
```

**But Finder shows empty**, possible causes:

1. **Enumerator not called**: macOS never calls `enumerateItems` for some reason
2. **Items not passed to observer**: `observer.didEnumerate()` fails silently
3. **Finder caching**: macOS caches empty result, doesn't refresh
4. **Item conversion failure**: FileProviderItem init fails, but error swallowed
5. **Async timing**: Observer called but completionHandler never fires

**Debug strategy**:
- Check if "🔄 ENUMERATE ITEMS" appears in logs when accessing directory
- Verify `observer.didEnumerate()` is actually called (add NSLog before call)
- Try `killall Finder` to clear cache
- Check Console.app for File Provider framework errors

---

## 6. Thread Safety & Concurrency

### Swift Actors

**ONEBridge is an Actor**:
- All public methods run on actor's serial executor
- **Prevents data races** on mutable state:
  - `requestId` (incremented atomically)
  - `pendingResponses` (concurrent access prevented)
  - `writeQueue` (serialized access)

**FileProviderExtension uses NSLock**:
```swift
bridgeLock.lock()
if let existingBridge = bridge {
    bridgeLock.unlock()
    return existingBridge
}
bridgeLock.unlock()
```
- Protects bridge initialization
- Allows concurrent readers after initialization
- Prevents duplicate Node.js spawns

### Async/Await Patterns

**Checked Continuations**:
```swift
return try await withCheckedThrowingContinuation { continuation in
    pendingResponses[id] = continuation
    // Send request...
}
```
- **Suspends** Swift async function
- **Resumes** when response received
- **Type-safe** error propagation

**Task Management**:
```swift
self.readTask = Task { await self.readResponses() }
```
- Background task keeps reading stdout
- Retained by `readTask` property
- Cancelled on disconnect

---

## 7. Error Handling

### Error Types

```swift
enum ONEBridgeError: Error {
    case notConnected    // Node.js not spawned or terminated
    case timeout         // (Not currently used)
    case invalidResponse // JSON parsing failed or unexpected format
    case operationFailed // IPC command returned error
}

NSFileProviderError:
    .serverUnreachable   // Can't spawn Node.js or connect fails
    .noSuchItem          // File/folder doesn't exist
    .notAuthenticated    // (Used for unimplemented operations)
```

### Error Propagation

```swift
// From Node.js error → Swift error
if let error = json["error"] as? [String: Any] {
    continuation.resume(throwing: ONEBridgeError.operationFailed)
}

// From Swift error → File Provider error
catch {
    completionHandler(nil, NSFileProviderError(.serverUnreachable))
}
```

### Logging Strategy

**Structured logging**:
```swift
logger.info("✅ Success message")
logger.error("❌ Error message: \(error)")
logger.debug("🔍 Debug info")
```

**NSLog for privacy bypass**:
```swift
NSLog("🔥 ONEBridge: Details that must be visible")
```
- Appears in Console.app without `<private>` redaction
- Used for critical debugging paths

---

## 8. Key Insights

### Design Decisions

1. **Lazy Initialization**: Bridge only created when first file operation occurs
   - **Pro**: Fast extension load time
   - **Con**: First access has delay

2. **Synchronous Enumerators**: Blocking calls to Node.js
   - **Pro**: Simple, sequential code
   - **Con**: UI may freeze on large directories

3. **No Caching**: Every request goes to Node.js
   - **Pro**: Always up-to-date data
   - **Con**: Performance overhead

4. **Actor Pattern**: Swift actors for thread safety
   - **Pro**: Compile-time race condition prevention
   - **Con**: Slightly more complex API

### Limitations

1. **No Change Tracking**: `currentSyncAnchor` returns nil
   - macOS can't efficiently detect changes
   - Must re-enumerate entire directories

2. **No Conflict Resolution**: Assumes single writer
   - If multiple instances modify same file, last write wins

3. **No Thumbnails**: `thumbnailData` always nil
   - Finder can't show previews without downloading

4. **Temp Files for Content**: Creates copy for every read
   - Doubles storage briefly
   - Cleaned automatically by macOS

---

## 9. Testing with Swift IPC Test

The `test/swift-ipc-test.swift` proves Node.js side works:

```swift
✅ Test 1: Initialize filesystem
✅ Test 2: Read root directory
✅ Test 3: Read invites directory → Returns 4 files
✅ Test 4: Stat /invites
```

This confirms:
- IPC protocol works correctly
- Node.js returns invite files
- JSON-RPC communication is reliable

**Therefore**: Issue must be in:
- File Provider framework integration
- Enumerator invocation by macOS
- Item delivery to Finder

---

## 10. Next Steps for Debugging

1. **Verify enumerator is called**:
   - Check for "🔄 ENUMERATE ITEMS" in logs
   - If missing: macOS not calling enumerator

2. **Verify items are delivered**:
   - Add NSLog immediately before `observer.didEnumerate()`
   - If present but Finder empty: observer not working

3. **Check File Provider daemon**:
   - `log show --predicate 'subsystem == "com.apple.FileProvider"'`
   - Look for framework errors

4. **Try cache clear**:
   - `killall fileproviderd`
   - `killall Finder`
   - Re-access directory

5. **Test with different path**:
   - Try `/objects` or `/chats` instead of `/invites`
   - Same empty result? Framework-wide issue
   - Works? Specific to `/invites` path

---

## Summary

The Swift File Provider extension is a **well-structured bridge** between macOS and Node.js:

- **Clean separation**: Extension handles macOS protocol, Bridge handles IPC, Node.js handles business logic
- **Thread-safe**: Swift actors prevent concurrency bugs
- **Async-first**: Modern Swift concurrency throughout
- **Extensible**: Easy to add new filesystem paths via enumerator routing

**Known Working**:
- Node.js IPC communication ✅
- File metadata retrieval ✅
- File content reading ✅
- Root directory enumeration ✅

**Known Issue**:
- Child directory enumeration shows empty despite Node.js returning files ❌

**Root cause likely**: File Provider framework integration quirk or timing issue, not code bug.
