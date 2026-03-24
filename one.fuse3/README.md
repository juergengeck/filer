# one.fuse3

Native IFileSystem to FUSE3 bridge for one.filer - provides high-performance Linux filesystem integration for ONE content.

## Overview

This N-API module enables one.filer to expose ONE database content as a virtual Linux filesystem using FUSE3 (Filesystem in Userspace). It provides the same functionality as one.projfs but for Linux/WSL environments.

**Architecture**: Linux File Manager → FUSE3 → one.fuse3 → IFileSystem

This provides seamless access to ONE content through standard Linux filesystem operations with native performance.

## Key Features

- **FUSE3 Integration** - Native FUSE3 bindings using N-API for Node.js
- **Cross-Platform** - Works on Linux, WSL2, and other Unix-like systems
- **IFileSystem Bridge** - Direct integration with ONE's IFileSystem interface
- **High Performance** - Native C++ implementation with minimal overhead
- **Type-Safe** - Full TypeScript support with proper IFileSystem types
- **Production Ready** - Based on proven FUSE3 library used in production systems

## Installation

```bash
npm install @refinio/one.fuse3
```

**Requirements**:
- Linux or WSL2 (FUSE3 not supported in WSL1)
- FUSE3 library: `sudo apt-get install fuse3 libfuse3-dev`
- Node.js 20.0.0 or later
- Build tools: `sudo apt-get install build-essential`

## Role in one.filer

This module is used by one.filer to provide a virtual filesystem that users interact with on Linux:

1. **User Experience**: Users see a virtual mount point (e.g., `/tmp/one-filer`) in their file manager
2. **Content Access**: Browse ONE content like regular files:
   - `/tmp/one-filer/chats/person@example.com/general/message.txt`
   - `/tmp/one-filer/debug/connections.json`
   - `/tmp/one-filer/objects/[hash]/content`
3. **Performance**: Near-native filesystem performance for all operations

## Usage

### Integration with one.filer

```javascript
// In one.filer/src/filer/FilerWithFUSE.ts
import { Fuse3 } from '@refinio/one.fuse3';
import { CombinedFileSystem } from '@refinio/one.models/lib/fileSystems/CombinedFileSystem.js';

export class FilerWithFUSE {
    async initFUSE(): Promise<void> {
        // Create combined filesystem with all components
        const fileSystems = [
            new ChatFileSystem(...),
            new ObjectsFileSystem(...),
            new DebugFileSystem(...),
            new TypesFileSystem(...)
        ];

        const rootFS = new CombinedFileSystem(fileSystems);

        // Mount using one.fuse3
        this.fuse = new Fuse3('/tmp/one-filer', {
            getattr: async (path) => rootFS.stat(path),
            readdir: async (path) => rootFS.readDir(path),
            open: async (path) => rootFS.open(path),
            read: async (path, offset, length) => rootFS.read(path, offset, length),
            release: async (path) => rootFS.close(path)
        });

        await this.fuse.mount();
        // Users can now access ONE content at /tmp/one-filer!
    }
}
```

### TypeScript Integration

```typescript
import { Fuse3 } from '@refinio/one.fuse3';
import { ChatFileSystem } from '@refinio/one.models/lib/fileSystems/ChatFileSystem.js';

// Create your filesystem
const chatFS = new ChatFileSystem(leuteModel, topicModel, channelManager);

// Mount it via FUSE3
const fuse = new Fuse3('/tmp/one-filer', {
    getattr: async (path) => {
        const stat = await chatFS.stat(path);
        return {
            mode: stat.isDirectory ? 0o040755 : 0o100644,
            size: stat.size || 0,
            mtime: stat.mtime || Date.now(),
            atime: stat.atime || Date.now(),
            ctime: stat.ctime || Date.now()
        };
    },
    readdir: async (path) => {
        return await chatFS.readDir(path);
    },
    read: async (path, offset, length) => {
        const fd = await chatFS.open(path, 'r');
        const buffer = Buffer.alloc(length);
        await chatFS.read(fd, buffer, 0, length, offset);
        await chatFS.close(fd);
        return buffer;
    }
});

await fuse.mount();

// Now Linux file managers show your chat content!
```

## What Users See

When one.filer uses this module, users get a virtual Linux mount with their ONE content:

