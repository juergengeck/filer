# Data Model: Apple File Provider Integration

**Date**: 2025-10-17
**Feature**: Apple File Provider Integration
**Branch**: 001-apple-file-provider

## Purpose

This document defines the data entities, their relationships, and validation rules for the Apple File Provider implementation. These entities bridge between Apple's File Provider API (NSFileProviderItem) and refinio ONE's content-addressed storage (one.core/one.models).

---

## Entity Definitions

### 1. FileItem

**Purpose**: Represents a file in the File Provider hierarchy, implementing NSFileProviderItem protocol.

**Attributes**:
- `identifier`: NSFileProviderItemIdentifier (unique, persistent)
  - Derived from: SHA256Hash of ONE object
  - Format: "fp-item-{sha256hash}"
  - **Validation**: Must match pattern `fp-item-[a-f0-9]{64}`

- `parentIdentifier`: NSFileProviderItemIdentifier
  - References parent FolderItem
  - Root uses: NSFileProviderItemIdentifier.rootContainer
  - **Validation**: Must exist in hierarchy or be rootContainer

- `filename`: String
  - Display name in Finder/Files app
  - **Validation**:
    - Non-empty
    - Max 255 characters
    - No path separators (/, \)
    - Sanitize special characters per file system rules

- `contentHash`: SHA256Hash (branded string type)
  - ONE object hash containing file content
  - **Validation**: Exactly 64 hexadecimal characters
  - **Immutability**: Changes create new FileItem version

- `contentSize`: UInt64
  - File size in bytes
  - **Validation**: >= 0, <= UInt64.max

- `contentType`: UTType
  - Uniform Type Identifier (e.g., public.jpeg, public.plain-text)
  - Derived from file extension
  - **Validation**: Valid UTType or fallback to public.data

- `creationDate`: Date
  - When file was created in ONE
  - **Validation**: Not in future

- `modificationDate`: Date
  - When file was last modified
  - **Validation**: >= creationDate, not in future

- `versionIdentifier`: UInt64
  - Monotonically increasing version number
  - Used for sync anchor tracking
  - **Validation**: Increments on each change

- `capabilities`: NSFileProviderItemCapabilities
  - Allowed operations: read, write, delete, rename, move
  - Derived from ONE object permissions
  - **Validation**: Consistent with parent folder capabilities

- `downloadedState`: DownloadState (enum)
  - Values: `.notDownloaded`, `.downloading(progress: Double)`, `.downloaded`, `.failed(error: Error)`
  - Tracks content availability for offline access

**Relationships**:
- Belongs to one FolderItem (parent)
- May have associated ThumbnailData (1:1, optional)
- Referenced by FileOperation (1:many)

**State Transitions**:
```
notDownloaded → downloading(0.0) → downloading(0.5) → ... → downloaded
             ↘                                              ↗
               failed(error) → downloading(0.0) (retry)
```

**Validation Rules**:
- Filename must be unique within parent folder
- ContentHash must reference valid ONE object
- ModificationDate >= creationDate
- VersionIdentifier increases monotonically

**Swift Representation**:
```swift
struct FileItem: Hashable, Identifiable {
    let identifier: NSFileProviderItemIdentifier
    let parentIdentifier: NSFileProviderItemIdentifier
    var filename: String
    let contentHash: SHA256Hash
    var contentSize: UInt64
    var contentType: UTType
    let creationDate: Date
    var modificationDate: Date
    var versionIdentifier: UInt64
    var capabilities: NSFileProviderItemCapabilities
    var downloadedState: DownloadState
}
```

---

### 2. FolderItem

**Purpose**: Represents a folder/directory in the File Provider hierarchy.

**Attributes**:
- `identifier`: NSFileProviderItemIdentifier
  - Format: "fp-folder-{sha256hash}" or "fp-folder-root"
  - **Validation**: Must match pattern `fp-folder-.*`

- `parentIdentifier`: NSFileProviderItemIdentifier
  - References parent FolderItem or rootContainer
  - **Validation**: Must not create cycles

- `foldername`: String
  - Display name in Finder/Files app
  - **Validation**: Same as FileItem filename

- `metadataHash`: SHA256Hash (optional)
  - ONE object hash containing folder metadata
  - **Validation**: 64 hexadecimal characters if present

