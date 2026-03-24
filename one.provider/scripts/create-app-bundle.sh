#!/bin/bash
set -e

# OneFiler App Bundle Builder
# Creates a minimal macOS app bundle with embedded File Provider extension

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/.build/debug"
APP_NAME="OneFiler"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
EXTENSION_NAME="OneFilerExtension"

echo "🚀 Building OneFiler app bundle..."
echo "   Project: $PROJECT_DIR"
echo "   Output: $APP_BUNDLE"

# Step 1: Build Swift Package
echo ""
echo "📦 Building Swift package..."
cd "$PROJECT_DIR"
swift build

# Step 2: Create app bundle structure
echo ""
echo "📁 Creating app bundle structure..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Step 3: Copy executables and frameworks to app bundle
echo "📋 Copying executables..."

# Copy the host app executable and dylibs from Xcode build
XCODE_HOST_APP="/Users/gecko/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Debug/OneFilerHost.app"
if [ -d "$XCODE_HOST_APP" ]; then
    # Copy main executable
    cp "$XCODE_HOST_APP/Contents/MacOS/OneFilerHost" "$APP_BUNDLE/Contents/MacOS/OneFilerHost"
    chmod +x "$APP_BUNDLE/Contents/MacOS/OneFilerHost"

    # Copy debug dylib if it exists
    if [ -f "$XCODE_HOST_APP/Contents/MacOS/OneFilerHost.debug.dylib" ]; then
        cp "$XCODE_HOST_APP/Contents/MacOS/OneFilerHost.debug.dylib" "$APP_BUNDLE/Contents/MacOS/OneFilerHost.debug.dylib"
    fi

    # Copy Frameworks directory if it exists
    if [ -d "$XCODE_HOST_APP/Contents/Frameworks" ]; then
        mkdir -p "$APP_BUNDLE/Contents/Frameworks"
        ditto "$XCODE_HOST_APP/Contents/Frameworks" "$APP_BUNDLE/Contents/Frameworks"
    fi

    echo "   ✅ Host app executable copied"
else
    echo "   ⚠️  Host app not found - run xcodebuild first"
fi

# Also copy CLI tool for convenience
cp "$BUILD_DIR/onefiler" "$APP_BUNDLE/Contents/MacOS/onefiler"
chmod +x "$APP_BUNDLE/Contents/MacOS/onefiler"
echo "   ✅ CLI tool copied"

# Step 4: Copy Xcode-built extension
echo "📋 Copying Xcode-built extension..."
# Find the Xcode-built extension
XCODE_EXTENSION="/Users/gecko/Library/Developer/Xcode/DerivedData/OneFiler-guwuqymrhhbgjffgdnnvxbbkujub/Build/Products/Debug/OneFilerExtension.appex"

if [ -d "$XCODE_EXTENSION" ]; then
    echo "   Found Xcode extension at: $XCODE_EXTENSION"
    # Copy the entire .appex bundle using ditto to preserve code signature
    rm -rf "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex"
    ditto "$XCODE_EXTENSION" "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex"
    echo "   ✅ Extension copied successfully"
else
    echo "   ⚠️  Xcode extension not found - build it first with:"
    echo "      xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug build"
    # Create placeholder structure
    touch "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex/Contents/MacOS/OneFilerExtension"
fi

# Step 5: Copy Node.js runtime
echo "📋 Copying Node.js runtime..."
if [ -d "$PROJECT_DIR/node-runtime/lib" ]; then
    cp -R "$PROJECT_DIR/node-runtime/lib" "$APP_BUNDLE/Contents/Resources/lib"
    echo "   ✅ Node.js runtime copied"
else
    echo "   ⚠️  Node.js runtime not found - build it first with: cd node-runtime && npm run build"
fi

# Step 6: Copy Info.plist for app only (extension already has it from Xcode)
echo "📋 Copying Info.plist..."
cp "$PROJECT_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
# Don't overwrite extension's Info.plist - it's already correct from Xcode build

# Step 7: Code signing
echo "🔐 Code signing..."

# Get the signing identity from the extension (it was signed by Xcode)
SIGNING_IDENTITY=$(codesign -dvvv "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex" 2>&1 | grep "Authority=Apple Development" | head -1 | sed 's/Authority=//')

if [[ -n "$SIGNING_IDENTITY" ]]; then
    echo "   Using signing identity: $SIGNING_IDENTITY"

    # Sign the CLI tool
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none \
        "$APP_BUNDLE/Contents/MacOS/onefiler" 2>/dev/null || true

    # Sign the main executable (already signed but may need refresh)
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none \
        "$APP_BUNDLE/Contents/MacOS/OneFilerHost" 2>/dev/null || true

    # Sign the entire app bundle
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp=none --deep \
        "$APP_BUNDLE" 2>/dev/null && echo "   ✅ App bundle signed successfully" || echo "   ⚠️  Bundle signing failed"
else
    echo "   ⚠️  No Apple Development signature found, using ad-hoc"
    codesign --force --sign - --deep "$APP_BUNDLE" 2>/dev/null || true
fi

echo ""
echo "✅ App bundle created successfully!"
echo "   Location: $APP_BUNDLE"
echo ""
echo "📦 Contents:"
echo "   - CLI tool: $APP_BUNDLE/Contents/MacOS/onefiler"
if [ -f "$APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex/Contents/MacOS/OneFilerExtension" ]; then
    echo "   - Extension: $APP_BUNDLE/Contents/PlugIns/$EXTENSION_NAME.appex ✅"
else
    echo "   - Extension: NOT BUILT (run xcodebuild first)"
fi
echo ""
echo "Usage:"
echo "   $APP_BUNDLE/Contents/MacOS/onefiler help"
echo "   $APP_BUNDLE/Contents/MacOS/onefiler register --name 'ONE' --path '/path/to/instance'"
echo "   $APP_BUNDLE/Contents/MacOS/onefiler list"