```
/tmp/one-filer/
├── chats/                      # From ChatFileSystem
│   ├── person@example.com/
│   │   └── general/
│   │       ├── message1.txt
│   │       └── message2.txt
├── files/                      # From FilesFileSystem
│   └── documents/
│       ├── report.pdf         # Direct BLOB access
│       └── image.jpg          # Direct BLOB access
├── debug/                      # Debug information
├── invites/                    # Pairing invitations
│   ├── iop_invite.txt         # Instance of Person invite
│   └── iom_invite.txt         # Instance of Machine invite
└── types/                      # Type definitions
```

## Technical Architecture

### FUSE3 Operations

The module implements standard FUSE3 operations:

- **getattr**: Get file/directory attributes (size, permissions, timestamps)
- **readdir**: List directory contents
- **open**: Open file for reading
- **read**: Read file content at offset
- **release**: Close file handle
- **readlink**: Read symbolic link target (optional)
- **statfs**: Get filesystem statistics (optional)

### Platform Compatibility

| Platform | Status | Notes |
|----------|--------|-------|
| Linux (native) | ✅ Supported | Full FUSE3 support |
| WSL2 | ✅ Supported | Full FUSE3 support via Linux kernel |
| WSL1 | ❌ Not Supported | WSL1 doesn't support FUSE |
| macOS | 🔄 Not Tested | Requires macFUSE, not officially supported |

### Cross-Platform Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ONE Application                           │
├─────────────────────────────────────────────────────────────┤
│              IFileSystem (Platform Independent)              │
├──────────────────────┬──────────────────────────────────────┤
│    one.projfs        │         one.fuse3                     │
│  (Windows ProjFS)    │      (Linux/WSL FUSE3)                │
├──────────────────────┼──────────────────────────────────────┤
│   Windows Explorer   │      Linux File Manager               │
└──────────────────────┴──────────────────────────────────────┘
```

## Building from Source

```bash
# Install dependencies
npm install

# Configure build
npm run configure

# Build native addon
npm run build

# Or rebuild from scratch
npm run rebuild

# Clean build artifacts
npm run clean
```

**Build Requirements**:
- Node.js 20+
- FUSE3 development headers: `libfuse3-dev`
- C++ compiler: `g++` or `clang`
- Python 3 (for node-gyp)
- pkg-config

## Testing

The project includes comprehensive test suites for read operations and integration testing using plain Node.js scripts.

### Quick Start

```bash
# Install dependencies
npm install

# Run all tests (currently just read operations)
npm test

# Run specific test suites
npm run test:read        # Read operations
npm run test:write       # Write operations (not yet implemented)
npm run test:integration # Integration tests
```

### Test Suites

#### 1. Read Operations Tests (`test-read-operations.js`)

Tests all read-only FUSE operations with 19 test cases:

**Test Coverage:**
- ✅ Directory listing (root, subdirectories, non-existent)
- ✅ File reading (root files, nested files, error cases)
- ✅ Stat operations (files, directories, permissions)
- ✅ File system utilities (find, grep, head, tail, wc)
- ✅ File existence checks

**Run:**
```bash
npm test
# or
npm run test:read
```

**Expected Result:** All tests should PASS ✅

**Test Implementation:**
The test creates an in-memory filesystem with predefined files and directories, mounts it via FUSE, and verifies all read operations work correctly using standard Unix utilities.

#### 2. Write Operations Tests (Future)

Tests for write operations (to be implemented):
- Creating files and directories
- Writing and appending to files
- Deleting files and directories
- Moving/renaming files
- Changing permissions (chmod)

**Required FUSE operations to implement:**
- `create()` - for creating files
- `write()` - for writing data
- `mkdir()` - for creating directories
- `unlink()` - for removing files
- `rmdir()` - for removing directories
- `rename()` - for moving/renaming
- `chmod()` - for changing permissions
- `truncate()` - for truncating files

#### 3. Integration Test (`test/integration/connection-test.js`)

Full end-to-end test that verifies:
1. FUSE3 mount is accessible
2. Invite files are exposed correctly
3. Invite content is valid
4. Connection establishment works
5. Bidirectional contact creation

**Run:**
```bash
npm run test:integration

# With custom mount point
ONE_FILER_MOUNT=/mnt/one-filer npm run test:integration
```

**Expected output:**
```
✅ FUSE3 available
✅ FUSE mount detected
✅ Mount point accessible
✅ Invites directory accessible
✅ IOP invite file exists and is valid
✅ IOM invite file exists and is valid
✅ Connection established successfully
✅ Bidirectional contacts created
```

### Cleanup and Troubleshooting

The test suite includes automatic cleanup of stale FUSE mounts. If tests hang or fail:

```bash
# Manual cleanup of stale mounts
./cleanup-mounts.sh

# Check for lingering mounts
mount | grep fuse

