# File Provider Extension Sandbox Restrictions

## Overview

macOS File Provider extensions run in a **strict App Sandbox** environment. This document describes the restrictions and workarounds for common issues.

## Critical Path Restrictions

### ❌ Blocked Paths

The extension **CANNOT** write to:
- `/tmp` - Blocked by sandbox (EPERM: operation not permitted)
- `/var/tmp` - Also blocked
- User home directory root (`~`) - Limited access
- System directories (`/usr`, `/Library`, etc.)

### ✅ Allowed Paths

The extension **CAN** write to:
- **App Group Container**: `~/Library/Group Containers/group.com.one.filer/`
  - Configured in entitlements
  - Shared between extension and host app
  - **RECOMMENDED for instance storage**

- **Extension's own container**: `~/Library/Containers/com.one.filer.extension/`
  - Private to extension only
  - Not accessible by host app

- **Temporary directory**: `FileManager.default.temporaryDirectory`
  - `/var/folders/.../T/` on macOS
  - Automatically cleaned by system
  - Use for short-lived data only

## Instance Path Configuration

### ❌ Wrong (Will Fail)

```bash
# This will fail with EPERM errors
onefiler register --name "ONE-Test" --path "/tmp/one-test-instance"
```

Error:
```
EPERM: operation not permitted, open '/tmp/one-test-instance/.../private/keychain_salt'
```

### ✅ Correct (Use App Group Container)

```bash
# This works - extension has write access
APP_GROUP="$HOME/Library/Group Containers/group.com.one.filer"
mkdir -p "$APP_GROUP/instances/ONE-Test"
onefiler register --name "ONE-Test" --path "$APP_GROUP/instances/ONE-Test"
```

## Scripts Already Fixed

The following scripts now default to App Group container paths:

1. **`scripts/rebuild-and-install.sh`**
   - Defaults to: `~/Library/Group Containers/group.com.one.filer/instances/{DOMAIN_NAME}`
   - Creates directory automatically
   - Override: `./scripts/rebuild-and-install.sh DOMAIN_NAME /custom/path`

2. **`scripts/test-with-logs.sh`**
   - Same default as above
   - Override: `sudo -E ./scripts/test-with-logs.sh DOMAIN_NAME /custom/path`

3. **`test/integration/connection-test.js`**
   - Uses `SERVER_STORAGE_DIR = APP_GROUP_CONTAINER/instances/server-provider-instance`
   - Configured at lines 40-42

## How ONE.core Storage Works

When ONE.core initializes (via `initInstance({directory: path})`), it creates:

```
{instance-path}/
├── {instance-id-hash}/
│   ├── objects/          # Object store
│   ├── indexes/          # Index data
│   ├── recipes/          # Recipe definitions
│   └── private/          # 🔴 THIS FAILS if path not writable!
│       ├── keychain_salt # Encryption salt
│       ├── keys/         # Crypto keys
│       └── ...
```

**The `private/` directory requires write access.** If the instance path isn't writable, initialization fails immediately with EPERM.

## Testing Path Accessibility

Use the Swift IPC test to verify a path works:

```bash
# Test with custom path
npm run test:swift-ipc

# If it passes, the path is accessible
# If it fails with EPERM, the path is blocked
```

The test creates a temporary instance and verifies:
- ✅ Node.js can initialize ONE.core
- ✅ Filesystems mount correctly
- ✅ Files can be created in `/invites`
- ✅ Directory operations work

## Debugging Sandbox Issues

### 1. Check System Logs (with NSLog bypass)

```bash
# NSLog messages bypass privacy redaction
log show --predicate 'processImagePath CONTAINS "OneFilerExtension"' --info --debug --last 5m | grep -i "stderr"
```

Look for:
- `EPERM: operation not permitted` - Path blocked by sandbox
- `Error writing file "keychain_salt"` - Instance path not writable

### 2. Verify Entitlements

Check `Resources/Extension.entitlements`:

```xml
<key>com.apple.security.app-sandbox</key>
<true/>
<key>com.apple.security.application-groups</key>
<array>
    <string>group.com.one.filer</string>
</array>
<key>com.apple.security.files.user-selected.read-write</key>
<true/>
<key>com.apple.security.network.client</key>
<true/>
```

### 3. Verify App Group Container Exists

```bash
ls -la ~/Library/Group\ Containers/ | grep one.filer
```

Should show:
```
drwx------  group.com.one.filer
```

If missing, the extension isn't signed correctly or entitlements are wrong.

## Common Errors and Solutions

### Error: "Server unreachable"

**Cause**: Node.js process failed to start or crashed immediately

**Debug**:
```bash
# Check recent extension process logs
log show --predicate 'subsystem == "com.one.provider"' --last 5m

# Look for:
# - "Node.js process started (PID: X)"
# - "Node.js stderr: ..." with error details
```

**Solution**: Fix the instance path to use App Group container

### Error: "Operation timed out" on mount access

**Cause**: Node.js initialization failed, extension can't respond to filesystem requests

**Debug**:
```bash
# Check if node process is running
ps aux | grep "node.*index.js" | grep -v grep

# If no process, check why it failed
log show --predicate 'processImagePath CONTAINS "OneFilerExtension"' --last 5m
```

**Solution**: Ensure instance path is writable by extension

### Error: Files appear but are empty

**Cause**: Filesystem initialized but can't read/write objects

**Debug**:
```bash
# Check if instance was created
ls -la ~/Library/Group\ Containers/group.com.one.filer/instances/

# Verify private/ directory exists and is writable
ls -la ~/Library/Group\ Containers/group.com.one.filer/instances/*/*/private/
```

**Solution**: Delete broken instance, re-register with correct path

## Best Practices

1. **Always use App Group container** for instance storage
2. **Let scripts handle paths** - they default correctly
3. **Test with `npm run test:swift-ipc`** before full installation
4. **Check logs immediately** if mount appears empty
5. **Use NSLog for debugging** - bypasses privacy redaction

## Migration from Old Paths

If you have instances in `/tmp` or other blocked locations:

```bash
# 1. Stop extension
killall fileproviderd

# 2. Copy instance data to App Group
OLD_PATH="/tmp/one-test-instance"
NEW_PATH="$HOME/Library/Group Containers/group.com.one.filer/instances/ONE-Test"
mkdir -p "$NEW_PATH"
cp -R "$OLD_PATH"/* "$NEW_PATH/"

# 3. Re-register with new path
/Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name ONE-Test
/Applications/OneFiler.app/Contents/MacOS/onefiler register --name ONE-Test --path "$NEW_PATH"

# 4. Verify
ls ~/Library/CloudStorage/OneFiler-ONE-Test/invites/
```

## References

- [App Sandbox Documentation](https://developer.apple.com/documentation/security/app_sandbox)
- [File Provider Extension](https://developer.apple.com/documentation/fileprovider)
- [App Groups Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_application-groups)
