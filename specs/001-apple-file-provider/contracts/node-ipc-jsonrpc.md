# Node.js IPC JSON-RPC Contract

**Version**: 1.0.0
**Date**: 2025-10-17
**Protocol**: JSON-RPC 2.0
**Transport**: stdin/stdout (line-delimited JSON)

## Overview

This contract defines the JSON-RPC 2.0 API between the Swift File Provider extension and the Node.js runtime hosting one.core/one.models. Communication occurs over standard input/output streams with newline-delimited JSON messages.

**Reference**: [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)

---

## Transport Protocol

**Message Format**: Each message is a single line of JSON terminated by `\n`

**Request** (Swift → Node.js):
```json
{"jsonrpc":"2.0","method":"methodName","params":{...},"id":1}\n
```

**Response** (Node.js → Swift):
```json
{"jsonrpc":"2.0","result":{...},"id":1}\n
```

**Error Response**:
```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Error description","data":{...}},"id":1}\n
```

**Notification** (no response expected):
```json
{"jsonrpc":"2.0","method":"notificationName","params":{...}}\n
```

---

## Standard Error Codes

| Code | Meaning | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON received |
| -32600 | Invalid Request | JSON-RPC request malformed |
| -32601 | Method not found | Method doesn't exist |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Internal JSON-RPC error |
| -32000 | ONE error | one.core/one.models error (see data.code) |
| -32001 | Not initialized | initialize() not called |
| -32002 | Already initialized | initialize() called twice |
| -32003 | Object not found | Requested hash doesn't exist |
| -32004 | Permission denied | Insufficient permissions |
| -32005 | Invalid hash | Malformed SHA256 hash |

---

## API Methods

### 1. initialize

**Purpose**: Initialize connection to ONE database instance.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "instancePath": "/Users/username/Library/Application Support/OneProvider/domain-123/"
  },
  "id": 1
}
```

**Parameters**:
- `instancePath` (string, required): Absolute file path to ONE database directory

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "version": "0.6.1-beta-2",
    "rootHash": "abc123...",
    "capabilities": ["read", "write", "delete", "enumerate"]
  },
  "id": 1
}
```

**Response Fields**:
- `success` (boolean): Always true on success
- `version` (string): one.core version
- `rootHash` (string): SHA256 hash of root folder object
- `capabilities` (string[]): Supported operations

**Errors**:
- `-32002`: Already initialized
- `-32000`: ONE initialization failed (see error.data for details)

---

### 2. getObject

**Purpose**: Retrieve a ONE object by its SHA256 hash.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "getObject",
  "params": {
    "hash": "abc123def456..."
  },
  "id": 2
}
```

**Parameters**:
- `hash` (string, required): SHA256 hash (64 hex characters)

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "$type$": "FileObject",
    "name": "document.txt",
    "size": 1024,
    "contentHash": "xyz789...",
    "mimeType": "text/plain",
    "createdAt": "2025-10-17T10:00:00.000Z",
    "modifiedAt": "2025-10-17T11:30:00.000Z"
  },
  "id": 2
}
```

**Response Fields**: Depends on object type ($type$ field)

**Common object types**:
- `FileObject`: File metadata and content reference
- `FolderObject`: Folder metadata and child list
- `ContentBlob`: Raw file content (base64-encoded)

**Errors**:
- `-32001`: Not initialized
- `-32003`: Object not found
- `-32005`: Invalid hash format

---

### 3. getChildren

**Purpose**: Enumerate children of a folder object.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "getChildren",
  "params": {
    "hash": "folder123...",
    "offset": 0,
    "limit": 100
  },
  "id": 3
}
```

**Parameters**:
- `hash` (string, required): SHA256 hash of folder object
- `offset` (number, optional): Pagination offset (default: 0)
- `limit` (number, optional): Max items to return (default: 100, max: 1000)

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "children": [
      {
        "hash": "file1...",
        "name": "document.txt",
        "type": "file",
        "size": 1024,
        "modifiedAt": "2025-10-17T10:00:00.000Z"
      },
      {
        "hash": "folder2...",
        "name": "subfolder",
        "type": "folder",
        "childCount": 5,
        "modifiedAt": "2025-10-17T09:00:00.000Z"
      }
    ],
    "totalCount": 42,
    "hasMore": false
  },
  "id": 3
}
```

**Response Fields**:
- `children` (array): Array of child metadata objects
- `totalCount` (number): Total children count (for pagination)
- `hasMore` (boolean): True if more items available beyond limit

