#!/bin/bash
#
# Complete cleanup of OneFiler File Provider domains and mount points
#
set -e

echo "🧹 OneFiler Cleanup Script"
echo "=========================="
echo ""

# Kill all running processes
echo "🔄 Stopping File Provider processes..."
killall OneFilerExtension 2>/dev/null || true
killall fileproviderd 2>/dev/null || true
killall node 2>/dev/null || true  # Kill any lingering IPC servers
echo "   Waiting for processes to terminate..."
sleep 3

echo ""
echo "📋 Unregistering all domains..."

# Get list of domains from CLI
if [ -f "/Applications/OneFiler.app/Contents/MacOS/onefiler" ]; then
    CLI_PATH="/Applications/OneFiler.app/Contents/MacOS/onefiler"
elif [ -f ".build/debug/onefiler" ]; then
    CLI_PATH=".build/debug/onefiler"
else
    echo "❌ CLI tool not found"
    exit 1
fi

# Parse domain names from the output
DOMAINS=$($CLI_PATH list 2>/dev/null | grep "^  •" | sed 's/^  • //' || true)

if [ -z "$DOMAINS" ]; then
    echo "   No domains registered"
else
    while IFS= read -r domain; do
        echo "   Unregistering: $domain"
        $CLI_PATH unregister --name "$domain" 2>/dev/null || echo "   ⚠️  Failed to unregister $domain"
    done <<< "$DOMAINS"
fi

echo ""
echo "🗑️  Removing mount points..."
# Force remove CloudStorage mount points
rm -rf ~/Library/CloudStorage/OneFiler-* 2>/dev/null || true

echo ""
echo "🗂️  Clearing domain configuration..."
# Clear App Group container domains.json
APP_GROUP_PATH="$HOME/Library/Group Containers/group.com.one.filer"
if [ -f "$APP_GROUP_PATH/domains.json" ]; then
    rm -f "$APP_GROUP_PATH/domains.json"
    echo "   Removed $APP_GROUP_PATH/domains.json"
else
    echo "   No domain configuration found"
fi

echo ""
echo "🔍 Checking pluginkit status..."
pluginkit -m | grep com.one.filer || echo "   Extension not found in pluginkit"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "To verify:"
echo "  ls ~/Library/CloudStorage/ | grep OneFiler    # Should be empty"
echo "  $CLI_PATH list                                # Should show no domains"
