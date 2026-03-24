#!/bin/bash
#
# Build distribution package for OneFiler
# Requires: Apple Developer ID Application certificate and notarization credentials
#
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEVELOPER_ID="${DEVELOPER_ID:-Developer ID Application}"
TEAM_ID="${TEAM_ID:-26W8AC52QS}"
BUNDLE_ID="one.filer"
APP_NAME="OneFilerHost"
FINAL_APP_NAME="OneFiler"
VERSION="${VERSION:-1.0.0}"
BUILD_DIR="$PROJECT_DIR/build"
DIST_DIR="$PROJECT_DIR/dist"

echo "🚀 Building OneFiler for Distribution"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Version: $VERSION"
echo "Team ID: $TEAM_ID"
echo "Developer ID: $DEVELOPER_ID"
echo ""

# Function to check prerequisites
check_prerequisites() {
    echo "🔍 Checking prerequisites..."

    # Check for Developer ID certificate
    if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
        echo -e "${RED}❌ Error: Developer ID Application certificate not found${NC}"
        echo ""
        echo "You need a Developer ID Application certificate for distribution."
        echo ""
        echo "Steps to get it:"
        echo "  1. Open Keychain Access"
        echo "  2. Menu: Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority"
        echo "  3. Save the CSR to disk"
        echo "  4. Go to: https://developer.apple.com/account/resources/certificates/add"
        echo "  5. Select 'Developer ID Application'"
        echo "  6. Upload your CSR and download the certificate"
        echo "  7. Double-click the downloaded certificate to install"
        echo ""
        exit 1
    fi

    # Check for notarization credentials (keychain or env vars)
    CREDS_FOUND=false
    # Check if keychain profile exists
    if security find-generic-password -s "altool-app-password-OneFiler Notarization" 2>/dev/null >/dev/null; then
        CREDS_FOUND=true
        echo -e "${GREEN}✅ Notarization credentials found in keychain${NC}"
    elif [ -n "$NOTARIZATION_APPLE_ID" ] && [ -n "$NOTARIZATION_PASSWORD" ]; then
        CREDS_FOUND=true
        echo -e "${GREEN}✅ Notarization credentials found in environment${NC}"
    else
        echo -e "${YELLOW}⚠️  Notarization credentials not configured${NC}"
        echo "Notarization will be skipped. To enable:"
        echo "  xcrun notarytool store-credentials \"OneFiler Notarization\" \\"
        echo "    --apple-id \"your@apple.id\" \\"
        echo "    --team-id \"$TEAM_ID\" \\"
        echo "    --password \"app-specific-password\""
    fi

    # Check for required tools
    command -v xcodebuild >/dev/null 2>&1 || { echo "❌ xcodebuild required"; exit 1; }
    command -v xcodegen >/dev/null 2>&1 || { echo "❌ xcodegen required"; exit 1; }
    command -v npm >/dev/null 2>&1 || { echo "❌ npm required"; exit 1; }

    echo -e "${GREEN}✅ Prerequisites OK${NC}"
    echo ""
}

# Function to build TypeScript
build_typescript() {
    echo "📦 Building TypeScript IPC server..."
    npm install
    npm run build

    echo -e "${GREEN}✅ TypeScript built${NC}"
    echo ""
}

# Function to bundle Node.js
bundle_nodejs() {
    echo "📦 Bundling Node.js runtime..."
    ./scripts/bundle-node.sh
    echo -e "${GREEN}✅ Node.js bundled${NC}"
    echo ""
}

