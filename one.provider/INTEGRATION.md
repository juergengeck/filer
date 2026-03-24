# File Provider Integration Status

## Current Status (Updated)

**Phase 1 & 2 Complete**: Full File Provider extension with CLI infrastructure built successfully.

### What Works Now ✅
- ✅ **OneFiler CLI Tool** (`onefiler`)
  - Commands: register, unregister, list domains
  - Manages NSFileProviderDomain registration with macOS
  - Writes domain configuration to App Group container
  - Built via Swift Package Manager

- ✅ **File Provider Extension Binary** (`.appex`)
  - Built successfully via Xcode project (XcodeGen)
  - Proper NSFileProviderReplicatedExtension implementation
  - Located at: `.build/debug/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex`
  - Binary type: Mach-O 64-bit executable arm64

- ✅ **App Bundle Structure** (`.build/debug/OneFiler.app`)
  - Proper macOS .app bundle layout
  - CLI executable at `Contents/MacOS/onefiler`
  - Extension embedded at `Contents/PlugIns/OneFilerExtension.appex`
  - Build script: `./scripts/create-app-bundle.sh`
  - Automated build: `xcodebuild` + bundle script

- ✅ **FileProviderAdapter Updated** (`refinio.api`)
  - Uses OneFiler CLI instead of inline Swift scripts
  - Automatically finds CLI tool in common locations
  - Properly handles domain registration/unregistration

### What Still Needs Work ⚠️
- ⚠️ **Production Code Signing**
  - Currently using ad-hoc signing (development only)
  - File Provider services require proper Apple Developer certificate
  - User can sign in Xcode with valid certificate
  - Extension won't load without proper signing and entitlements

- ⚠️ **System Registration**
  - Extension registration requires macOS File Provider entitlements
  - Development certificates may require additional setup
  - Full testing requires proper provisioning profile

##  Architecture Constraints

Unlike FUSE3 (Linux) and ProjFS (Windows) which can be loaded as native modules, macOS File Provider has specific requirements:

### File Provider Requirements
1. **App Bundle**: Must be packaged as a macOS `.app` bundle
2. **Extension Bundle**: File Provider extension must be a `.appex` bundle inside the app
3. **Code Signing**: Both app and extension must be properly code-signed
4. **System Registration**: Extensions are registered with macOS via `NSFileProviderManager`
5. **Sandboxing**: Extensions run in sandboxed environment with App Group entitlements

### Why Direct Integration Doesn't Work

The approach attempted in `FileProviderAdapter.ts` won't work because:
- File Provider extensions cannot be loaded as libraries
- They must be installed as system extensions
- macOS launches the extension process, not Node.js
- Extensions communicate via IPC (stdin/stdout in our case)

## Current Implementation

### What Exists
- ✅ **OneFiler Swift Library** (`Sources/OneFiler/`)
  - File Provider extension implementation
  - ONEBridge for IPC to Node.js
  - FileProviderItem, FileProviderEnumerators

- ✅ **Node.js IPC Server** (`node-runtime/`)
  - JSON-RPC server for IFileSystem operations
  - Bridges Swift ↔ TypeScript

- ✅ **IFileSystem Integration** (refinio.api)
  - `IFileSystemAdapter` with platform detection
  - `createCompleteFiler` for complete filesystem structure
  - Support for FUSE3 and ProjFS

### What's Missing

- ❌ **App Bundle Structure**
  - Need proper `.app` bundle with Info.plist
  - Extension bundle (`.appex`) with ExtensionInfo.plist
  - Proper code signing and entitlements

- ❌ **Domain Registration Tool**
  - Command-line tool or XPC service to register domains
  - Bridge between refinio.api and File Provider

- ❌ **Build System**
  - Xcode project or build script to create app bundle
  - Code signing configuration
  - Distribution mechanism

## Proposed Solutions

### Option 1: Standalone App Bundle (Recommended)

Create a minimal macOS app that:
1. Registers File Provider domains programmatically
2. Accepts commands via XPC or command-line
3. Can be launched by refinio.api to register domains

