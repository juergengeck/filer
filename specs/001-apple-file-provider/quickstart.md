# Quickstart: Apple File Provider Integration

**Date**: 2025-10-17
**Feature**: Apple File Provider Integration
**Branch**: 001-apple-file-provider

## Overview

This guide walks you through setting up the development environment and running the Apple File Provider implementation. By the end, you'll have a working File Provider extension showing refinio ONE files in Finder.

---

## Prerequisites

**Hardware**:
- Mac with macOS 13.0 (Ventura) or later
- Apple Silicon or Intel processor
- 8GB RAM minimum, 16GB recommended

**Software**:
- Xcode 15.0 or later
- Swift 5.9 or later
- Node.js 20.0 or later
- Git

**Accounts**:
- Apple Developer account (for signing File Provider extension)
- refinio ONE instance (for testing)

---

## Setup Steps

### 1. Clone Repository

```bash
cd /Users/gecko/src/filer
git checkout 001-apple-file-provider
```

### 2. Install Node.js Dependencies

```bash
cd one.provider/node-runtime
npm install
```

This installs:
- one.core (0.6.1-beta-2)
- one.models (14.1.0-beta-4)
- Other dependencies

### 3. Generate Xcode Project

```bash
cd /Users/gecko/src/filer/one.provider
swift package generate-xcodeproj
# Or use: xcodegen (if project.yml is configured)
open OneProvider.xcodeproj
```

### 4. Configure Signing

In Xcode:
1. Select **OneProvider** target
2. Go to **Signing & Capabilities**
3. Select your development team
4. Ensure bundle ID is unique: `com.refinio.one.provider` (or use your org ID)
5. Repeat for **OneProviderExtension** target

### 5. Enable File Provider Entitlement

In Xcode:
1. Select **OneProviderExtension** target
2. Go to **Signing & Capabilities**
3. Click **+ Capability**
4. Add **File Provider**
5. Verify `com.apple.security.files.provider` entitlement is present

### 6. Build Project

```bash
cd /Users/gecko/src/filer/one.provider
swift build
# Or in Xcode: Cmd+B
```

**Expected output**:
```
Build succeeded
```

### 7. Run Tests

```bash
swift test
# Or in Xcode: Cmd+U
```

**Expected output**:
```
Test Suite 'All tests' passed
```

---

## Running the Application

### Option 1: Via Xcode

1. Select **OneProvider** scheme
2. Click **Run** (Cmd+R)
3. The management app launches with domain setup UI

### Option 2: Via Command Line

```bash
cd /Users/gecko/src/filer/one.provider
swift run OneProvider
```

---

## Creating Your First Domain

### 1. Prepare ONE Instance

Create a test ONE database:

```bash
mkdir -p ~/Library/Application\ Support/OneProvider/test-domain
cd ~/Library/Application\ Support/OneProvider/test-domain

# Initialize ONE database (using one.core CLI or reference implementation)
# This step depends on your ONE instance setup
```

### 2. Add Domain in App

1. Launch OneProvider.app
2. Click **+ Add Domain**
3. Fill in:
   - **Display Name**: "Test Domain"
   - **Instance Path**: `~/Library/Application Support/OneProvider/test-domain`
4. Click **Add**

### 3. Verify in Finder

1. Open Finder
2. Look in sidebar under **Locations**
3. You should see **Test Domain**
4. Click it to browse files

**Expected behavior**:
- Folder hierarchy from ONE database displays
- Files are browsable
- File metadata (size, date) shows correctly

---

## Development Workflow

### Running Node.js Runtime Standalone

For debugging the IPC layer:

```bash
cd /Users/gecko/src/filer/one.provider/node-runtime
node index.js
```

Send test JSON-RPC requests via stdin:

```bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"instancePath":"/path/to/one"},"id":1}' | node index.js
```

### Debugging Swift Code

In Xcode:
1. Set breakpoints in `FileProviderExtension.swift` or `ONEBridge.swift`
2. Run with debugger (Cmd+R)
3. Trigger File Provider operation in Finder
4. Debugger stops at breakpoint

### Viewing Logs

**File Provider Extension logs**:
```bash
log stream --predicate 'subsystem == "com.refinio.one.provider"' --level debug
```

**Node.js runtime logs**:
```bash
tail -f ~/Library/Logs/OneProvider/node-runtime.log
```

### Inspecting IPC Messages

Add debug logging in `NodeIPCBridge.swift`:

```swift
func send(_ request: JSONRPCRequest) async throws -> JSONRPCResponse {
    let json = try JSONEncoder().encode(request)
    print("[IPC →] \(String(data: json, encoding: .utf8)!)")
    // ... send logic ...
}
```

---

## Common Issues

### Issue: "File Provider extension not activating"

**Symptoms**: Domain appears in Finder sidebar but clicking shows nothing.