# Function to build Xcode project
build_xcode() {
    echo "🔨 Building Xcode project..."

    # Regenerate project
    xcodegen generate

    # Clean build directory
    rm -rf "$BUILD_DIR"
    mkdir -p "$BUILD_DIR"

    # Build for Release with Automatic signing first
    xcodebuild \
        -project OneFiler.xcodeproj \
        -scheme OneFilerHost \
        -configuration Release \
        -derivedDataPath "$BUILD_DIR" \
        clean build

    # Find the built app
    APP_PATH=$(find "$BUILD_DIR" -name "${APP_NAME}.app" -type d | head -1)

    if [ -z "$APP_PATH" ]; then
        echo -e "${RED}❌ Error: Built app not found${NC}"
        exit 1
    fi

    echo "App built at: $APP_PATH"
    echo ""

    # Re-sign with Developer ID for distribution
    echo "🔏 Re-signing with Developer ID..."

    # Sign all executables and libraries first (inside-out)
    find "$APP_PATH" -type f \( -name "*.dylib" -o -perm +111 \) -print0 | while IFS= read -r -d '' file; do
        if file "$file" | grep -q "Mach-O"; then
            echo "  Signing: $(basename "$file")"
            codesign --force --sign "Developer ID Application: Refinio GmbH (26W8AC52QS)" \
                --timestamp \
                --options runtime \
                "$file" 2>/dev/null || true
        fi
    done

    # Sign the extension
    EXTENSION_PATH="$APP_PATH/Contents/PlugIns/OneFilerExtension.appex"
    if [ -d "$EXTENSION_PATH" ]; then
        echo "  Signing extension..."
        codesign --force --sign "Developer ID Application: Refinio GmbH (26W8AC52QS)" \
            --timestamp \
            --options runtime \
            --entitlements Resources/Extension.entitlements \
            "$EXTENSION_PATH"
    fi

    # Sign the main app
    echo "  Signing main app..."
    codesign --force --sign "Developer ID Application: Refinio GmbH (26W8AC52QS)" \
        --timestamp \
        --options runtime \
        --entitlements Resources/OneFiler.entitlements \
        "$APP_PATH"

    echo -e "${GREEN}✅ Xcode build and re-signing complete${NC}"
    echo ""
}

# Function to verify code signing
verify_signing() {
    echo "🔍 Verifying code signature..."

    # Check signature details
    codesign -dvv "$APP_PATH" 2>&1 | grep -E "(Authority|TeamIdentifier|Identifier|Signed Time)" || true

    echo -e "${GREEN}✅ Code signature verification complete${NC}"
    echo ""
}

# Function to create DMG
create_dmg() {
    echo "💿 Creating DMG..."

    mkdir -p "$DIST_DIR"
    DMG_PATH="$DIST_DIR/${FINAL_APP_NAME}-${VERSION}.dmg"

    # Remove old DMG if exists
    rm -f "$DMG_PATH"

    # Create temporary directory for DMG contents
    DMG_TEMP="$BUILD_DIR/dmg-temp"
    rm -rf "$DMG_TEMP"
    mkdir -p "$DMG_TEMP"

    # Copy app to temp directory with final name
    cp -R "$APP_PATH" "$DMG_TEMP/${FINAL_APP_NAME}.app"

    # Create symbolic link to Applications folder
    ln -s /Applications "$DMG_TEMP/Applications"

    # Create DMG
    hdiutil create \
        -volname "$FINAL_APP_NAME" \
        -srcfolder "$DMG_TEMP" \
        -ov \
        -format UDZO \
        "$DMG_PATH"

    # Clean up temp directory
    rm -rf "$DMG_TEMP"

    echo "DMG created at: $DMG_PATH"
    echo -e "${GREEN}✅ DMG created${NC}"
    echo ""
}