- `creationDate`: Date
- `modificationDate`: Date
- `versionIdentifier`: UInt64
- `capabilities`: NSFileProviderItemCapabilities
  - Typically includes: addFile, addSubfolder, delete (if not root)

- `childCount`: Int
  - Number of immediate children (files + subfolders)
  - **Validation**: >= 0
  - Used for pagination hints

**Relationships**:
- Belongs to one FolderItem (parent), or is root
- Contains many FileItem (children)
- Contains many FolderItem (subfolders)

**Validation Rules**:
- Foldername must be unique within parent
- Cannot be descendant of itself (cycle detection)
- Root folder has identifier "fp-folder-root"
- ChildCount matches actual enumerated children

**Swift Representation**:
```swift
struct FolderItem: Hashable, Identifiable {
    let identifier: NSFileProviderItemIdentifier
    let parentIdentifier: NSFileProviderItemIdentifier
    var foldername: String
    let metadataHash: SHA256Hash?
    let creationDate: Date
    var modificationDate: Date
    var versionIdentifier: UInt64
    var capabilities: NSFileProviderItemCapabilities
    var childCount: Int
}
```

---

### 3. FileOperation

**Purpose**: Represents a pending or completed file operation, enabling offline queue and retry logic.

**Attributes**:
- `id`: UUID
  - Unique operation identifier
  - **Validation**: Generated, immutable

- `type`: OperationType (enum)
  - Values: `.create`, `.update`, `.delete`, `.move`, `.rename`, `.download`, `.upload`
  - **Validation**: Must be one of defined types

- `targetIdentifier`: NSFileProviderItemIdentifier
  - Item being operated on
  - **Validation**: Must reference existing FileItem or FolderItem

- `status`: OperationStatus (enum)
  - Values: `.pending`, `.inProgress`, `.completed`, `.failed(error: Error)`
  - **Validation**: Valid state transition only

- `progress`: Double
  - 0.0 to 1.0 for in-progress operations
  - **Validation**: 0.0 <= progress <= 1.0

- `createdAt`: Date
  - When operation was enqueued
  - **Validation**: Not in future

- `completedAt`: Date?
  - When operation finished (success or failure)
  - **Validation**: >= createdAt if present

- `retryCount`: Int
  - Number of retry attempts
  - **Validation**: >= 0, < maxRetries (e.g., 3)

- `error`: Error?
  - Error details if status is .failed
  - **Validation**: Present if and only if status is .failed

- `metadata`: OperationMetadata
  - Operation-specific data (e.g., source/destination for move, content for upload)
  - Type: Dictionary or Codable struct

**Relationships**:
- References one FileItem or FolderItem (target)

**State Transitions**:
```
pending → inProgress → completed
        ↘            ↘ failed(error) → pending (retry)
                                      ↘ failed(error) (max retries, permanent failure)
```

**Validation Rules**:
- Status can only transition: pending→inProgress, inProgress→completed, inProgress→failed, failed→pending (retry)
- CompletedAt must be set when status transitions to completed or failed
- RetryCount increments only on failed→pending transition
- Progress is meaningful only when status is inProgress

**Swift Representation**:
```swift
struct FileOperation: Identifiable, Codable {
    let id: UUID
    let type: OperationType
    let targetIdentifier: NSFileProviderItemIdentifier
    var status: OperationStatus
    var progress: Double
    let createdAt: Date
    var completedAt: Date?
    var retryCount: Int
    var error: Error?
    var metadata: OperationMetadata
}

enum OperationType: String, Codable {
    case create, update, delete, move, rename, download, upload
}

enum OperationStatus: Codable {
    case pending
    case inProgress
    case completed
    case failed(error: String)
}
```

---

### 4. ProviderDomain

**Purpose**: Represents a File Provider domain configuration (corresponds to one ONE instance).

**Attributes**:
- `identifier`: NSFileProviderDomainIdentifier
  - Unique domain ID
  - Format: "com.refinio.one.provider.{uuid}"
  - **Validation**: Must match bundle ID pattern

- `displayName`: String
  - User-visible name in Finder sidebar
  - Example: "ONE Database - Home"
  - **Validation**: Non-empty, max 64 characters

- `instancePath`: URL
  - File URL to ONE database directory
  - Example: "file:///Users/username/Library/Application Support/OneProvider/domain-123/"
  - **Validation**: Must be valid file:// URL, directory must exist or be creatable