**Solutions**:
1. Check signing: Extension must be signed with valid development certificate
2. Check entitlements: File Provider entitlement must be present
3. Restart Finder: `killall Finder`
4. Check logs: `log stream --predicate 'subsystem contains "fileprovider"'`

### Issue: "Node.js process not starting"

**Symptoms**: IPC connection fails, timeout errors in logs.

**Solutions**:
1. Verify Node.js installed: `which node` should return `/usr/local/bin/node` or similar
2. Check permissions: Ensure extension can execute Node.js binary
3. Check path in `ONEBridge.swift`: Hardcoded Node.js path may be wrong
4. Test standalone: `cd node-runtime && node index.js` should run without errors

### Issue: "Files not appearing in Finder"

**Symptoms**: Domain shows but folder is empty, even though ONE database has content.

**Solutions**:
1. Check ONE initialization: Verify `initialize()` IPC call succeeded
2. Check enumeration: Test `getChildren()` IPC call manually
3. Check root hash: Ensure `rootHash` from initialize matches expected value
4. Enable debug logging: Add print statements in `FileProviderEnumerators.swift`

### Issue: "Cannot write files"

**Symptoms**: Read operations work, but create/update/delete fail.

**Solutions**:
1. Check capabilities: Verify `NSFileProviderItemCapabilities` includes write flags
2. Check ONE permissions: Ensure ONE instance allows write operations
3. Check IPC: Test `createObject()` call standalone to isolate issue
4. Check error messages: IPC errors should propagate with details

---

## Testing Checklist

Before proceeding to implementation, verify:

- [ ] Swift package builds successfully
- [ ] Node.js runtime starts and accepts IPC connections
- [ ] Can send JSON-RPC request and receive response
- [ ] Can add File Provider domain via management app
- [ ] Domain appears in Finder sidebar
- [ ] Can enumerate root folder (even if empty)
- [ ] Logs show IPC messages flowing correctly

---

## Next Steps

Once the quickstart works:

1. **Phase 1**: Implement core File Provider operations (enumerate, read)
2. **Phase 2**: Add write operations (create, update, delete)
3. **Phase 3**: Add sync anchor and change tracking
4. **Phase 4**: Add offline queue and error handling
5. **Phase 5**: Performance optimization and testing

See [tasks.md](./tasks.md) (generated by `/speckit.tasks` command) for detailed implementation tasks.

---

## Architecture Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│                        Finder / Files App                    │
└────────────────┬────────────────────────────────────────────┘
                 │ NSFileProvider API
┌────────────────▼────────────────────────────────────────────┐
│           FileProviderExtension (Swift)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ FileProviderItem, FileProviderEnumerators            │   │
│  └───────────────────┬──────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼──────────────────────────────────┐   │
│  │          ONEBridge (Actor)                           │   │
│  │  - Async/await interface                             │   │
│  │  - Request queuing                                   │   │
│  │  - Response handling                                 │   │
│  └───────────────────┬──────────────────────────────────┘   │
└────────────────────┬─┴──────────────────────────────────────┘
                     │ JSON-RPC over stdin/stdout
┌────────────────────▼────────────────────────────────────────┐
│           Node.js IPC Server (index.js)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ JSON-RPC parser, method dispatcher                   │   │
│  └───────────────────┬──────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼──────────────────────────────────┐   │
│  │          one.models (CombinedFileSystem)             │   │
│  │  - ChatFileSystem                                    │   │
│  │  - ObjectsFileSystem                                 │   │
│  │  - TypesFileSystem                                   │   │
│  └───────────────────┬──────────────────────────────────┘   │
│                      │                                       │
│  ┌───────────────────▼──────────────────────────────────┐   │
│  │          one.core (Content-Addressed Storage)        │   │
│  │  - SHA-256 hashing                                   │   │
│  │  - Immutable objects                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Useful Commands

**Build**:
```bash
swift build --configuration debug
swift build --configuration release
```

**Test**:
```bash
swift test
swift test --filter FileProviderTests
```

**Clean**:
```bash
swift package clean
rm -rf .build
```

**Format**:
```bash
swift format --in-place --recursive Sources/ Tests/
```

**Lint**:
```bash
swiftlint lint
swiftlint lint --fix
```

**Generate docs**:
```bash
swift package generate-documentation
```

---

## Reference Documentation

- [Apple File Provider Programming Guide](https://developer.apple.com/documentation/fileprovider)
- [NSFileProviderReplicatedExtension](https://developer.apple.com/documentation/fileprovider/nsfileproviderreplicatedextension)
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification)
- [one.core Documentation](../../../one.core/README.md)
- [one.models Documentation](../../../one.models/README.md)
- [Data Model](./data-model.md)
- [IPC Contract](./contracts/node-ipc-jsonrpc.md)
- [Research Decisions](./research.md)

---

## Support

**Issues**: Report bugs at https://github.com/refinio/one/issues

**Questions**: Ask in Slack #one-provider channel or email dev@refinio.com

**Contributing**: See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines
