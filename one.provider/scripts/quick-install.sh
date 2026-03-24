#!/bin/bash
set -e

echo "🔧 Quick Install Script for OneFiler"
echo "===================================="
echo ""

# Kill any running processes
echo "1️⃣ Killing running processes..."
killall fileproviderd 2>/dev/null || true
killall node 2>/dev/null || true
sleep 1

# Unregister domain if exists
echo "2️⃣ Unregistering existing domain..."
/Applications/OneFiler.app/Contents/MacOS/onefiler unregister --name ONE-Test 2>/dev/null || true

# Remove old app and install new one (requires sudo)
echo "3️⃣ Installing new version to /Applications..."
echo "   (Requesting sudo password)"
sudo rm -rf /Applications/OneFiler.app
sudo cp -R /Users/gecko/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Debug/OneFilerHost.app /Applications/OneFiler.app

echo ""
echo "4️⃣ Re-registering domain..."
/Applications/OneFiler.app/Contents/MacOS/onefiler register --name ONE-Test --path ~/Library/Group\ Containers/group.com.one.filer/instances/ONE-Test

echo ""
echo "5️⃣ Restarting Finder..."
killall Finder

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 To view the mount point:"
echo "   ls ~/Library/CloudStorage/OneFiler-ONE-Test/"
echo ""
echo "📋 To view debug logs:"
echo "   tail -f ~/Library/Group\ Containers/group.com.one.filer/debug/ipc.log"
echo ""
