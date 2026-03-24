# FUSE Mount Cleanup Guide

## The Problem

When FUSE processes crash or are killed before unmounting, they leave **stale mounts** - directories that the kernel thinks are mount points but nothing is serving them. This causes `ENOTCONN: socket is not connected` errors.

## Quick Fix - Just Run the Cleanup Script

Before running any test, if you get ENOTCONN errors:

```bash
./cleanup-mounts.sh
```

That's it! The script is now automatically called at the beginning of all tests.

## What the Cleanup Script Does

The `cleanup-mounts.sh` script:
1. Unmounts all FUSE mounts in `.tmp/` and `/tmp/`
2. Removes the `.tmp` directory
3. Exits cleanly so tests can proceed

## Automatic Cleanup

All test files now call `cleanup-mounts.sh` automatically at startup:
- ✅ `test-simple-operations.js`
- ✅ `test-typical-operations.js`
- ✅ `test-error-handling.js`

So you should **never** get ENOTCONN errors anymore!

## Manual Cleanup (If Needed)

### Check for Stale Mounts
```bash
mount | grep fuse
# or
mount | grep .tmp
```

### Unmount a Specific Mount
```bash
fusermount3 -u /path/to/mount
# or on older systems
fusermount -u /path/to/mount
```

### Unmount Everything FUSE-Related
```bash
# Find all FUSE mounts
mount | grep fuse | awk '{print $3}' | while read mount; do
    fusermount3 -u "$mount" 2>/dev/null || fusermount -u "$mount" 2>/dev/null
done

# Clean up
rm -rf .tmp
```

### Nuclear Option (If Nothing Else Works)
```bash
# Requires sudo - lazy unmount forces it
sudo umount -l /home/arne/Documents/repos/github/refinio/filer_test_setup/one.fuse3/.tmp/*
sudo umount -l /home/arne/Documents/repos/github/refinio/filer_test_setup/one.fuse3/.tmp
rm -rf .tmp
```

## Why ENOTCONN Happens

1. **Test starts** → Creates FUSE mount at `.tmp/fuse-simple-test`
2. **Process crashes** → FUSE driver stops but kernel still thinks it's mounted
3. **Next test runs** → Tries to `mkdir .tmp/fuse-simple-test`
4. **Kernel says** → "That's a mount point, you can't mkdir it"
5. **Result** → `ENOTCONN: socket is not connected`

The cleanup script breaks this cycle by unmounting before the test starts.

## Testing the Cleanup

Verify the cleanup works:

```bash
# 1. Run cleanup
./cleanup-mounts.sh

# 2. Check no stale mounts remain
mount | grep -E "fuse.*\.tmp|fuse.*fuse-"
# Should output: (nothing)

# 3. Run a test
node test-simple-operations.js
# Should output: 8/8 tests passed
```

## Adding Cleanup to New Tests

If you create a new test file, add this at the top:

```javascript
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Run cleanup script at the very beginning
try {
  execSync(path.join(__dirname, 'cleanup-mounts.sh'), { stdio: 'inherit' });
} catch (e) {
  console.warn('Warning: cleanup-mounts.sh failed, continuing anyway...');
}
```

## Troubleshooting

### "Permission denied" when unmounting
Try with sudo:
```bash
sudo fusermount3 -u /path/to/mount
```

### Cleanup script doesn't execute
Make sure it's executable:
```bash
chmod +x cleanup-mounts.sh
```

### Mount still appears after cleanup
Check if the process is still running:
```bash
ps aux | grep fuse
# Kill any lingering processes
kill -9 <PID>
./cleanup-mounts.sh
```

### Tests still fail after cleanup
1. Run cleanup manually: `./cleanup-mounts.sh`
2. Check mounts: `mount | grep fuse`
3. Verify .tmp is gone: `ls -la .tmp` (should say "No such file or directory")
4. Try the nuclear option above

## Best Practices

1. **Always Ctrl+C (SIGINT)** instead of `kill -9` when stopping tests
2. **Run cleanup before reporting bugs** - Many issues are just stale mounts
3. **Check mounts if tests hang** - Might be trying to access stale mount
4. **Use the .tmp directory** - Don't create mounts in `/tmp` or other shared locations

## Summary

**Problem:** Stale FUSE mounts cause ENOTCONN errors
**Solution:** `./cleanup-mounts.sh` (now runs automatically)
**Prevention:** Tests auto-cleanup, you shouldn't see this anymore!
