# Next Steps: Enable File Provider Domain

**Current Status:** ✅ Extension fixed and loads, but ❌ domain is disabled

---

## The Issue

The File Provider extension is working correctly, but macOS has the domain **disabled**. When trying to access files:

```
Error FP -2011: DomainDisabled - "Synchronisieren ist für [domain] nicht aktiviert"
```

This is a user-level setting that needs to be enabled in System Settings.

---

## How to Enable

### Option 1: System Settings (GUI)

1. Open **System Settings**
2. Go to **Privacy & Security** → **Extensions** → **File Provider**
3. Find **OneFiler** in the list
4. Toggle it **ON** if it's off
5. If there are per-domain toggles, enable the specific domain (`server-provider-instance`)

### Option 2: Command Line (if available)

Unfortunately, there's no direct command-line way to enable File Provider domains. This must be done through System Settings.

---

## After Enabling

Once the domain is enabled:

1. **Restart the test:**
   ```bash
   npm run test:connection
   ```

2. **Or manually verify:**
   ```bash
   ls ~/Library/CloudStorage/OneFiler-server-provider-instance/
   # Should show: chats/ invites/ objects/ etc.
   ```

3. **Check extension loads:**
   ```bash
   log stream --predicate 'subsystem == "com.one.filer"' --level debug
   # Then in another terminal:
   ls ~/Library/CloudStorage/OneFiler-server-provider-instance/
   # Should see "OneFiler Extension: init() called for domain"
   ```

---

## What We've Verified So Far

✅ Extension compiles and installs correctly
✅ Extension is registered with pluginkit
✅ App Group identifier is correct
✅ Domains can be registered
✅ Mount points are created
✅ File Provider daemon recognizes the extension
✅ No code signing issues

❌ Domain is disabled in System Settings (user must enable)

---

## Why This Happens

macOS requires explicit user consent for File Provider extensions to access files. This is a security feature. Even though the extension is installed and registered, each domain must be explicitly enabled by the user.

---

## Expected Behavior After Enabling

1. **Extension initializes:**
   ```
   OneFiler Extension: init() called for domain: server-provider-instance
   OneFiler: Connected to ONE instance at /var/folders/.../refinio-api-server-instance
   ```

2. **Files are enumerated:**
   ```bash
   $ ls ~/Library/CloudStorage/OneFiler-server-provider-instance/
   chats/  invites/  objects/  types/  profiles/
   ```

3. **Invites are readable:**
   ```bash
   $ cat ~/Library/CloudStorage/OneFiler-server-provider-instance/invites/iop_invite.txt
   one://invite/...
   ```

4. **Connection test passes:**
   ```bash
   $ npm run test:connection
   ✅ All connection tests passed
   ```

---

## Troubleshooting

### If domain doesn't appear in System Settings

1. Check extension is registered:
   ```bash
   /Applications/OneFiler.app/Contents/MacOS/onefiler status
   ```

2. Reload File Provider extensions:
   ```bash
   killall fileproviderd
   # macOS will restart it automatically
   ```

3. Re-register the domain:
   ```bash
   /Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name server-provider-instance
   /Applications/OneFiler.app/Contents/MacOS/onefiler register --name server-provider-instance --path /var/folders/.../refinio-api-server-instance
   ```

### If extension still doesn't load

1. Check for crash logs:
   ```bash
   ls -lt ~/Library/Logs/DiagnosticReports/ | grep OneFiler | head -5
   ```

2. Check Console.app for errors:
   - Open Console.app
   - Filter by "OneFiler" or "com.one.filer"
   - Look for error messages

3. Verify Node.js is in PATH:
   ```bash
   which node
   # Should output: /usr/local/bin/node or similar
   ```

---

## Current Test Results

From the connection test run:

```
✅ Mount point appeared after 0 seconds
✅ File Provider mount accessible
❌ Invites directory not found (domain disabled)
```

**Partial Results:**
- fileProviderAvailable: true
- mountPointExists: true
- invitesDirectoryExists: false ← **This is why**
- Extension not loading files because domain is disabled

---

## References

- Error FP -2011: https://developer.apple.com/documentation/fileprovider/nsfileprovidererror/code/domainnotenabled
- File Provider Privacy: https://developer.apple.com/documentation/fileprovider/content_and_change_tracking/enabling_file_provider_extension
