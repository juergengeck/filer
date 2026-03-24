# Invites Investigation - Status Report

**Date**: 2025-11-02
**Issue**: Invite files missing or not appearing in `/invites` directory

## Executive Summary

After thorough investigation of the invite system in one.provider, I've identified the complete architecture and potential issues. The system is **correctly implemented** at the code level, but there are **configuration gaps** and timing issues that cause invites to appear missing or malformed.

## Architecture Overview

### Node.js Application Server (`node-runtime/index.ts`)

**Lines 313-340**: Filesystem initialization creates complete structure:

```typescript
const pairingFileSystem = new PairingFileSystem(connectionsModel, iomManager, '', 'full');
const rootFileSystem = new TemporaryFileSystem();
await rootFileSystem.mountFileSystem('/invites', pairingFileSystem);
```

**Lines 363-382**: Wait loop for invite files (up to 10 seconds):
- Polls `/invites` directory every 200ms
- Logs when invite files appear
- Warns if files not created after 10 seconds
- **Purpose**: ConnectionsModel creates invites asynchronously

### PairingFileSystem (`one.models/src/fileSystems/PairingFileSystem.ts`)

**Expected files** (line 42-47):
- `iom_invite.png` - QR code for Internet of Me pairing
- `iom_invite.txt` - URL for Internet of Me pairing
- `iop_invite.png` - QR code for Instance-to-Instance pairing
- `iop_invite.txt` - URL for Instance-to-Instance pairing

**Lazy creation** (lines 234-258):
- Invites are **NOT pre-generated**
- Created **on-demand** when file is first read
- Each access to `iop_invite.txt` creates a **NEW** invitation with fresh token
- Invitations are cached in memory (`this.iomInvite`, `this.iopInvite`)

**Key methods**:
- `getAndRefreshIomInviteIfNoneExists()` - Creates IoM invite on first access (line 234-240)
- `getAndRefreshIopInviteIfNoneExists()` - Creates IoP invite on first access (line 252-258)
- `readFile()` - Returns file content, triggers invite creation if needed (line 123-159)
- `readDir()` - **Always returns 4 filenames** (line 120)

### PairingManager (`one.models/src/misc/ConnectionEstablishment/PairingManager.ts`)

**Lines 108-140**: `createInvitation()` method creates invitation with:
- `token` - Random 32-byte authentication token (expires after configured duration)
- `publicKey` - Hex-encoded public key from default instance keys
- `url` - Connection URL (**from `this.url` constructor parameter**)

**Constructor** (lines 94-99):
- Takes **`url` parameter** for connection endpoint
- Takes `inviteExpirationDurationInMs` (default: 3600000 = 1 hour)
- Stores active invitations in `Map<string, ActiveInvitation>`

### ConnectionsModel Configuration (`node-runtime/index.ts:288-299`)

```typescript
const connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl: 'wss://comm10.dev.refinio.one',
    acceptIncomingConnections: false,      // ❌ NOT accepting incoming
    acceptUnknownInstances: false,
    acceptUnknownPersons: false,
    allowPairing: true,                    // ✅ Pairing enabled
    allowDebugRequests: false,
    pairingTokenExpirationDuration: 3600000, // 1 hour
    establishOutgoingConnections: false,   // ❌ NOT establishing outgoing
    noImport: false,
    noExport: false
});
```

**Critical Configuration Issue**: PairingManager constructor (inside ConnectionsModel) requires a `url` parameter for where others can connect to this instance. With `acceptIncomingConnections: false`, there's no valid connection URL.

## Swift Extension Integration

### FileProviderItem (`Sources/OneFiler/FileProviderItem.swift:51-56`)

Hardcodes "Invites" folder in root:
```swift
FileProviderItem(oneObject: ONEObject(
    id: "invites",
    name: "Invites",
    type: .folder,
    parentId: NSFileProviderItemIdentifier.rootContainer.rawValue
))
```