**Errors**:
- `-32001`: Not initialized
- `-32003`: Folder object not found
- `-32000`: Object is not a folder

---

### 4. getContent

**Purpose**: Retrieve file content by content hash.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "getContent",
  "params": {
    "hash": "content123...",
    "offset": 0,
    "length": 4096
  },
  "id": 4
}
```

**Parameters**:
- `hash` (string, required): SHA256 hash of content blob
- `offset` (number, optional): Byte offset to start reading (default: 0)
- `length` (number, optional): Bytes to read (default: entire file)

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": "SGVsbG8gd29ybGQh...",
    "encoding": "base64",
    "size": 1024,
    "bytesRead": 1024
  },
  "id": 4
}
```

**Response Fields**:
- `content` (string): File content (base64-encoded)
- `encoding` (string): Always "base64"
- `size` (number): Total content size in bytes
- `bytesRead` (number): Bytes included in this response

**Errors**:
- `-32001`: Not initialized
- `-32003`: Content object not found
- `-32000`: Invalid offset or length

---

### 5. createObject

**Purpose**: Create a new ONE object (file or folder).

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "createObject",
  "params": {
    "type": "file",
    "name": "new-document.txt",
    "parentHash": "folder123...",
    "content": "SGVsbG8gd29ybGQh...",
    "encoding": "base64",
    "mimeType": "text/plain"
  },
  "id": 5
}
```

**Parameters**:
- `type` (string, required): "file" or "folder"
- `name` (string, required): Object name
- `parentHash` (string, required): Parent folder hash
- `content` (string, optional): File content (base64-encoded), required for type=file
- `encoding` (string, optional): Always "base64" if content present
- `mimeType` (string, optional): MIME type (default: application/octet-stream)

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "hash": "newfile456...",
    "contentHash": "content789...",
    "size": 12,
    "createdAt": "2025-10-17T12:00:00.000Z"
  },
  "id": 5
}
```

**Response Fields**:
- `hash` (string): SHA256 hash of new object
- `contentHash` (string, optional): Content blob hash (for files)
- `size` (number): Content size in bytes
- `createdAt` (string): ISO 8601 timestamp

**Errors**:
- `-32001`: Not initialized
- `-32003`: Parent folder not found
- `-32004`: Permission denied
- `-32000`: Name conflict or validation error

---

### 6. updateObject

**Purpose**: Update an existing ONE object (creates new version due to immutability).

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "updateObject",
  "params": {
    "hash": "file123...",
    "changes": {
      "name": "renamed-document.txt",
      "content": "VXBkYXRlZCBjb250ZW50...",
      "encoding": "base64"
    }
  },
  "id": 6
}
```

**Parameters**:
- `hash` (string, required): SHA256 hash of object to update
- `changes` (object, required): Fields to update
  - `name` (string, optional): New name
  - `content` (string, optional): New content (base64-encoded)
  - `encoding` (string, optional): "base64" if content present

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "hash": "newversion789...",
    "contentHash": "newcontent456...",
    "size": 24,
    "modifiedAt": "2025-10-17T12:30:00.000Z"
  },
  "id": 6
}
```

**Response Fields**:
- `hash` (string): SHA256 hash of new version
- `contentHash` (string, optional): New content blob hash
- `size` (number): New content size
- `modifiedAt` (string): ISO 8601 timestamp

**Errors**:
- `-32001`: Not initialized
- `-32003`: Object not found
- `-32004`: Permission denied
- `-32000`: Validation error

---

### 7. deleteObject

**Purpose**: Delete a ONE object (file or folder).

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "deleteObject",
  "params": {
    "hash": "file123...",
    "recursive": false
  },
  "id": 7
}
```

**Parameters**:
- `hash` (string, required): SHA256 hash of object to delete
- `recursive` (boolean, optional): Delete children if folder (default: false)

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "deletedCount": 1
  },
  "id": 7
}
```

**Response Fields**:
- `success` (boolean): Always true on success
- `deletedCount` (number): Number of objects deleted (>1 if recursive)

**Errors**:
- `-32001`: Not initialized
- `-32003`: Object not found
- `-32004`: Permission denied
- `-32000`: Folder not empty and recursive=false

---

### 8. moveObject

**Purpose**: Move an object to a different parent folder.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "method": "moveObject",
  "params": {
    "hash": "file123...",
    "newParentHash": "folder456..."
  },
  "id": 8
}
```

**Parameters**:
- `hash` (string, required): Object to move
- `newParentHash` (string, required): Target parent folder hash

**Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "newHash": "file123..."
  },
  "id": 8
}
```