- `rootIdentifier`: NSFileProviderItemIdentifier
  - Always "fp-folder-root"
  - **Validation**: Fixed value

- `syncStatus`: SyncStatus (enum)
  - Values: `.notSynced`, `.syncing`, `.synced`, `.error(message: String)`
  - **Validation**: Valid state transition only

- `createdAt`: Date
- `lastSyncAt`: Date?
  - When last successful sync completed
  - **Validation**: >= createdAt if present

**Relationships**:
- Has one root FolderItem
- Has many FileItem and FolderItem in hierarchy

**Validation Rules**:
- Identifier must be unique across all domains
- InstancePath must be accessible (read/write permissions)
- Cannot remove domain while syncing

**Swift Representation**:
```swift
struct ProviderDomain: Identifiable {
    let identifier: NSFileProviderDomainIdentifier
    var displayName: String
    let instancePath: URL
    let rootIdentifier: NSFileProviderItemIdentifier
    var syncStatus: SyncStatus
    let createdAt: Date
    var lastSyncAt: Date?
}

enum SyncStatus: Codable {
    case notSynced
    case syncing
    case synced
    case error(message: String)
}
```

---

### 5. ChangeEvent

**Purpose**: Represents a change to track for sync anchor support.

**Attributes**:
- `version`: UInt64
  - Monotonically increasing version number
  - **Validation**: Increments by 1 from previous

- `timestamp`: Date
  - When change occurred
  - **Validation**: Not in future

- `changeType`: ChangeType (enum)
  - Values: `.created`, `.modified`, `.deleted`, `.moved`
  - **Validation**: Must be one of defined types

- `itemIdentifier`: NSFileProviderItemIdentifier
  - Item that changed
  - **Validation**: Must reference valid item

- `parentIdentifier`: NSFileProviderItemIdentifier?
  - New parent for move operations
  - **Validation**: Present if and only if changeType is .moved

- `oneObjectHash`: SHA256Hash?
  - Corresponding ONE object hash
  - **Validation**: 64 hex characters if present

**Relationships**:
- References one FileItem or FolderItem (via itemIdentifier)

**Validation Rules**:
- Version numbers must be gapless (no skipped versions)
- Timestamp must be monotonically increasing (or equal) within version sequence
- ParentIdentifier required for .moved, null otherwise

**Swift Representation**:
```swift
struct ChangeEvent: Codable, Identifiable {
    let version: UInt64
    let timestamp: Date
    let changeType: ChangeType
    let itemIdentifier: NSFileProviderItemIdentifier
    let parentIdentifier: NSFileProviderItemIdentifier?
    let oneObjectHash: SHA256Hash?

    var id: UInt64 { version }
}

enum ChangeType: String, Codable {
    case created, modified, deleted, moved
}
```

---

### 6. ThumbnailData

**Purpose**: Cached thumbnail image for quick preview display.

**Attributes**:
- `itemIdentifier`: NSFileProviderItemIdentifier
  - Associated FileItem
  - **Validation**: Must reference existing FileItem

- `thumbnailData`: Data
  - PNG or JPEG image data
  - **Validation**: Valid image format, max 1MB

- `size`: CGSize
  - Dimensions of thumbnail
  - **Validation**: width > 0, height > 0

- `generatedAt`: Date
  - When thumbnail was created
  - **Validation**: Not in future

- `expiresAt`: Date
  - When to invalidate/regenerate thumbnail
  - **Validation**: > generatedAt

**Relationships**:
- Belongs to one FileItem (1:1)

**Validation Rules**:
- ThumbnailData size should be reasonable (<1MB)
- ExpiresAt typically generatedAt + 7 days
- Regenerate if source file modified after generatedAt

**Swift Representation**:
```swift
struct ThumbnailData: Codable {
    let itemIdentifier: NSFileProviderItemIdentifier
    let thumbnailData: Data
    let size: CGSize
    let generatedAt: Date
    let expiresAt: Date
}
```

---

## Entity Relationships Diagram

```
ProviderDomain (1) ──has──> (1) root FolderItem
                   └──contains──> (*) FileItem
                   └──contains──> (*) FolderItem

FolderItem (1) ──contains──> (*) FileItem
               ├──contains──> (*) FolderItem (subfolders)
               └──belongs to──> (1) FolderItem (parent) or root

FileItem (1) ──belongs to──> (1) FolderItem (parent)
             ├──has──> (0..1) ThumbnailData
             └──referenced by──> (*) FileOperation

FileOperation (*) ──references──> (1) FileItem or FolderItem

ChangeEvent (*) ──references──> (1) FileItem or FolderItem
```