# Function to notarize
notarize() {
    echo "🔐 Notarizing app..."

    # Zip the app for notarization (use final name)
    ZIP_PATH="$DIST_DIR/${FINAL_APP_NAME}-${VERSION}.zip"

    # Create temp directory with renamed app
    ZIP_TEMP="$BUILD_DIR/zip-temp"
    rm -rf "$ZIP_TEMP"
    mkdir -p "$ZIP_TEMP"
    cp -R "$APP_PATH" "$ZIP_TEMP/${FINAL_APP_NAME}.app"

    ditto -c -k --keepParent "$ZIP_TEMP/${FINAL_APP_NAME}.app" "$ZIP_PATH"
    rm -rf "$ZIP_TEMP"

    echo "Uploading to Apple..."

    # Try keychain-stored credentials first
    if xcrun notarytool submit "$ZIP_PATH" \
        --keychain-profile "OneFiler Notarization" \
        --wait 2>/dev/null; then
        echo -e "${GREEN}✅ Notarization submitted using keychain credentials${NC}"
    # Fall back to environment variables
    elif [ -n "$NOTARIZATION_APPLE_ID" ] && [ -n "$NOTARIZATION_PASSWORD" ]; then
        xcrun notarytool submit "$ZIP_PATH" \
            --apple-id "$NOTARIZATION_APPLE_ID" \
            --password "$NOTARIZATION_PASSWORD" \
            --team-id "$TEAM_ID" \
            --wait
    else
        echo -e "${YELLOW}⚠️  Skipping notarization (credentials not found)${NC}"
        echo ""
        echo "To enable notarization:"
        echo "  xcrun notarytool store-credentials \"OneFiler Notarization\" \\"
        echo "    --apple-id \"your@apple.id\" \\"
        echo "    --team-id \"$TEAM_ID\" \\"
        echo "    --password \"app-specific-password\""
        echo ""
        rm -f "$ZIP_PATH"
        return
    fi

    # Staple the notarization ticket to app
    echo "Stapling notarization ticket to app..."
    xcrun stapler staple "$APP_PATH"

    # Clean up zip
    rm -f "$ZIP_PATH"

    echo -e "${GREEN}✅ Notarization complete and stapled${NC}"
    echo ""
}

# Function to create installer package (PKG)
create_pkg() {
    echo "📦 Creating PKG installer..."

    # Create temp directory with renamed app for PKG
    PKG_TEMP="$BUILD_DIR/pkg-temp"
    rm -rf "$PKG_TEMP"
    mkdir -p "$PKG_TEMP"
    cp -R "$APP_PATH" "$PKG_TEMP/${FINAL_APP_NAME}.app"

    # Check if we have Developer ID Installer certificate
    if security find-identity -v -p basic | grep -q "Developer ID Installer"; then
        PKG_PATH="$DIST_DIR/${FINAL_APP_NAME}-${VERSION}.pkg"
        pkgbuild \
            --component "$PKG_TEMP/${FINAL_APP_NAME}.app" \
            --install-location "/Applications" \
            --sign "Developer ID Installer" \
            "$PKG_PATH"
        echo "PKG created (signed) at: $PKG_PATH"
    else
        PKG_PATH="$DIST_DIR/${FINAL_APP_NAME}-${VERSION}-unsigned.pkg"
        pkgbuild \
            --component "$PKG_TEMP/${FINAL_APP_NAME}.app" \
            --install-location "/Applications" \
            "$PKG_PATH"
        echo "PKG created (unsigned) at: $PKG_PATH"
        echo -e "${YELLOW}Note: PKG is unsigned. Get 'Developer ID Installer' certificate to sign PKGs.${NC}"
    fi

    rm -rf "$PKG_TEMP"

    echo -e "${GREEN}✅ PKG created${NC}"
    echo ""
}

# Main execution
main() {
    check_prerequisites
    build_typescript
    bundle_nodejs
    build_xcode
    verify_signing
    notarize       # Notarize and staple first
    create_dmg     # Then create DMG with stapled app
    create_pkg

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${GREEN}✅ Distribution build complete!${NC}"
    echo ""
    echo "Distribution files:"
    ls -lh "$DIST_DIR"
    echo ""
    echo "To test the app:"
    echo "  open '$APP_PATH'"
    echo ""
    echo "To install from DMG:"
    echo "  open '$DIST_DIR/${FINAL_APP_NAME}-${VERSION}.dmg'"
}

# Run
main