**Response Fields**:
- `success` (boolean): Always true on success
- `newHash` (string): Hash after move (may be same if only parent reference changes)

**Errors**:
- `-32001`: Not initialized
- `-32003`: Object or parent not found
- `-32004`: Permission denied
- `-32000`: Would create cycle, name conflict, or validation error

---

## Notifications (Node.js → Swift)

Notifications are sent without an `id` field and don't expect a response.

### onChange

**Purpose**: Notify Swift of changes in the ONE database.

**Notification**:
```json
{
  "jsonrpc": "2.0",
  "method": "onChange",
  "params": {
    "changeType": "created",
    "hash": "newfile123...",
    "parentHash": "folder456...",
    "name": "new-document.txt",
    "timestamp": "2025-10-17T13:00:00.000Z"
  }
}
```

**Parameters**:
- `changeType` (string): "created", "modified", "deleted", "moved"
- `hash` (string): Object hash
- `parentHash` (string, optional): Parent folder hash (null if root or deleted)
- `name` (string, optional): Object name (null if deleted)
- `timestamp` (string): ISO 8601 timestamp

**Usage**: Swift's `ChangeTracker` actor receives these and updates File Provider accordingly.

---

### onError

**Purpose**: Notify Swift of background errors in the Node.js runtime.

**Notification**:
```json
{
  "jsonrpc": "2.0",
  "method": "onError",
  "params": {
    "errorCode": "CONNECTION_LOST",
    "message": "ONE database connection lost",
    "recoverable": true
  }
}
```

**Parameters**:
- `errorCode` (string): Machine-readable error code
- `message` (string): Human-readable error message
- `recoverable` (boolean): Can be retried or requires re-initialization

---

## Type Definitions (TypeScript)

```typescript
// Request/Response base types
interface JSONRPCRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number | string;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: JSONRPCError;
  id: number | string;
}

interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ONE object types
interface FileObject {
  $type$: "FileObject";
  name: string;
  size: number;
  contentHash: string;  // SHA256
  mimeType: string;
  createdAt: string;    // ISO 8601
  modifiedAt: string;   // ISO 8601
}

interface FolderObject {
  $type$: "FolderObject";
  name: string;
  childCount: number;
  createdAt: string;
  modifiedAt: string;
}

interface ContentBlob {
  $type$: "ContentBlob";
  data: string;  // base64-encoded
  size: number;
}

// Method parameter types
interface InitializeParams {
  instancePath: string;
}

interface GetObjectParams {
  hash: string;
}

interface GetChildrenParams {
  hash: string;
  offset?: number;
  limit?: number;
}

interface GetContentParams {
  hash: string;
  offset?: number;
  length?: number;
}

interface CreateObjectParams {
  type: "file" | "folder";
  name: string;
  parentHash: string;
  content?: string;  // base64
  encoding?: "base64";
  mimeType?: string;
}

interface UpdateObjectParams {
  hash: string;
  changes: {
    name?: string;
    content?: string;  // base64
    encoding?: "base64";
  };
}

interface DeleteObjectParams {
  hash: string;
  recursive?: boolean;
}

interface MoveObjectParams {
  hash: string;
  newParentHash: string;
}

// Response result types
interface InitializeResult {
  success: boolean;
  version: string;
  rootHash: string;
  capabilities: string[];
}

interface CreateObjectResult {
  hash: string;
  contentHash?: string;
  size: number;
  createdAt: string;
}

interface UpdateObjectResult {
  hash: string;
  contentHash?: string;
  size: number;
  modifiedAt: string;
}

interface DeleteObjectResult {
  success: boolean;
  deletedCount: number;
}

interface MoveObjectResult {
  success: boolean;
  newHash: string;
}

interface GetChildrenResult {
  children: ChildMetadata[];
  totalCount: number;
  hasMore: boolean;
}

interface ChildMetadata {
  hash: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  childCount?: number;
  modifiedAt: string;
}

interface GetContentResult {
  content: string;  // base64
  encoding: "base64";
  size: number;
  bytesRead: number;
}

// Notification parameter types
interface OnChangeParams {
  changeType: "created" | "modified" | "deleted" | "moved";
  hash: string;
  parentHash?: string;
  name?: string;
  timestamp: string;
}

interface OnErrorParams {
  errorCode: string;
  message: string;
  recoverable: boolean;
}
```

