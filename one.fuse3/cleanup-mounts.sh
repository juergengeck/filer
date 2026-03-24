#!/bin/bash
# cleanup-mounts.sh - Clean up stale FUSE mounts before running tests

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$SCRIPT_DIR/.tmp"

# Function to unmount a path if it's mounted
unmount_if_mounted() {
    local mount_point="$1"

    # Check if it's in the mount list (works even if directory doesn't exist)
    if mount | grep -q "$mount_point"; then
        echo "[cleanup] Unmounting: $mount_point"
        fusermount3 -u "$mount_point" 2>/dev/null || \
        fusermount -u "$mount_point" 2>/dev/null || \
        true
        sleep 0.1
    fi
}

# Unmount all possible mount points (specific ones first)
unmount_if_mounted "$TMP_DIR/fuse-typical-ops-test"
unmount_if_mounted "$TMP_DIR/fuse-simple-test"
unmount_if_mounted "$TMP_DIR/fuse-error-test"
unmount_if_mounted "$TMP_DIR/fuse-read-test"
unmount_if_mounted "$TMP_DIR/fuse-write-test"

# Also check for old mounts in /tmp
unmount_if_mounted "/tmp/fuse-typical-ops-test"
unmount_if_mounted "/tmp/fuse-simple-test"
unmount_if_mounted "/tmp/fuse-error-test"
unmount_if_mounted "/tmp/fuse-read-test"
unmount_if_mounted "/tmp/fuse-write-test"
unmount_if_mounted "/tmp/one-filer-test"

# Finally unmount .tmp itself
unmount_if_mounted "$TMP_DIR"

# Remove .tmp directory
if [ -d "$TMP_DIR" ]; then
    echo "[cleanup] Removing $TMP_DIR"
    rm -rf "$TMP_DIR" 2>/dev/null || true
fi

echo "[cleanup] Done"
exit 0
