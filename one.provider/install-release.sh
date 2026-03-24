#!/bin/bash
set -e

echo "Installing OneFiler.app to /Applications..."

# Remove old app
rm -rf /Applications/OneFiler.app

# Copy new app
cp -R ~/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Release/OneFilerHost.app /Applications/OneFiler.app

# Set ownership
chown -R root:wheel /Applications/OneFiler.app

echo "✅ Installation complete"
echo ""
echo "Verifying node_modules..."
ls -la /Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources/node_modules/@refinio/

echo ""
echo "CLI version:"
/Applications/OneFiler.app/Contents/MacOS/onefiler --version || echo "CLI ready"
