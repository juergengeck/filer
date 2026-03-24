#!/bin/bash
#
# Install and test with comprehensive logging
#
# Usage: sudo -E ./scripts/test-with-logs.sh
# (The -E preserves USER and HOME environment variables)
#

set -e

# Get the actual user who invoked sudo
ACTUAL_USER="${SUDO_USER:-$USER}"
ACTUAL_HOME=$(eval echo ~$ACTUAL_USER)

XCODE_APP_PATH="$ACTUAL_HOME/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Debug/OneFilerHost.app"
DOMAIN_NAME="${1:-ONE-Test}"
# Use App Group container (extension has sandbox access)
APP_GROUP_CONTAINER="$HOME/Library/Group Containers/group.com.one.filer"
INSTANCE_PATH="${2:-$APP_GROUP_CONTAINER/instances/$DOMAIN_NAME}"

# Create instance directory if it doesn't exist
mkdir -p "$INSTANCE_PATH"

echo "📦 Installing to /Applications..."
rm -rf /Applications/OneFiler.app
cp -R "$XCODE_APP_PATH" /Applications/OneFiler.app

echo ""
echo "🔄 Cleaning up old processes..."
killall OneFilerExtension 2>/dev/null || true
killall fileproviderd 2>/dev/null || true

echo "   Waiting for processes to fully terminate..."
sleep 3

echo ""
echo "✅ Enabling extension (as $ACTUAL_USER)..."
sudo -u "$ACTUAL_USER" pluginkit -e use -i com.one.filer.extension

echo ""
echo "📋 Re-registering domain (as $ACTUAL_USER)..."
sudo -u "$ACTUAL_USER" /Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name "$DOMAIN_NAME" 2>/dev/null || true
sudo -u "$ACTUAL_USER" /Applications/OneFiler.app/Contents/MacOS/onefiler register --name "$DOMAIN_NAME" --path "$INSTANCE_PATH"

echo ""
echo "📊 Starting log stream (subsystem: com.one.provider)..."
echo "    Watch for 🚀 emoji in logs!"
echo ""

# Start log stream in background
log stream --predicate 'subsystem == "com.one.provider"' --level debug &
LOG_PID=$!

# Give it time to start
sleep 2

echo ""
echo "🔍 Testing access to ~/Library/CloudStorage/OneFiler-$DOMAIN_NAME/ ..."
echo ""

# Try to access the folder
timeout 10 ls ~/Library/CloudStorage/OneFiler-$DOMAIN_NAME/ || echo "❌ ls timed out or failed"

# Give logs time to appear
sleep 2

# Stop log stream
kill $LOG_PID 2>/dev/null || true

echo ""
echo "✅ Test complete!"
echo ""
echo "If you saw NO logs with 🚀 emoji, the File Provider extension is not being called."
echo "If you saw logs, check what failed in the sequence."