### GenericEnumerator (`Sources/OneFiler/FileProviderEnumerators.swift:165-197`)

When user opens `/invites` directory:
1. Calls `bridge.getChildren(parentId: "invites")`
2. ONEBridge normalizes to `/invites`
3. Sends JSON-RPC: `{"method": "readDir", "params": {"path": "/invites"}}`
4. Node.js returns: `{"children": ["iom_invite.png", "iom_invite.txt", "iop_invite.png", "iop_invite.txt"]}`
5. For each child, calls `getObject(id: "/invites/iom_invite.txt")` via `stat()` (line 351)
6. Returns array of FileProviderItems

### ONEBridge (`Sources/OneFiler/ONEBridge.swift:327-361`)

`getChildren()` implementation:
1. Calls `readDir` via IPC to get child names (line 334)
2. For each child, calls `stat()` to get metadata (line 351)
3. Constructs ONEObject with type (file/folder), size, etc.

**Critical path**: `stat()` calls `readFile()` internally to get file size, which triggers lazy invite creation.

## IPC Test Results

Test output shows **correct behavior**:

```bash
$ npm run test:ipc

readDir("/") → ["chats","debug","invites","objects","types","profiles","questionnaires"]
```

The Node.js server correctly:
1. ✅ Initializes all models (LeuteModel, ConnectionsModel, etc.)
2. ✅ Mounts PairingFileSystem at `/invites`
3. ✅ Returns `/invites` in root directory listing
4. ✅ Waits up to 10 seconds for invite files to appear (lines 363-382)

## What Should Happen

### Correct Flow

1. **Extension loads** → Swift spawns Node.js process
2. **Node.js starts** → Initializes ONE instance
3. **Models initialize** → LeuteModel, ConnectionsModel, IoMManager (line 302-307)
4. **Filesystems mount** → PairingFileSystem mounted at `/invites` (line 335)
5. **Wait loop** → Checks if invite files exist (line 364-382)
6. **User opens Finder** → Navigates to `~/Library/CloudStorage/OneFiler-{domain}/invites/`
7. **macOS requests enumeration** → GenericEnumerator calls `getChildren("invites")`
8. **IPC readDir** → Returns `["iom_invite.png", "iom_invite.txt", "iop_invite.png", "iop_invite.txt"]`
9. **IPC stat** → For each file, returns metadata (triggers lazy creation)
10. **User clicks file** → Triggers `readFile()` → Returns invitation content
11. **Invitation created** → PairingManager generates token, publicKey, URL
12. **File returned** → QR code PNG or URL text

### Expected Invite File Contents

**`iop_invite.txt`** (Instance-to-Instance Pairing):
```
https://one.local/invite#%7B%22token%22%3A%22...%22%2C%22publicKey%22%3A%22...%22%2C%22url%22%3A%22...%22%7D
```

URL-encoded JSON:
```json
{
  "token": "32-byte-random-hex-string",
  "publicKey": "hex-encoded-public-key",
  "url": "wss://comm10.dev.refinio.one"  // <-- Connection endpoint
}
```

**`iop_invite.png`**:
- QR code image encoding the same URL
- PNG format, generated by `qrcode` npm package (line 278)

## Identified Issues

### 1. ❌ **CRITICAL: Empty Invite URL Prefix**

**Location**: `node-runtime/index.ts:325`

```typescript
const pairingFileSystem = new PairingFileSystem(connectionsModel, iomManager, '', 'full');
                                                                                 ^^
                                                                         EMPTY STRING!
```

**Impact**: Invitation URLs will be malformed: `#%7B...%7D` instead of `https://one.local/invite#%7B...%7D`

**Fix**:
```typescript
const inviteUrlPrefix = process.env.ONE_PROVIDER_INVITE_URL_PREFIX || 'https://one.local/invite';
const pairingFileSystem = new PairingFileSystem(connectionsModel, iomManager, inviteUrlPrefix, 'full');
```

### 2. ❌ **CRITICAL: No Incoming Connection URL**