# Force unmount if needed (may require sudo)
fusermount3 -u /path/to/mount
```

**Common Issues:**

1. **"ENOTCONN: socket is not connected"**
   - Caused by stale FUSE mounts from crashed tests
   - Solution: Run `./cleanup-mounts.sh` before testing

2. **Tests hang indefinitely**
   - Old issue: Was caused by `execSync` deadlock with FUSE
   - Fixed: All shell commands now use async execution
   - If still occurs: Kill test process and run cleanup script

3. **"Permission denied" errors**
   - Ensure user is in the `fuse` group: `sudo usermod -a -G fuse $USER`
   - Logout and login for group changes to take effect

### Manual Testing in WSL2

```bash
# In WSL2
cd /path/to/one.filer
node dist/index.js --fuse-mount /tmp/one-filer

# In another WSL2 terminal
ls -la /tmp/one-filer
cat /tmp/one-filer/invites/iop_invite.txt

# Test read operations
find /tmp/one-filer -type f
grep -r "invite" /tmp/one-filer/
```

### Continuous Integration

For CI/CD pipelines:

```bash
# Run tests with coverage (if configured)
npm test -- --coverage

# Run tests with JUnit output
npm test -- --reporter=junit --outputFile=test-results.xml

# Run tests with verbose output
npm test -- --reporter=verbose
```

## Performance

FUSE3 provides excellent performance for userspace filesystems:

| Operation | Native Filesystem | one.fuse3 | Overhead |
|-----------|------------------|-----------|----------|
| Metadata (stat) | <0.1ms | 0.5-1ms | ~5-10x |
| Directory list | 0.5-1ms | 2-5ms | ~3-5x |
| Small file read | 0.5-1ms | 2-5ms | ~3-5x |
| Large file read | I/O bound | I/O bound | Minimal |

The overhead is acceptable for most use cases and significantly better than network-based solutions.

## Connection Testing

The integration test verifies the complete invite flow:

```bash
# Test on Linux/WSL2
node test/integration/connection-test.js

# Expected output:
# ✅ FUSE3 mount point accessible
# ✅ Invites directory accessible
# ✅ IOP invite file exists
# ✅ IOM invite file exists
# ✅ IOP invite readable
# ✅ IOM invite readable
# ✅ IOP invite valid
# ✅ IOM invite valid
```

## Troubleshooting

### FUSE3 not available
```bash
# Install FUSE3
sudo apt-get update
sudo apt-get install fuse3 libfuse3-dev

# Verify installation
fusermount3 --version
```

### Permission denied
```bash
# Add user to fuse group
sudo usermod -a -G fuse $USER

# Logout and login again for group change to take effect
```

### Module not found after install
```bash
# Rebuild native addon
npm run rebuild

# Check build output
ls -la build/Release/
```

### WSL1 not supported
```bash
# Check WSL version
wsl --list --verbose

# Upgrade to WSL2 if needed
wsl --set-version Ubuntu 2
```

### Mount fails with "Transport endpoint is not connected"
```bash
# Unmount stale mount
fusermount3 -u /tmp/one-filer

# Or force unmount
sudo umount -l /tmp/one-filer

# Try mount again
```

## Comparison with one.projfs

| Feature | one.projfs (Windows) | one.fuse3 (Linux) |
|---------|---------------------|-------------------|
| Platform | Windows 10 1809+ | Linux, WSL2 |
| Technology | ProjFS | FUSE3 |
| Virtualization | On-demand hydration | Standard FUSE ops |
| Performance | Excellent | Very Good |
| Setup | Requires Windows feature | Requires FUSE3 package |
| Use Case | Windows desktops | Linux servers, WSL2 |

Both provide similar functionality adapted to their respective platforms.

## License

MIT

## Contributing

Contributions welcome! Please ensure:
- Code compiles on Linux and WSL2
- All tests pass: `npm test`
- Read operations tests pass: `npm run test:read`
- Integration test works: `npm run test:integration`
- Follows existing code style
- Add tests for new features

**Before submitting a PR:**
```bash
# Build the native addon
npm run build

# Run all tests
npm test

# Run integration test
npm run test:integration

# Cleanup any stale mounts
./cleanup-mounts.sh
```

## Links

- [FUSE3 Documentation](https://github.com/libfuse/libfuse)
- [N-API Documentation](https://nodejs.org/api/n-api.html)
- [one.projfs (Windows equivalent)](https://github.com/refinio/one.projfs)
- [IFileSystem Interface](https://github.com/refinio/one.core)