**Structure**:
```
OneFiler.app/
├── Contents/
│   ├── MacOS/
│   │   └── OneFiler              # Minimal CLI tool
│   ├── PlugIns/
│   │   └── OneFilerExtension.appex/
│   │       ├── Contents/
│   │       │   ├── MacOS/
│   │       │   │   └── OneFilerExtension  # File Provider extension
│   │       │   └── Info.plist
│   │       └── ...
│   ├── Info.plist
│   └── ...
```

**Usage**:
```bash
# refinio.api calls this to register domain
/path/to/OneFiler.app/Contents/MacOS/OneFiler register --name "ONE" --path "/path/to/instance"

# Verify
/path/to/OneFiler.app/Contents/MacOS/OneFiler list
```

### Option 2: System Extension

Convert to a System Extension that:
- Runs as a daemon
- Listens for registration requests
- Manages domains independently

More complex but cleaner separation.

### Option 3: Hybrid Approach

Keep the current Swift Package Manager structure but:
1. Add build phase to create app bundle
2. Script to install extension
3. XPC service for domain management

## Next Steps

### Phase 1 ✅ COMPLETE
1. ✅ Create minimal app bundle structure → `./scripts/create-app-bundle.sh`
2. ✅ Add CLI interface to OneFiler → `Sources/OneFilerCLI/main.swift`
3. ✅ Update FileProviderAdapter → Now uses OneFiler CLI tool
4. ✅ Update Package.swift → Separate library and executable targets

### Phase 2 ✅ COMPLETE
1. ✅ Create Xcode Project → `project.yml` + `xcodegen generate`
2. ✅ Build Extension Binary → `xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost`
3. ✅ Update Bundle Script → Copies Xcode-built `.appex` into app bundle
4. ✅ Automated Build → `./scripts/create-app-bundle.sh` creates complete bundle

### Phase 3: Production Signing (NEXT - User Action Required)

Since you mentioned you can sign in Xcode, here's what's needed:

1. **Open Xcode Project**
   ```bash
   open OneFiler.xcodeproj
   ```

2. **Configure Signing in Xcode**
   - Select `OneFilerExtension` target
   - Signing & Capabilities tab
   - Enable "Automatically manage signing"
   - Select your Team/Developer Account
   - Ensure App Groups entitlement is set to: `group.com.one.filer`

3. **Configure Host App Signing**
   - Select `OneFilerHost` target
   - Same signing configuration as extension
   - Ensure bundle identifiers match: `com.one.filer` (host), `com.one.filer.extension` (extension)

4. **Build with Proper Signing**
   ```bash
   xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug build
   ./scripts/create-app-bundle.sh
   ```

5. **Verify Signature**
   ```bash
   codesign -dv --verbose=4 .build/debug/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex
   ```

### Phase 4: End-to-End Testing (After Signing)

Once properly signed, test the complete flow:

1. **Build Complete Bundle**
   ```bash
   cd one.provider
   xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost build
   ./scripts/create-app-bundle.sh
   ```

2. **Test CLI Registration**
   ```bash
   .build/debug/OneFiler.app/Contents/MacOS/onefiler register \
     --name "ONE" \
     --path "$HOME/.refinio/instance"
   ```

3. **Test with refinio.api**
   ```bash
   cd ../refinio.api
   npm run build
   # Configure filer.mountPoint in config
   npm start
   ```

4. **Verify Extension Loads**
   - Check system logs: `log show --predicate 'subsystem == "com.apple.FileProvider"' --last 5m`
   - Check Finder sidebar for "ONE" provider
   - Test file operations

### Long-term

1. Create proper Xcode project for app bundle
2. Implement XPC service for better IPC
3. Add automatic code signing
4. Create installer/distribution package
5. Integrate with refinio.api build process

## Files Created (Partial Implementation)

- `refinio.api/src/filer/FileProviderAdapter.ts` - Attempted direct integration (won't work as-is)
- `refinio.api/src/filer/IFileSystemAdapter.ts` - Updated with macOS support
- `test/integration/connection-test.js` - Currently skipped

These files contain useful code but need the app bundle infrastructure to work.

## References

- [Apple File Provider Documentation](https://developer.apple.com/documentation/fileprovider)
- [App Extension Programming Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/)
- Similar projects: one.fuse3 (Linux), one.projfs (Windows)
