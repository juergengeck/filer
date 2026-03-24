#!/bin/bash
#
# Rebuild and reinstall OneFiler.app
#
# This script performs a complete rebuild and reinstall workflow:
# 1. Clean build via Xcode (as user)
# 2. Install to /Applications (needs sudo)
# 3. Kill running processes
# 4. Re-register File Provider domain
#
# Usage: ./rebuild-and-install.sh [DOMAIN_NAME] [INSTANCE_PATH]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DOMAIN_NAME="${1:-ONE-Test}"
# Use App Group container (extension has sandbox access)
APP_GROUP_CONTAINER="$HOME/Library/Group Containers/group.one.filer"
INSTANCE_PATH="${2:-$APP_GROUP_CONTAINER/instances/$DOMAIN_NAME}"

# Create instance directory if it doesn't exist
mkdir -p "$INSTANCE_PATH"

echo "🔧 Regenerating Xcode project from project.yml..."
cd "$PROJECT_DIR"
xcodegen generate

echo ""
echo "🔨 Building OneFiler via Xcode (as user)..."
xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug clean build

echo ""
echo "📦 Finding built app in DerivedData..."
# Find the most recently modified DerivedData directory
DERIVED_DATA=$(find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 1 -name "OneFiler-*" -type d -exec stat -f "%m %N" {} \; | sort -rn | head -1 | cut -d' ' -f2-)
XCODE_APP_PATH="$DERIVED_DATA/Build/Products/Debug/OneFilerHost.app"

if [ ! -d "$XCODE_APP_PATH" ]; then
    echo "❌ Built app not found at: $XCODE_APP_PATH"
    echo "   Searched in: $DERIVED_DATA"
    exit 1
fi

echo "✅ Found built app at: $XCODE_APP_PATH"
echo ""

# Verify bundled Node.js
NODE_BIN="$XCODE_APP_PATH/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources/bin/node"
if [ ! -f "$NODE_BIN" ]; then
    echo "❌ Node binary not found in extension!"
    exit 1
fi
echo "✅ Node binary found ($(ls -lh "$NODE_BIN" | awk '{print $5}'))"

# Verify ICU dylibs
DYLIBS_DIR="$XCODE_APP_PATH/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources/dylibs"
if [ ! -d "$DYLIBS_DIR" ] || [ -z "$(ls -A "$DYLIBS_DIR")" ]; then
    echo "❌ ICU dylibs not found in extension!"
    exit 1
fi
echo "✅ ICU dylibs found ($(ls "$DYLIBS_DIR" | wc -l | xargs) files)"

# Verify node_modules (Xcode creates node_modules_resolved, we rename after install)
NODE_MODULES_RESOLVED="$XCODE_APP_PATH/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources/node_modules_resolved"
NODE_MODULES="$XCODE_APP_PATH/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources/node_modules"
if [ ! -d "$NODE_MODULES_RESOLVED" ] && [ ! -d "$NODE_MODULES" ]; then
    echo "❌ node_modules directory not found in extension!"
    echo "   Expected either node_modules_resolved or node_modules"
    exit 1
fi
if [ -d "$NODE_MODULES_RESOLVED" ]; then
    echo "✅ node_modules_resolved found (will rename to node_modules after install)"
else
    echo "✅ node_modules found (already renamed)"
fi

echo ""
echo "📦 Installing to /Applications (requires sudo)..."

echo "   Requesting admin password for /Applications install..."
sudo rm -rf /Applications/OneFiler.app
sudo cp -R "$XCODE_APP_PATH" /Applications/OneFiler.app

echo ""
echo "🔄 Renaming node_modules_resolved to node_modules (ES module requirement)..."
EXT_RESOURCES="/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources"
if [ -d "$EXT_RESOURCES/node_modules_resolved" ]; then
    sudo mv "$EXT_RESOURCES/node_modules_resolved" "$EXT_RESOURCES/node_modules"
    echo "✅ Renamed to node_modules"
else
    echo "⚠️  node_modules_resolved not found, checking if node_modules already exists..."
    if [ -d "$EXT_RESOURCES/node_modules" ]; then
        echo "✅ node_modules already exists"
    else
        echo "❌ Neither node_modules_resolved nor node_modules found!"
        exit 1
    fi
fi

echo ""
echo "🔄 Restarting File Provider services..."
killall OneFilerExtension 2>/dev/null || true
killall fileproviderd 2>/dev/null || true

echo ""
echo "📋 Re-registering File Provider domain..."
/Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name "$DOMAIN_NAME" 2>/dev/null || true
/Applications/OneFiler.app/Contents/MacOS/onefiler register --name "$DOMAIN_NAME" --path "$INSTANCE_PATH"

echo ""
echo "✅ Complete! Extension will reload on next access."
echo ""
echo "🔍 To test, run:"
echo "   ls ~/Library/CloudStorage/OneFiler-$DOMAIN_NAME/"
echo ""
echo "📊 To watch logs:"
echo "   log stream --predicate 'subsystem == \"one.filer\"' --level debug"
