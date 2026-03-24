# ProjFS Integration for Content-Addressed Database

## Overview

Windows Projected File System (ProjFS) integration for a local-first, content-addressed database with CRDT versioning. This enables virtual filesystem access where files appear on-demand from SHA256-addressed content blocks stored in the host filesystem.

## Architecture

```
User Application (Explorer, Office, etc.)
              ↓
        ProjFS Driver
              ↓
     Node-API Wrapper
              ↓
    TypeScript ESM App
              ↓
   CRDT Version Store ← → Content-Addressed Store
   (path → SHA256)        (SHA256 → file blocks)
```

## Core Components

### 1. Content Store Structure

Content blocks stored in host filesystem using Git-style sharding:
```
./content-store/
  ab/
    cd1234567890abcdef... (SHA256 filename)
  ef/
    1234567890abcdef...
```

### 2. CRDT Mapping

Maps virtual paths to current content hashes:
```typescript
interface PathMapping {
  virtualPath: string;     // "/documents/report.pdf"
  currentHash: string;     // SHA256 of current version
  metadata: FileMetadata;  // size, timestamps, permissions
}
```

### 3. ProjFS Provider Interface

```typescript
interface ProjFSProvider {
  // Called when user/app accesses virtual file
  onGetPlaceholderInfo(path: string): Promise<FileInfo>;
  
  // Called to read file content ranges
  onGetFileData(path: string, offset: number, length: number): Promise<Buffer>;
  
  // Called when file is modified
  onNotifyFileHandleClosedFileModified(path: string): Promise<void>;
  
  // Called to enumerate directory contents
  onGetDirectoryEnumeration(path: string): Promise<DirectoryEntry[]>;
}
```

## Implementation Strategy

### Phase 1: Node-API Wrapper

Create C++ wrapper around `ProjectedFSLib.dll`:

```cpp
#include <napi.h>
#include <ProjectedFSLib.h>

class ProjFSWrapper : public Napi::ObjectWrap<ProjFSWrapper> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  ProjFSWrapper(const Napi::CallbackInfo& info);
  
private:
  Napi::Value StartVirtualization(const Napi::CallbackInfo& info);
  Napi::Value StopVirtualization(const Napi::CallbackInfo& info);
  
  // Thread-safe callback marshaling
  static void OnGetFileDataCallback(/* ProjFS params */);
  napi_threadsafe_function fileDataCallback_;
};
```

### Phase 2: TypeScript Integration

```typescript
import { ProjFSProvider } from './projfs-native';

export class ContentAddressedFS implements ProjFSProvider {
  constructor(
    private crdtStore: CRDTStore,
    private contentStore: ContentStore,
    private virtualRoot: string
  ) {}

  async onGetPlaceholderInfo(path: string): Promise<FileInfo> {
    const mapping = await this.crdtStore.getLatestMapping(path);
    if (!mapping) throw new Error('File not found');
    
    const contentPath = this.getContentPath(mapping.currentHash);
    const stats = await fs.stat(contentPath);
    
    return {
      size: stats.size,
      creationTime: mapping.metadata.createdAt,
      lastWriteTime: mapping.metadata.modifiedAt,
      attributes: mapping.metadata.attributes
    };
  }

  async onGetFileData(path: string, offset: number, length: number): Promise<Buffer> {
    const mapping = await this.crdtStore.getLatestMapping(path);
    const contentPath = this.getContentPath(mapping.currentHash);
    
    // Direct filesystem read - fast and efficient
    const fd = await fs.open(contentPath, 'r');
    const buffer = Buffer.allocUnsafe(length);
    await fd.read(buffer, 0, length, offset);
    await fd.close();
    
    return buffer;
  }

  async onNotifyFileHandleClosedFileModified(path: string): Promise<void> {
    // File was modified, need to update content store
    const tempPath = this.getTempPath(path);
    const newHash = await this.computeHash(tempPath);
    const newContentPath = this.getContentPath(newHash);
    
    // Move to content-addressed location
    await fs.rename(tempPath, newContentPath);
    
    // Update CRDT with new hash
    await this.crdtStore.updateMapping(path, newHash, {
      modifiedAt: new Date(),
      size: (await fs.stat(newContentPath)).size
    });
    
    // Sync to other devices
    this.syncEngine.notifyChange(path, newHash);
  }

  private getContentPath(hash: string): string {
    return `./content-store/${hash.slice(0, 2)}/${hash}`;
  }

  private async computeHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    
    return hash.digest('hex');
  }
}
```

### Phase 3: Electron Integration

```typescript
// main.ts
import { app } from 'electron';
import { ContentAddressedFS } from './projfs-provider';

app.whenReady().then(async () => {
  const virtualRoot = 'C:\\MyCloudDrive';
  const provider = new ContentAddressedFS(crdtStore, contentStore, virtualRoot);
  
  // Start ProjFS virtualization
  await provider.start();
  
  console.log(`Virtual filesystem mounted at ${virtualRoot}`);
});
```

