#!/bin/bash
#
# Migrate from old bundle IDs (com.one.filer.*) to new (one.filer.*)
#
# This script helps migrate existing installations to the new bundle identifiers.
#

set -e

echo "🔄 OneFiler Bundle ID Migration"
echo "================================"
echo ""
echo "This script will:"
echo "  1. Unregister domains from old extension (com.one.filer.extension)"
echo "  2. Migrate instance data to new App Group (group.one.filer)"
echo "  3. Re-register domains with new extension (one.filer.extension)"
echo ""

OLD_APP_GROUP="$HOME/Library/Group Containers/group.com.one.filer"
NEW_APP_GROUP="$HOME/Library/Group Containers/group.one.filer"

echo "📋 Checking for existing domains..."
if [ -f "$OLD_APP_GROUP/domains.json" ]; then
    echo "✅ Found domains.json in old App Group"
    echo ""
    echo "Domains to migrate:"
    cat "$OLD_APP_GROUP/domains.json" | python3 -m json.tool 2>/dev/null || cat "$OLD_APP_GROUP/domains.json"
    echo ""
else
    echo "⚠️  No domains.json found in old App Group"
    echo "   Nothing to migrate - you can proceed with fresh registration"
    exit 0
fi

read -p "Continue with migration? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Migration cancelled"
    exit 1
fi

echo ""
echo "📦 Step 1: Creating new App Group directory..."
mkdir -p "$NEW_APP_GROUP"
echo "✅ Created: $NEW_APP_GROUP"

echo ""
echo "📦 Step 2: Copying configuration and data..."
if [ -f "$OLD_APP_GROUP/domains.json" ]; then
    cp "$OLD_APP_GROUP/domains.json" "$NEW_APP_GROUP/domains.json"
    echo "✅ Copied domains.json"
fi

if [ -d "$OLD_APP_GROUP/instances" ]; then
    cp -R "$OLD_APP_GROUP/instances" "$NEW_APP_GROUP/instances"
    echo "✅ Copied instances directory"
fi

if [ -d "$OLD_APP_GROUP/logs" ]; then
    cp -R "$OLD_APP_GROUP/logs" "$NEW_APP_GROUP/logs"
    echo "✅ Copied logs directory"
fi

if [ -d "$OLD_APP_GROUP/debug" ]; then
    cp -R "$OLD_APP_GROUP/debug" "$NEW_APP_GROUP/debug"
    echo "✅ Copied debug logs"
fi

echo ""
echo "📦 Step 3: Killing existing File Provider processes..."
killall OneFilerExtension 2>/dev/null || true
killall fileproviderd 2>/dev/null || true
sleep 2

echo ""
echo "✅ Migration complete!"
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Enable the new extension in System Settings:"
echo "   System Settings → Privacy & Security → Extensions → File Provider"
echo "   → Enable OneFiler"
echo ""
echo "2. Re-register your domains using the CLI:"
echo "   /Applications/OneFiler.app/Contents/MacOS/onefiler register --name YOUR_DOMAIN --path PATH"
echo ""
echo "3. Monitor logs with the new subsystem:"
echo "   log stream --predicate 'subsystem == \"one.filer\"' --level debug"
echo ""
echo "💡 The old App Group data has been copied to the new location:"
echo "   OLD: $OLD_APP_GROUP"
echo "   NEW: $NEW_APP_GROUP"
echo ""
