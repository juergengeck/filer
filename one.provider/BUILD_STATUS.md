# Build Status - macOS File Provider with Bundled Node.js

## Current Status: ✅ Build Fixed (Pending Installation Test)

### What Was Fixed

1. **Node.js Bundling** (`scripts/bundle-node.sh`)
   - Bundles Node.js binary into extension Resources
   - Copies all ICU dylibs to Resources/dylibs
   - Updates dylib references using `install_name_tool`
   - Node binary now references: `@loader_path/../dylibs/libicui18n.76.dylib`

2. **Symlink Path Fix** (`project.yml`)
   - Fixed symlink in extension: `lib/node_modules → ../node_modules_resolved`
   - Previously pointed to wrong path: `../node-runtime/node_modules_resolved`
   - Extension Resources structure:
     ```
     Resources/
     ├── bin/
     │   └── node (57MB, bundled with ICU references)
     ├── dylibs/
     │   ├── libicui18n.76.dylib
     │   ├── libicuuc.76.dylib
     │   ├── libicudata.76.dylib
     │   └── ... (10+ dylibs)
     ├── lib/
     │   ├── index.js (IPC server)
     │   └── node_modules → ../node_modules_resolved (symlink)
     └── node_modules_resolved/
         └── @refinio/
             ├── one.core
             └── one.models
     ```

3. **Xcode Pre-Build Script** (`project.yml` lines 100-124)
   - Runs `npm run build` (TypeScript)
   - Runs `bundle-node.sh` (Node.js + ICU)
   - Copies `node_modules` with resolved symlinks to `node_modules_resolved`
   - Creates symlink: `lib/node_modules → ../node_modules_resolved`

### Build Verification

The updated `scripts/rebuild-and-install.sh` now verifies:
- ✅ Node binary exists (57MB)
- ✅ ICU dylibs present (13 files)
- ✅ node_modules_resolved directory exists
- ✅ IPC server code compiled

### How to Build and Install

```bash
cd ~/src/filer/one.provider

# Option 1: Full rebuild and install (recommended)
./scripts/rebuild-and-install.sh

# Option 2: Manual steps
xcodegen generate
xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug clean build

# Then install manually (requires sudo)
sudo rm -rf /Applications/OneFiler.app
sudo cp -R ~/Library/Developer/Xcode/DerivedData/OneFiler-*/Build/Products/Debug/OneFilerHost.app /Applications/OneFiler.app
sudo chown -R root:wheel /Applications/OneFiler.app
killall fileproviderd
```

### Testing

After installation:
```bash
# Test mount point
ls ~/Library/CloudStorage/OneFiler-ONE-Test/

# Watch logs
log stream --predicate 'subsystem == "com.one.provider"' --level debug

# Check node process
ps aux | grep node
```

### Expected Behavior

When working correctly, you should see:
1. Extension starts without "node executable not found" error
2. Node.js process spawns from bundled binary
3. IPC server initializes and responds to requests
4. Mount point shows filesystem contents

### Remaining Work

- [ ] Install and test (requires sudo password)
- [ ] Verify extension loads bundled Node.js correctly
- [ ] Test IPC communication with bundled setup
- [ ] Confirm file listing works

### Technical Details

**Why Bundle Node.js?**
- macOS File Provider extensions run in sandbox
- Cannot access system Node.js in `/usr/local/bin` or `/opt/homebrew/bin`
- Must bundle Node.js binary and all dependencies in extension Resources
- ICU libraries required for Node.js internationalization support

**Why Symlink?**
- TypeScript outputs to `lib/index.js`
- Node.js requires `node_modules` in same directory or parent
- Xcode copies `lib/` and `node_modules_resolved` separately to Resources
- Symlink bridges the gap: `Resources/lib/node_modules → Resources/node_modules_resolved`

**Build Process:**
1. `npm run build` → TypeScript → `lib/index.js`
2. `bundle-node.sh` → Node.js + ICU dylibs → `Resources/bin/` + `Resources/dylibs/`
3. Copy `node_modules` → `node_modules_resolved` (resolve symlinks)
4. Create symlink: `lib/node_modules → ../node_modules_resolved`
5. Xcode copies all to extension bundle
6. Code sign and install

### Previous Issues (Resolved)

- ❌ "node executable not found" → ✅ Bundled in Resources/bin/node
- ❌ "dyld: Library not loaded: libicui18n" → ✅ ICU dylibs bundled and references updated
- ❌ "Cannot find module @refinio/one.core" → ✅ Symlink fixed to point to correct location