---

## Swift Type Definitions

```swift
// JSON-RPC message types
struct JSONRPCRequest: Codable {
    let jsonrpc = "2.0"
    let method: String
    let params: AnyCodable?
    let id: JSONRPCId
}

enum JSONRPCId: Codable {
    case int(Int)
    case string(String)
}

struct JSONRPCResponse: Codable {
    let jsonrpc: String
    let result: AnyCodable?
    let error: JSONRPCError?
    let id: JSONRPCId
}

struct JSONRPCError: Codable {
    let code: Int
    let message: String
    let data: AnyCodable?
}

struct JSONRPCNotification: Codable {
    let jsonrpc = "2.0"
    let method: String
    let params: AnyCodable?
}

// ONE object types
struct FileObject: Codable {
    let type: String  // "$type$"
    let name: String
    let size: UInt64
    let contentHash: SHA256Hash
    let mimeType: String
    let createdAt: Date
    let modifiedAt: Date

    private enum CodingKeys: String, CodingKey {
        case type = "$type$"
        case name, size, contentHash, mimeType, createdAt, modifiedAt
    }
}

struct FolderObject: Codable {
    let type: String  // "$type$"
    let name: String
    let childCount: Int
    let createdAt: Date
    let modifiedAt: Date

    private enum CodingKeys: String, CodingKey {
        case type = "$type$"
        case name, childCount, createdAt, modifiedAt
    }
}
```

---

## Example Message Flow

**1. Initialize connection**:
```
Swift → Node.js:
{"jsonrpc":"2.0","method":"initialize","params":{"instancePath":"/path/to/one"},"id":1}

Node.js → Swift:
{"jsonrpc":"2.0","result":{"success":true,"version":"0.6.1","rootHash":"abc..."},"id":1}
```

**2. Enumerate root folder**:
```
Swift → Node.js:
{"jsonrpc":"2.0","method":"getChildren","params":{"hash":"abc...","limit":100},"id":2}

Node.js → Swift:
{"jsonrpc":"2.0","result":{"children":[...],"totalCount":42,"hasMore":false},"id":2}
```

**3. Create new file**:
```
Swift → Node.js:
{"jsonrpc":"2.0","method":"createObject","params":{"type":"file","name":"test.txt","parentHash":"abc...","content":"SGVsbG8=","encoding":"base64"},"id":3}

Node.js → Swift:
{"jsonrpc":"2.0","result":{"hash":"xyz...","contentHash":"def...","size":5,"createdAt":"2025-10-17T13:00:00.000Z"},"id":3}
```

**4. Receive change notification**:
```
Node.js → Swift:
{"jsonrpc":"2.0","method":"onChange","params":{"changeType":"created","hash":"xyz...","parentHash":"abc...","name":"test.txt","timestamp":"2025-10-17T13:00:00.000Z"}}
```

---

## Testing

**Unit tests should verify**:
1. JSON serialization/deserialization of all message types
2. Error code handling
3. Parameter validation

**Integration tests should verify**:
1. Process spawning and IPC stream setup
2. Request/response matching by ID
3. Notification handling without responses
4. Error propagation from Node.js to Swift
5. Process crash recovery

---

## Security Considerations

1. **Input validation**: Node.js must validate all SHA256 hashes (64 hex chars)
2. **Path validation**: Ensure instancePath doesn't escape allowed directories
3. **Content size limits**: Reject excessively large content uploads (e.g., >100MB in single request)
4. **Rate limiting**: Protect against request flooding from Swift layer
5. **Process isolation**: Node.js runs as child process, crashes don't affect Swift extension

---

## Performance Guidelines

1. **Batch requests**: Use single getChildren call instead of multiple getObject calls
2. **Pagination**: Always use offset/limit for large folders (>100 items)
3. **Content streaming**: For files >10MB, fetch in chunks using offset/length
4. **Cache metadata**: Swift should cache getObject results to minimize IPC round-trips
5. **Async processing**: Don't block File Provider callbacks waiting for Node.js responses

---

## Versioning

**Contract Version**: 1.0.0

**Breaking changes** (require major version bump):
- Removing or renaming methods
- Changing parameter types
- Changing response structure

**Non-breaking changes** (minor version bump):
- Adding new methods
- Adding optional parameters
- Adding new error codes

**Backward compatibility**: Node.js runtime should check contract version in initialize() and reject incompatible versions.
