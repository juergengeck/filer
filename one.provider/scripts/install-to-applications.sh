#!/bin/bash
#
# Install OneFiler.app to /Applications
#
# This script installs the debug or release build of OneFiler.app to /Applications,
# which is required for the File Provider extension to work properly.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Determine which build to install (default: debug)
BUILD_TYPE="${1:-debug}"

if [ "$BUILD_TYPE" != "debug" ] && [ "$BUILD_TYPE" != "release" ]; then
    echo "❌ Invalid build type: $BUILD_TYPE"
    echo "Usage: $0 [debug|release]"
    exit 1
fi

APP_PATH="$PROJECT_DIR/.build/$BUILD_TYPE/OneFiler.app"

# Check if app exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ OneFiler.app not found at: $APP_PATH"
    echo ""
    echo "Please build the app first:"
    echo "  cd $PROJECT_DIR"
    if [ "$BUILD_TYPE" = "release" ]; then
        echo "  swift build -c release"
    else
        echo "  swift build"
    fi
    exit 1
fi

echo "📦 Installing OneFiler.app to /Applications..."
echo "   Source: $APP_PATH"
echo "   Destination: /Applications/OneFiler.app"
echo ""

# Remove existing installation if present
if [ -d "/Applications/OneFiler.app" ]; then
    echo "🗑️  Removing existing installation..."
    sudo rm -rf /Applications/OneFiler.app
fi

# Copy to /Applications
echo "📋 Copying app bundle..."
sudo cp -R "$APP_PATH" /Applications/

# Fix node_modules directory name for ES modules
EXT_RESOURCES="/Applications/OneFiler.app/Contents/PlugIns/OneFilerExtension.appex/Contents/Resources"
if [ -d "$EXT_RESOURCES/node_modules_resolved" ]; then
    echo "🔧 Fixing node_modules directory for ES modules..."
    sudo mv "$EXT_RESOURCES/node_modules_resolved" "$EXT_RESOURCES/node_modules"
fi

# Verify installation
if [ -d "/Applications/OneFiler.app" ]; then
    echo "✅ Installation complete!"
    echo ""
    echo "📍 Location: /Applications/OneFiler.app"

    # Show code signing status
    echo ""
    echo "🔐 Code Signing Status:"
    codesign -dv /Applications/OneFiler.app 2>&1 | grep -E "(Identifier|TeamIdentifier)" || true

    echo ""
    echo "📋 Next Steps:"
    echo "   1. Open System Settings"
    echo "   2. Go to: Privacy & Security → Extensions → File Provider"
    echo "   3. Enable the 'OneFiler' extension"
    echo ""
    echo "   Then verify with:"
    echo "     /Applications/OneFiler.app/Contents/MacOS/onefiler status"
else
    echo "❌ Installation failed - /Applications/OneFiler.app not found"
    exit 1
fi
