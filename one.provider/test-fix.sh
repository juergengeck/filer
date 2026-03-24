#!/bin/bash
#
# Test the node_modules fix
#

set -e

EXT_RESOURCES="/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources"

echo "🔧 Applying node_modules fix..."
echo ""

# Fix the directory name
if [ -d "$EXT_RESOURCES/node_modules_resolved" ]; then
    echo "📋 Renaming node_modules_resolved → node_modules..."
    sudo mv "$EXT_RESOURCES/node_modules_resolved" "$EXT_RESOURCES/node_modules"
    echo "✅ Renamed!"
elif [ -d "$EXT_RESOURCES/node_modules" ]; then
    echo "✅ node_modules already exists - nothing to fix!"
else
    echo "❌ Neither node_modules nor node_modules_resolved found!"
    exit 1
fi

echo ""
echo "🧪 Testing Node.js can find modules..."
cd "$EXT_RESOURCES"
if ./bin/node -e "import('@refinio/one.core/lib/instance.js').then(() => console.log('✅ Module found!')).catch(e => { console.error('❌', e.message); process.exit(1); })" 2>&1 | grep -q "Module found"; then
    echo "✅ Node.js can import @refinio/one.core!"
else
    echo "❌ Still can't import modules - check logs"
    ./bin/node -e "import('@refinio/one.core/lib/instance.js')" 2>&1 | head -10
    exit 1
fi

echo ""
echo "🔄 Restarting File Provider..."
killall fileproviderd 2>/dev/null || true
sleep 2

echo ""
echo "🎉 Fix applied! Now test with:"
echo "   ls ~/Library/CloudStorage/OneFiler-ONE-Test/"
echo ""
echo "📊 Watch logs with:"
echo "   log stream --predicate 'subsystem == \"com.one.provider\"' --level debug"
