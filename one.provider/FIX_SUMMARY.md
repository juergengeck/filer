# File Provider Node.js Module Resolution Fix

## Problem Summary

The File Provider extension was failing on launch with the following sequence:

1. **Extension starts** - ONEBridge spawns Node.js process
2. **Node.js fails immediately** - Error: `Cannot find package '@refinio/one.core'`
3. **IPC never initializes** - No response to initialize request
4. **Mount times out** - `ls ~/Library/CloudStorage/OneFiler-ONE-Test/` returns "Operation timed out"

## Root Cause

**ES modules in Node.js don't respect `NODE_PATH` environment variable.**

The extension had a directory named `node_modules_resolved` containing all the packages, but Node.js ES module resolution only looks in directories named `node_modules`. Setting `NODE_PATH` doesn't help with ES modules - that only works for CommonJS.

### Timeline of the Issue

1. **XcodeGen config** (project.yml:74-77) specifies:
   ```yaml
   - path: node-runtime/node_modules_resolved
     type: folder
     buildPhase: resources
     name: node_modules  # ← Should rename to node_modules
   ```

2. **Xcode build** properly renames the directory to `node_modules`

3. **SPM build** (Package.swift:26) only copies `node-runtime/lib`:
   ```swift
   resources: [
       .copy("../../node-runtime/lib")
   ]
   ```
   It doesn't include node_modules at all!

4. **Installed extension** somehow had `node_modules_resolved` instead of `node_modules`

## Solution

### Quick Fix (For Current Installation)

Run the test/fix script:

```bash
cd /Users/gecko/src/filer/one.provider
./test-fix.sh
```

This will:
- Rename `node_modules_resolved` → `node_modules`
- Verify Node.js can import modules
- Restart the File Provider extension
- Provide test commands

### Long-Term Fix (For Future Builds)

Updated `scripts/install-to-applications.sh` to automatically rename the directory during installation:

```bash
# Fix node_modules directory name for ES modules
EXT_RESOURCES="/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources"
if [ -d "$EXT_RESOURCES/node_modules_resolved" ]; then
    echo "🔧 Fixing node_modules directory for ES modules..."
    sudo mv "$EXT_RESOURCES/node_modules_resolved" "$EXT_RESOURCES/node_modules"
fi
```

Now future runs of `./scripts/install-to-applications.sh` will automatically apply the fix.

## Verification

After applying the fix, test with:

```bash
# Restart File Provider
killall fileproviderd
sleep 2

# Access mount point
ls ~/Library/CloudStorage/OneFiler-ONE-Test/

# Expected output:
# chats/
# debug/
# invites/
# objects/
# profiles/
# questionnaires/
# types/
```

Watch logs to confirm successful initialization:

```bash
log stream --predicate 'subsystem == "com.one.provider"' --level debug
```

Look for:
- ✅ `Node.js process started`
- ✅ `Sending IPC request: initialize`
- ✅ `IPC response received` (no stderr errors)
- ✅ Directory enumerations succeed

## Technical Details

### Why NODE_PATH Doesn't Work

From Node.js ES modules documentation:

> When resolving `import` specifiers, Node.js uses the `node_modules` resolution algorithm. This algorithm does not use `NODE_PATH`. Only CommonJS modules use `NODE_PATH`.

ES modules (`import`/`export` syntax) resolution:
1. Check `node_modules` in current directory
2. Check `node_modules` in parent directories (walking up the tree)
3. Check global modules location
4. **Does NOT check `NODE_PATH`**

### What We Tried That Didn't Work

1. **Setting NODE_PATH in ONEBridge.swift** - Doesn't affect ES modules
2. **Creating symlinks** - Complicated and fragile
3. **Changing import paths** - Would require rebuilding one.core/one.models

### The Right Solution

Simply ensure the directory is named `node_modules` - that's what Node.js expects, and it's what XcodeGen was already configured to do. The problem was that the installed bundle had the wrong name.

## Files Modified

1. **scripts/install-to-applications.sh** - Added automatic node_modules fix
2. **test-fix.sh** (new) - Quick fix + verification script
3. **fix-node-modules.sh** (new) - Simple rename script
4. **FIX_SUMMARY.md** (this file) - Documentation

## Related Issues

This issue would NOT occur if:
- Using pure Xcode build workflow (it renames correctly)
- Using SPM with proper Package.swift resources configuration
- Not using ES modules (CommonJS would work with NODE_PATH)

## Prevention

For future platform integrations:
1. **Always test module resolution** before assuming NODE_PATH works
2. **Verify directory names** match Node.js expectations
3. **Test with the actual bundled code**, not just local development builds
4. **Check ES vs CommonJS** - they have different resolution rules

## Status

- ✅ Root cause identified
- ✅ Quick fix created (`test-fix.sh`)
- ✅ Long-term fix implemented (updated install script)
- ⏳ Awaiting verification of fix on actual system

## Next Steps

1. Run `./test-fix.sh` to fix current installation
2. Test File Provider functionality
3. Future builds will include the fix automatically