---

## Branded Types (from user's CLAUDE.md)

**SHA256Hash**: String type alias with compile-time brand for type safety

```swift
struct SHA256Hash: Hashable, Codable, ExpressibleByStringLiteral {
    let value: String

    init(stringLiteral value: String) {
        // Validation: 64 hex characters
        assert(value.matches(/^[a-f0-9]{64}$/), "Invalid SHA256 hash")
        self.value = value
    }

    init(_ value: String) {
        assert(value.matches(/^[a-f0-9]{64}$/), "Invalid SHA256 hash")
        self.value = value
    }
}
```

**SHA256IdHash**: Similar to SHA256Hash, used for object identifiers

```swift
typealias SHA256IdHash = SHA256Hash  // Same validation, semantic distinction
```

These branded types ensure SHA256 hashes can't be accidentally mixed with regular strings, providing compile-time safety.

---

## Persistence

**Storage Locations**:
- **FileItem/FolderItem metadata**: MetadataCache (in-memory) + ONE database (disk)
- **FileOperation queue**: UserDefaults or SQLite in File Provider extension container
- **ChangeEvent log**: SQLite in File Provider extension container
- **ThumbnailData**: On-disk cache in NSFileProviderDomain storage location
- **ProviderDomain config**: Shared UserDefaults between app and extension

**Persistence Requirements**:
- FileOperation queue must survive extension restarts
- ChangeEvent log must persist indefinitely (or at least 30 days)
- ThumbnailData can be evicted by system based on disk pressure
- MetadataCache is ephemeral (in-memory only)

---

## Validation Summary

**Critical Validations** (fail fast, throw on violation):
- SHA256Hash format (64 hex chars)
- Filename uniqueness within folder
- No filesystem cycle creation
- Version identifier monotonicity
- Operation status valid transitions

**Soft Validations** (log warning, use fallback):
- Thumbnail generation failure → use default icon
- ContentType unknown → fallback to public.data
- Expired thumbnail → regenerate in background

Per user's principle "No fallbacks, we throw", most validations should throw errors and let the system handle recovery, rather than silently falling back to defaults. Only presentation-layer concerns (icons, previews) use fallbacks.

---

## ONE Core Integration

**Mapping ONE objects to File Provider entities**:

```
ONE Object (SHA256 hash)
  ├─ Type: "file" → FileItem
  ├─ Type: "folder" → FolderItem
  └─ Type: "metadata" → ThumbnailData or other metadata

FileItem.contentHash → ONE object hash (immutable)
FolderItem.metadataHash → ONE object with child list

Changes in ONE → ChangeEvent → File Provider sync
```

**Example ONE object structure** (from one.models):
```json
{
  "$type$": "FileObject",
  "name": "document.txt",
  "size": 1024,
  "contentHash": "abc123...",
  "mimeType": "text/plain",
  "createdAt": "2025-10-17T10:00:00Z",
  "modifiedAt": "2025-10-17T11:30:00Z"
}
```

Maps to FileItem with:
- filename = "document.txt"
- contentSize = 1024
- contentHash = "abc123..."
- contentType = UTType("public.plain-text")
- etc.

---

## Error Handling

**Error Types**:
1. **ValidationError**: Entity validation failed (filename too long, invalid hash, etc.)
2. **PersistenceError**: Failed to save/load from disk/database
3. **IPCError**: Communication with Node.js runtime failed
4. **ONEError**: one.core/one.models operation failed

**Strategy** (per user's principle):
- **Throw immediately**: Don't mitigate, don't retry with delays
- **Log context**: Include entity details in error
- **Propagate to user**: Show actionable error in Finder/Files

Example:
```swift
guard filename.count <= 255 else {
    throw ValidationError.filenameTooLong(filename: filename, maxLength: 255)
}
```

**Not allowed**:
```swift
// BAD: Silently truncate (mitigates instead of failing)
let safeFilename = String(filename.prefix(255))

// BAD: Arbitrary retry delay
await Task.sleep(nanoseconds: 1_000_000_000)  // 1 second delay
```

This aligns with user's philosophy: "No fallbacks. We do not mitigate. We fail fast and throw. We fix our problems."