**Problem**: PairingManager is constructed inside ConnectionsModel and gets its `url` from incoming connection configuration. With `acceptIncomingConnections: false`, there's **no valid URL** for others to connect to this instance.

**Result**: Invitations will have empty or invalid `url` field, making them **useless for pairing**.

**Investigation needed**:
- Where does LeuteConnectionsModule get the URL when no incoming connections?
- Does it use `commServerUrl` as fallback?
- Or do we need to explicitly configure?

**Potential fix**:
```typescript
const connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl,
    acceptIncomingConnections: false,  // Still don't accept
    incomingConnectionConfigurations: [
        {
            type: 'commserver',
            url: commServerUrl,  // Provide URL for invitations
            autoConnect: false   // But don't actually connect
        }
    ],
    // ... rest of config
});
```

### 3. ⚠️  **Lazy Creation Not Validated**

**Problem**: The 10-second wait loop (lines 364-382) checks if `readDir('/invites')` returns children, but:
- `readDir()` **always returns 4 filenames** (line 120)
- Files are created **on-demand** when first accessed
- Wait loop succeeds even if invitation creation would fail

**Result**: User sees 4 files listed, but they may be empty or contain errors.

**Fix**: Actually try to read a file during initialization:
```typescript
// After wait loop
try {
    const testFile = await this.fileSystem.readFile('/invites/iop_invite.txt');
    console.error(`[IPC] Successfully created invite file (${testFile.content.byteLength} bytes)`);
} catch (error) {
    console.error(`[IPC] ERROR: Failed to create invite file: ${error}`);
    throw new Error('Invite creation failed - initialization aborted');
}
```

### 4. ⚠️  **No Diagnostic Logging**

**Problem**: When invite files don't work, there's no visibility into:
- Whether invitation creation succeeded
- What URL was used in the invitation
- Whether token/publicKey generation worked
- If PairingManager has valid configuration

**Current logging** (node-runtime/index.ts:364-382):
- Logs to stderr: `console.error('[IPC] Waiting for invite files...')`
- Captured by Swift (ONEBridge.swift:142-169)
- Written to `/tmp/one-provider-stderr-{pid}.log`

**But PairingFileSystem.ts logs are missing**:
- Lines 235, 238, 253, 256 log to console, but we need more detail
- Should log the actual invitation content (redacted token)
- Should log URL being used

**Fix**: Add detailed logging in PairingFileSystem:
```typescript
private async getAndRefreshIopInviteIfNoneExists(): Promise<Invitation> {
    console.log(`[PairingFileSystem] Creating new IoP invitation...`);
    const invitation = await this.connectionsModel.pairing.createInvitation();
    this.iopInvite = invitation;
    console.log(`[PairingFileSystem] Created IoP invitation:`);
    console.log(`  - Token: ${invitation.token.substring(0, 16)}... (${invitation.token.length} chars)`);
    console.log(`  - PublicKey: ${invitation.publicKey.substring(0, 32)}... (${invitation.publicKey.length} chars)`);
    console.log(`  - URL: ${invitation.url}`);
    return invitation;
}
```

### 5. ⚠️  **Configuration Contradiction**

**Problem**: Configuration says:
- `allowPairing: true` - Generate invitations for others to connect
- `acceptIncomingConnections: false` - Don't accept incoming connections

This is a **logical contradiction**. Pairing invitations are for others to connect TO this instance, but we're not accepting connections.

