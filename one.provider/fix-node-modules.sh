#!/bin/bash
#
# Quick fix: Rename node_modules_resolved to node_modules
#
# Root cause: ES modules in Node.js don't respect NODE_PATH,
# they only look in node_modules directories.
#

set -e

EXT_RESOURCES="/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources"

echo "🔧 Fixing node_modules directory name..."
echo ""

if [ ! -d "$EXT_RESOURCES" ]; then
    echo "❌ Extension resources not found at: $EXT_RESOURCES"
    exit 1
fi

cd "$EXT_RESOURCES"

if [ -d "node_modules" ]; then
    echo "✅ node_modules already exists - nothing to do!"
    exit 0
fi

if [ ! -d "node_modules_resolved" ]; then
    echo "❌ node_modules_resolved not found"
    exit 1
fi

echo "📋 Renaming node_modules_resolved → node_modules..."
sudo mv node_modules_resolved node_modules

echo "✅ Fixed! Now testing..."
./bin/node lib/index.js 2>&1 | head -5 &
NODE_PID=$!
sleep 1
kill $NODE_PID 2>/dev/null || true

echo ""
echo "🔄 Restart File Provider to apply fix:"
echo "   killall fileproviderd"
echo "   ls ~/Library/CloudStorage/OneFiler-ONE-Test/"
