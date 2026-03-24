# one.provider

Apple File Provider integration for ONE - macOS filesystem bridge using File Provider API.

## Architecture

```
Finder/Files App
      ↓
File Provider Extension (Swift, sandboxed process)
      ↓
ONEBridge (Swift Actor)
      ↓
Node.js Process (JSON-RPC over stdin/stdout)
      ↓
IFileSystem interface (TypeScript)
      ↓
one.core + one.models (content-addressed storage)
```

## Building

### 1. Build TypeScript IPC Server

```bash
npm install
npm run build
```

When `/Users/gecko/src/one` exists, the build copies `@refinio/one.core` and
`@refinio/one.models` from that sibling workspace into `node-runtime/node_modules`.
Otherwise it falls back to the vendored tarballs in `vendor/`.

### 2. Build Swift Package and CLI Tool

```bash
swift build
# or
npm run build:swift
```

### 3. Create App Bundle

```bash
./scripts/create-app-bundle.sh
```

This creates `OneFiler.app` with the CLI tool at:
`.build/debug/OneFiler.app/Contents/MacOS/onefiler`

## Usage

### CLI Commands

```bash
# Register a File Provider domain
.build/debug/OneFiler.app/Contents/MacOS/onefiler register \
  --name "ONE" \
  --path "/Users/user/.refinio/instance"

# List registered domains
.build/debug/OneFiler.app/Contents/MacOS/onefiler list

# Unregister a domain
.build/debug/OneFiler.app/Contents/MacOS/onefiler unregister --name "ONE"
```

### Integration with refinio.api

The File Provider is automatically used by refinio.api on macOS when configured:

```typescript
// In refinio-api.config.json
{
  "filer": {
    "mountPoint": "/Users/user/ONE",  // Not used directly on macOS
    "inviteUrlPrefix": "https://one.refinio.net/invite"
  }
}
```

refinio.api will:
1. Detect macOS platform
2. Find OneFiler CLI tool
3. Register File Provider domain programmatically
4. Start IPC server to handle extension requests

## Testing

### Connection Integration Test

This test verifies end-to-end functionality:
- File Provider mount exposes ONE storage
- Invite files are readable from the filesystem
- Connections can be established using invites
- Bidirectional contact creation works

**Prerequisites:**
- macOS 13.0+ (Ventura)
- refinio.api built (`cd ../refinio.api && npm run build`)
- one.provider built (`npm run build && npm run build:swift`)

**Run test:**

```bash
npm run test:connection
```

The test will:
1. Start a local CommunicationServer
2. Start a refinio.api server instance that registers the File Provider domain
3. Verify invite files are accessible in the mount
4. Start a client refinio.api instance that reads invites from the mounted filesystem
5. Establish connection using the invite
6. Verify bidirectional contact creation
7. Clean up all processes and storage

## Project Structure

```
one.provider/
├── Sources/
│   └── OneFiler/              # File Provider implementation
│       ├── FileProviderExtension.swift    # Main extension implementation
│       ├── FileProviderItem.swift         # File/directory item wrapper
│       ├── FileProviderEnumerators.swift  # Directory enumeration
│       └── ONEBridge.swift                # IPC bridge to Node.js
├── node-runtime/              # Node.js IPC server
│   ├── index.ts               # JSON-RPC server
│   └── lib/                   # Compiled output
├── packages/                  # Vendored dependencies
│   ├── one.core/
│   └── one.models/
├── test/
│   └── integration/
│       └── connection-test.js # Connection integration test
├── Package.swift              # Swift Package Manager config
├── package.json               # Node.js config
└── tsconfig.json             # TypeScript config
```

## IPC Protocol

The Swift ONEBridge communicates with Node.js via JSON-RPC 2.0 over stdin/stdout.

### Supported Methods

- `initialize(instancePath: string)` - Initialize file system
- `stat(path: string)` - Get file/directory metadata
- `readDir(path: string)` - List directory contents
- `readFile(path: string)` - Read file contents (base64)
- `readFileInChunks(path, length, position)` - Read file chunk
- `createDir(path, mode)` - Create directory
- `createFile(path, fileHash, fileName, mode)` - Create file
- `unlink(path)` - Delete file
- `rmdir(path)` - Remove directory
- `rename(src, dest)` - Rename/move file

### Example Request

```json
{"jsonrpc":"2.0","method":"stat","params":{"path":"/"},"id":1}
```

### Example Response

```json
{"jsonrpc":"2.0","result":{"mode":16877,"size":0},"id":1}
```

## Development

### Debug Logging

File Provider extension logs can be viewed in Console.app:

```bash
log stream --predicate 'subsystem == "com.one.provider"'
```

### Troubleshooting

**File Provider not mounting:**
1. Check System Settings → Privacy & Security → Extensions → File Provider
2. Verify entitlements are correct
3. Check Console.app for errors
4. Try removing and re-adding the domain

**IPC communication failing:**
1. Verify node-runtime is built: `npm run build`
2. Check Node.js is in PATH: `which node`
3. Inspect IPC logs in Console.app

**Test failures:**
1. Ensure refinio.api is built
2. Check all ports are free (8000, 50123, 50125)
3. Verify CommServer starts successfully
4. Clean up orphaned processes: `killall OneFilerMac node`

## Reference

This implementation follows the same architecture as:
- **one.fuse3** - Linux FUSE3 implementation
- **one.projfs** - Windows ProjFS implementation

See [specs/001-apple-file-provider/](../../specs/001-apple-file-provider/) for detailed specification and plan.
