#!/bin/bash
set -e

echo "Installing Debug build to /Applications..."
rm -rf /Applications/OneFiler.app
cp -R ~/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Debug/OneFilerHost.app /Applications/OneFiler.app
chown -R root:wheel /Applications/OneFiler.app
echo "✅ Installed Debug build"