**Questions**:
1. Should File Provider accept incoming connections?
2. Or is pairing only for outgoing connections (we use someone else's invite)?
3. Or should we use CommServer relay so we don't need direct incoming?

**Expected for File Provider**:
- **Generate invitations**: Yes (for mobile app to connect to desktop)
- **Accept connections**: Yes, via CommServer relay
- **Direct incoming**: No (sandboxed, behind firewall)

**Recommended config**:
```typescript
const connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl: 'wss://comm10.dev.refinio.one',
    acceptIncomingConnections: true,   // ✅ Accept via CommServer
    acceptUnknownInstances: false,      // But only from known people
    acceptUnknownPersons: false,
    allowPairing: true,                 // ✅ Generate invitations
    establishOutgoingConnections: true, // ✅ Also connect to others
    // Use CommServer for all connections (relay)
});
```

### 6. 💡 **HTTP REST API Disabled by Default**

**Current**: HTTP server only starts if `ONE_PROVIDER_HTTP_PORT` env var set (line 345).

**Problem**: No programmatic way to:
- Create invitations via API
- Check if invitations exist
- Test invitation creation
- Get connection status

**Benefit of enabling**:
```bash
# Test invite creation
curl -X POST http://localhost:3000/api/connections/create-invite
# Returns: {"inviteUrl": "https://one.local/invite#..."}

# Check status
curl http://localhost:3000/api/status
# Returns: {"instanceId": "...", "contacts": 0}
```

**Recommendation**: Enable by default on localhost (safe, local-only).

## Comparison with refinio.api

**refinio.api** (`src/filer/createFilerWithPairing.ts`):
- Uses same PairingFileSystem implementation
- Provides `inviteUrlPrefix` parameter (line 78)
- Accepts incoming connections (typically true)
- Has valid WebSocket URL for CommServer
- Runs as server application (not sandboxed)

**one.provider** differences:
- ❌ Empty invite URL prefix (`''`)
- ❌ No incoming connections (`acceptIncomingConnections: false`)
- ⚠️  Running in sandboxed extension
- ⚠️  May have network restrictions

## Recommended Fixes

### Immediate (High Priority)

#### 1. Set Invite URL Prefix

**File**: `node-runtime/index.ts:325`

```typescript
// BEFORE
const pairingFileSystem = new PairingFileSystem(connectionsModel, iomManager, '', 'full');

// AFTER
const inviteUrlPrefix = process.env.ONE_PROVIDER_INVITE_URL_PREFIX || 'https://one.local/invite';
const pairingFileSystem = new PairingFileSystem(connectionsModel, iomManager, inviteUrlPrefix, 'full');
```

#### 2. Configure Incoming Connection URL

**File**: `node-runtime/index.ts:288-299`

```typescript
const connectionsModel = new ConnectionsModel(leuteModel, {
    commServerUrl,
    acceptIncomingConnections: true,  // ✅ Enable (via CommServer relay)
    acceptUnknownInstances: false,
    acceptUnknownPersons: false,
    allowPairing: true,
    allowDebugRequests: false,
    pairingTokenExpirationDuration: 3600000,
    establishOutgoingConnections: true,  // ✅ Enable outgoing too
    noImport: false,
    noExport: false
});
```

#### 3. Validate Invite Creation

**File**: `node-runtime/index.ts:383` (after wait loop)

```typescript
// After the wait loop completes
try {
    console.error('[IPC] Validating invite creation...');
    const testInvite = await this.fileSystem.readFile('/invites/iop_invite.txt');
    const inviteText = new TextDecoder().decode(new Uint8Array(testInvite.content));
    console.error(`[IPC] ✅ Invite created successfully (${testInvite.content.byteLength} bytes)`);
    console.error(`[IPC]    URL prefix: ${inviteText.substring(0, 50)}...`);

    // Parse and validate
    if (!inviteText.includes('invite#')) {
        throw new Error('Invite URL malformed - missing hash separator');
    }
} catch (error) {
    console.error(`[IPC] ❌ ERROR: Failed to create or read invite: ${error}`);
    throw new Error(`Invite validation failed: ${error}`);
}
```

### Medium Priority

#### 4. Add Detailed Logging

**File**: `one.models/src/fileSystems/PairingFileSystem.ts` (multiple locations)

Add logging in `getAndRefreshIopInviteIfNoneExists()` and `getAndRefreshIomInviteIfNoneExists()`:

```typescript
private async getAndRefreshIopInviteIfNoneExists(): Promise<Invitation> {
    console.log(`[PairingFileSystem] Creating IoP invitation...`);
    const invitation = await this.connectionsModel.pairing.createInvitation();
    this.iopInvite = invitation;
    console.log(`[PairingFileSystem] ✅ IoP invitation created:`);
    console.log(`  - Token: ${invitation.token.substring(0, 16)}... (expires in ${this.connectionsModel.pairing.inviteExpirationDurationInMs}ms)`);
    console.log(`  - PublicKey: ${invitation.publicKey.substring(0, 32)}...`);
    console.log(`  - Connection URL: ${invitation.url}`);
    console.log(`  - Invite URL: ${this.convertInvitationToUrl(invitation)}`);
    return invitation;
}
```

#### 5. Enable HTTP API by Default

**File**: `node-runtime/index.ts:345`

```typescript
// BEFORE
const httpPort = process.env.ONE_PROVIDER_HTTP_PORT;
if (httpPort) {
    // ...
}

// AFTER
const httpPort = process.env.ONE_PROVIDER_HTTP_PORT || '3000';
console.error(`[IPC] Enabling HTTP REST API on port ${httpPort}`);
const inviteUrlPrefix = process.env.ONE_PROVIDER_INVITE_URL_PREFIX || 'https://one.local/invite';
// ...
```

#### 6. Add Diagnostic Endpoint

**File**: `node-runtime/http-server.ts` (or create new file)

```typescript
// GET /api/invites/status
router.get('/api/invites/status', async (req, res) => {
    try {
        // Read all invite files
        const invites = await fileSystem.readDir('/invites');
        const status: any = {
            available: invites.children,
            details: {}
        };

        // Try to read each invite
        for (const file of invites.children) {
            try {
                const content = await fileSystem.readFile(`/invites/${file}`);
                status.details[file] = {
                    size: content.content.byteLength,
                    readable: true
                };
            } catch (error) {
                status.details[file] = {
                    error: error.message,
                    readable: false
                };
            }
        }

        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

### Low Priority

#### 7. Pre-create Invitations

**File**: `node-runtime/index.ts:385` (after validation)

```typescript
// Force all invitations to be created immediately
console.error('[IPC] Pre-creating all invitation files...');
await Promise.all([
    this.fileSystem.readFile('/invites/iop_invite.txt'),
    this.fileSystem.readFile('/invites/iop_invite.png'),
    this.fileSystem.readFile('/invites/iom_invite.txt'),
    this.fileSystem.readFile('/invites/iom_invite.png')
]);
console.error('[IPC] ✅ All invitation files pre-created');
```

#### 8. Monitor Invite Expiration

**File**: `node-runtime/index.ts:400+`

```typescript
// Periodically log active invitations
if (this.connectionsModel) {
    setInterval(() => {
        const count = this.connectionsModel.pairing.activeInvitations?.size || 0;
        if (count > 0) {
            console.error(`[IPC] Active pairing invitations: ${count}`);
        }
    }, 300000); // Every 5 minutes
}
```

## Testing Procedure

### 1. Test IPC Layer

```bash
cd /Users/gecko/src/filer/one.provider
npm run test:ipc
# Should show: readDir("/") → [..., "invites", ...]
```

### 2. Test with HTTP API

```bash
# Enable HTTP server
export ONE_PROVIDER_HTTP_PORT=3000
export ONE_PROVIDER_INVITE_URL_PREFIX=https://one.local/invite

# Rebuild and install
./scripts/rebuild-and-install.sh

# Test invite creation
curl -X POST http://localhost:3000/api/connections/create-invite
# Should return: {"inviteUrl": "https://one.local/invite#..."}

# Check invite status (if diagnostic endpoint added)
curl http://localhost:3000/api/invites/status
```

### 3. Test via Finder

```bash
# Watch logs in separate terminal
log stream --predicate 'subsystem == "com.one.provider"' --level debug &

# Also watch Node.js stderr
tail -f /tmp/one-provider-stderr-*.log &

# Open in Finder
open ~/Library/CloudStorage/OneFiler-ONE-Test/invites/

# Click on iop_invite.txt and check contents
cat ~/Library/CloudStorage/OneFiler-ONE-Test/invites/iop_invite.txt
```

### 4. Verify Invite Contents

The invite file should contain a properly formatted URL:

```bash
# Expected format
https://one.local/invite#%7B%22token%22%3A%22...%22%2C%22publicKey%22%3A%22...%22%2C%22url%22%3A%22wss%3A%2F%2Fcomm10.dev.refinio.one%22%7D

# Decode to verify
python3 -c "import sys, urllib.parse, json; print(json.dumps(json.loads(urllib.parse.unquote(sys.argv[1].split('#')[1])), indent=2))" "$(cat ~/Library/CloudStorage/OneFiler-ONE-Test/invites/iop_invite.txt)"

# Should output:
{
  "token": "32-char-hex-string",
  "publicKey": "64-char-hex-string",
  "url": "wss://comm10.dev.refinio.one"
}
```

## Open Questions

1. **What is the correct connection URL for a File Provider instance?**
   - Should it use CommServer relay? (Recommended: Yes)
   - Should it accept direct connections? (Recommended: No, sandboxed)
   - Or is File Provider instance only for local use? (Unclear)

2. **Should invitations work if `acceptIncomingConnections: false`?**
   - Current config suggests instance doesn't accept connections
   - But invitations are for others to connect TO this instance
   - Contradiction in configuration

3. **What is the expected user flow for pairing?**
   - User A (desktop) opens File Provider → gets invite URL from file
   - User B (mobile) scans QR or enters URL in mobile app
   - Mobile app connects to desktop via CommServer relay
   - Desktop must accept incoming connection for this to work

4. **Should HTTP API be exposed outside localhost?**
   - Current: localhost-only (safe)
   - Alternative: Expose on local network (less safe, but enables mobile pairing)
   - Or: Keep localhost, mobile app connects via CommServer

## Summary

### What Works ✅

1. ✅ **PairingFileSystem correctly implemented** - Returns 4 files, creates invitations on demand
2. ✅ **ConnectionsModel properly initialized** - Pairing enabled, manager created
3. ✅ **IPC bridge working** - readDir, stat, readFile all functional
4. ✅ **Swift extension correct** - Enumerates invites, maps to IPC calls
5. ✅ **Lazy creation pattern** - Invitations created when accessed

### What's Broken ❌

1. ❌ **Empty invite URL prefix** - Invitation URLs malformed
2. ❌ **No incoming connection URL** - Invitations won't have valid connection endpoint
3. ❌ **Configuration contradiction** - Pairing enabled but connections disabled
4. ❌ **No validation** - Invites may be broken but system reports success
5. ❌ **Insufficient logging** - Hard to diagnose when invites fail

### Root Cause

**Primary issue**: Configuration mismatch between "allow pairing" (true) and "accept incoming connections" (false). Pairing requires incoming connections, or at minimum a valid URL for others to connect to this instance.

**Secondary issue**: Empty invite URL prefix means even if invitation is created, the URL won't be properly formatted.

### Next Steps (Priority Order)

1. **Fix invite URL prefix** (5 minutes)
2. **Enable incoming connections** (5 minutes)
3. **Add invite validation** (15 minutes)
4. **Test with HTTP API** (10 minutes)
5. **Add diagnostic logging** (20 minutes)
6. **Test end-to-end pairing** (30 minutes)

Total estimated time to fix: **~90 minutes**

## Conclusion

The invite system architecture is sound, but needs configuration fixes. All the code is correct - we just need to:
1. Set the invite URL prefix
2. Enable incoming connections (via CommServer)
3. Validate that invites are created correctly
4. Add logging for diagnostics

Once these fixes are in place, invites should work correctly and be accessible via the macOS filesystem.