## Performance Considerations

### Content Store Optimization

1. **Directory Sharding**: Use first 2 hex chars for directory structure
2. **OS Page Cache**: Let Windows cache frequently accessed content blocks
3. **Async I/O**: Use `fs.promises` for all filesystem operations
4. **Memory Mapping**: Consider `mmap` for very large files

### CRDT Store Optimization

1. **Local Cache**: Cache path → hash mappings in memory
2. **Batch Updates**: Group CRDT operations during sync
3. **Index Structure**: Efficient path prefix lookups for directory enumeration

### ProjFS Callback Performance

Critical: ProjFS callbacks must respond quickly (< 100ms typical)

```typescript
class PerformanceOptimizedProvider {
  private pathCache = new LRU<string, PathMapping>(10000);
  private contentCache = new LRU<string, Buffer>(100); // Hot content blocks
  
  async onGetFileData(path: string, offset: number, length: number): Promise<Buffer> {
    // Check if we have this range cached
    const cacheKey = `${path}:${offset}:${length}`;
    const cached = this.contentCache.get(cacheKey);
    if (cached) return cached;
    
    // Fast path lookup
    const mapping = this.pathCache.get(path) || await this.crdtStore.getLatestMapping(path);
    this.pathCache.set(path, mapping);
    
    // Direct file read
    const buffer = await this.readContentRange(mapping.currentHash, offset, length);
    
    // Cache small ranges
    if (length < 64 * 1024) {
      this.contentCache.set(cacheKey, buffer);
    }
    
    return buffer;
  }
}
```

## Sync Strategy

### Conflict Resolution

Since files are content-addressed, conflicts are handled at the CRDT level:

```typescript
interface CRDTEntry {
  path: string;
  hash: string;
  timestamp: number;
  deviceId: string;
  operation: 'create' | 'update' | 'delete';
}

// CRDT automatically resolves conflicts
// Latest timestamp wins for same path
// Different hashes indicate concurrent modifications
```

### Efficient Sync Protocol

1. **CRDT Delta Sync**: Only sync CRDT changes, not file content
2. **Content Deduplication**: Same SHA256 = already have content
3. **Lazy Content Fetch**: Only download content when accessed via ProjFS

```typescript
async syncToDevice(targetDevice: DeviceId): Promise<void> {
  // 1. Get CRDT deltas since last sync
  const deltas = await this.crdtStore.getDeltasSince(this.lastSyncTime[targetDevice]);
  
  // 2. Send deltas
  await this.sendDeltas(targetDevice, deltas);
  
  // 3. Content will be fetched on-demand via ProjFS
  // No need to pre-sync all content blocks
}
```

## Error Handling

### ProjFS Error Recovery

```typescript
try {
  return await this.onGetFileData(path, offset, length);
} catch (error) {
  // Log but don't crash ProjFS
  console.error(`ProjFS error for ${path}:`, error);
  
  // Return empty buffer or throw specific ProjFS error
  throw new ProjFSError('HRESULT_FILE_NOT_FOUND');
}
```

### Content Store Corruption

```typescript
async verifyContentIntegrity(hash: string): Promise<boolean> {
  const contentPath = this.getContentPath(hash);
  const actualHash = await this.computeHash(contentPath);
  return actualHash === hash;
}

async repairCorruptedContent(hash: string): Promise<void> {
  // Try to fetch from other devices
  await this.syncEngine.requestContent(hash);
}
```

## Security Considerations

1. **Path Validation**: Sanitize all virtual paths to prevent directory traversal
2. **Content Verification**: Always verify SHA256 matches before serving content
3. **Access Control**: Implement per-path permissions in CRDT metadata
4. **Encryption**: Consider encrypting content blocks at rest

## Testing Strategy

1. **Unit Tests**: Test individual ProjFS callbacks
2. **Integration Tests**: Test with real Windows applications
3. **Performance Tests**: Measure callback response times
4. **Stress Tests**: High-concurrency file access scenarios
5. **Corruption Tests**: Verify recovery from corrupted content blocks

## Deployment

### Prerequisites
- Windows 10 version 1803 or later
- Developer mode enabled (for ProjFS)
- Node.js with native module compilation support

### Installation
```bash
npm install
npm run build:native  # Compile Node-API wrapper
npm run start         # Start virtual filesystem
```

### Configuration
```json
{
  "virtualRoot": "C:\\MyCloudDrive",
  "contentStore": "./content-store",
  "crdtStore": "./crdt.db",
  "performance": {
    "pathCacheSize": 10000,
    "contentCacheSize": 100,
    "maxCallbackTime": 100
  }
}
```

## Future Enhancements

1. **Cross-Platform**: macOS Network File System, Linux FUSE
2. **P2P Sync**: Direct device-to-device content sharing
3. **Selective Sync**: Pin/unpin files for offline availability
4. **Version History**: Access historical file versions
5. **Collaboration**: Real-time collaborative editing support