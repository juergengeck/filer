# Distribution Guide

This guide covers how to create a signed, notarized package of OneFiler for distribution to users.

## Prerequisites

### 1. Apple Developer Account

You need a **paid Apple Developer Program membership** ($99/year):
- Sign up at https://developer.apple.com/programs/
- Required for:
  - Developer ID certificates
  - App notarization
  - App Group entitlements

### 2. Developer ID Application Certificate

1. **Create certificate request:**
   ```bash
   # Open Keychain Access
   # Menu: Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority
   # - Enter email and name
   # - Select "Saved to disk"
   # - Save as: CertificateSigningRequest.certSigningRequest
   ```

2. **Get certificate from Apple:**
   - Go to https://developer.apple.com/account/resources/certificates
   - Click "+" to create new certificate
   - Select "Developer ID Application" (for distribution outside Mac App Store)
   - Upload your CSR file
   - Download the certificate (developerID_application.cer)

3. **Install certificate:**
   ```bash
   # Double-click the downloaded certificate to install in Keychain
   # Or use command line:
   security import developerID_application.cer -k ~/Library/Keychains/login.keychain-db
   ```

4. **Verify installation:**
   ```bash
   security find-identity -v -p codesigning

   # Should show something like:
   # 1) ABCDEF1234... "Developer ID Application: Your Name (TEAM_ID)"
   ```

### 3. App-Specific Password for Notarization

Apple requires 2FA accounts to use app-specific passwords for notarization:

1. **Generate app-specific password:**
   - Go to https://appleid.apple.com/
   - Sign in with your Apple ID
   - In "Security" section, click "App-Specific Passwords"
   - Click "+" to generate new password
   - Label it "OneFiler Notarization"
   - Save the generated password (you won't see it again)

2. **Store credentials securely:**
   ```bash
   # Option A: Store in keychain (recommended)
   xcrun notarytool store-credentials "onefiler-notarization" \
     --apple-id "your@apple.id" \
     --team-id "26W8AC52QS" \
     --password "xxxx-xxxx-xxxx-xxxx"

   # Option B: Use environment variables
   export NOTARIZATION_APPLE_ID="your@apple.id"
   export NOTARIZATION_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   ```

### 4. Required Tools

```bash
# Install XcodeGen (if not already installed)
brew install xcodegen

# Install create-dmg (optional, for custom DMG)
brew install create-dmg

# Verify all tools are available
which xcodebuild  # Should be installed with Xcode
which codesign    # Part of Xcode Command Line Tools
which npm         # Node.js package manager
```

## Building for Distribution

### Quick Build (Automated)

The simplest way to create a distribution build:

```bash
# Set up credentials (one time)
export NOTARIZATION_APPLE_ID="your@apple.id"
export NOTARIZATION_PASSWORD="xxxx-xxxx-xxxx-xxxx"

# Build and sign
./scripts/build-distribution.sh
```

This script:
1. ✅ Builds TypeScript IPC server
2. ✅ Bundles Node.js runtime with ICU libraries
3. ✅ Generates Xcode project
4. ✅ Builds Release configuration
5. ✅ Signs with Developer ID certificate
6. ✅ Enables Hardened Runtime
7. ✅ Verifies code signature
8. ✅ Creates DMG installer
9. ✅ Notarizes with Apple
10. ✅ Staples notarization ticket
11. ✅ Creates PKG installer

**Output:**
- `dist/OneFiler-1.0.0.dmg` - Disk image for drag-and-drop install
- `dist/OneFiler-1.0.0.pkg` - Package installer

### Manual Build Steps

If you need more control over the process:

#### 1. Build TypeScript

```bash
npm install
npm run build
```

#### 2. Bundle Node.js

```bash
./scripts/bundle-node.sh
```

#### 3. Build with Xcode

```bash
# Regenerate project
xcodegen generate

# Build for Release with proper signing
xcodebuild \
  -project OneFiler.xcodeproj \
  -scheme OneFilerHost \
  -configuration Release \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="Developer ID Application" \
  DEVELOPMENT_TEAM="26W8AC52QS" \
  ENABLE_HARDENED_RUNTIME=YES \
  OTHER_CODE_SIGN_FLAGS="--timestamp --options runtime" \
  clean build
```

#### 4. Verify Signature

```bash
# Find the built app
APP_PATH=$(find build -name "OneFiler.app" -type d | head -1)

# Verify code signature
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

# Check signature details
codesign -dvv "$APP_PATH"

# Verify extension
codesign --verify --deep --strict --verbose=2 \
  "$APP_PATH/Contents/PlugIns/OneFilerExtension.appex"
```

#### 5. Create DMG

```bash
mkdir -p dist

# Create temporary directory
mkdir -p build/dmg-temp
cp -R "$APP_PATH" build/dmg-temp/
ln -s /Applications build/dmg-temp/Applications

# Create DMG
hdiutil create \
  -volname "OneFiler" \
  -srcfolder build/dmg-temp \
  -ov \
  -format UDZO \
  dist/OneFiler-1.0.0.dmg

# Clean up
rm -rf build/dmg-temp
```

#### 6. Notarize

```bash
# Create zip for notarization
ditto -c -k --keepParent "$APP_PATH" build/OneFiler.zip

# Submit for notarization (using stored credentials)
xcrun notarytool submit build/OneFiler.zip \
  --keychain-profile "onefiler-notarization" \
  --wait

# Or with environment variables
xcrun notarytool submit build/OneFiler.zip \
  --apple-id "$NOTARIZATION_APPLE_ID" \
  --password "$NOTARIZATION_PASSWORD" \
  --team-id "26W8AC52QS" \
  --wait

# Staple notarization ticket to app
xcrun stapler staple "$APP_PATH"

# Staple to DMG
xcrun stapler staple dist/OneFiler-1.0.0.dmg
```

#### 7. Create PKG Installer

```bash
pkgbuild \
  --component "$APP_PATH" \
  --install-location "/Applications" \
  --sign "Developer ID Application" \
  dist/OneFiler-1.0.0.pkg
```

## Testing Distribution Build

### Local Testing

```bash
# Verify Gatekeeper will accept it
spctl --assess --type execute --verbose=4 "$APP_PATH"

# Should output:
# .../OneFiler.app: accepted
# source=Developer ID

# Test the DMG
open dist/OneFiler-1.0.0.dmg
# Drag app to Applications and try to open

# Test the PKG
sudo installer -pkg dist/OneFiler-1.0.0.pkg -target /
```

### Test on Clean Machine

The real test is installing on a machine that has never seen your development builds:

1. Copy DMG or PKG to a clean Mac (or VM)
2. Double-click to install
3. System should NOT show any security warnings
4. App should launch without "unidentified developer" alerts
5. Try registering a domain and accessing files

## Troubleshooting

### "Developer ID Application certificate not found"

**Problem:** Distribution script can't find signing certificate.

**Solution:**
```bash
# List all code signing identities
security find-identity -v -p codesigning

# If you see "Apple Development" but not "Developer ID Application":
# - You need to create a Developer ID certificate (see Prerequisites)
# - Or your certificate expired (create new one)
```

### "Cannot find package '@refinio/one.core'"

**Problem:** Node.js modules not bundled correctly.

**Solution:**
```bash
# Refresh the node-runtime dependencies
npm run prepare:deps

# Verify node_modules exists (not node_modules_resolved)
ls -la node-runtime/node_modules/@refinio/
```

### Notarization Fails

**Problem:** Apple rejects the notarization submission.

**Common causes:**

1. **Unsigned binaries in bundle:**
   ```bash
   # Check what's unsigned
   codesign --verify --deep --strict --verbose=2 OneFiler.app 2>&1 | grep -i unsigned

   # Sign everything before app bundle
   find OneFiler.app -type f -perm +111 -exec codesign -s "Developer ID Application" --force --timestamp --options runtime {} \;
   ```

2. **Hardened Runtime not enabled:**
   ```bash
   # Verify hardened runtime
   codesign -dvv OneFiler.app | grep flags
   # Should show: flags=0x10000(runtime)

   # Rebuild with hardened runtime:
   # Add to xcodebuild: ENABLE_HARDENED_RUNTIME=YES
   ```

3. **Missing entitlements:**
   - Check Resources/OneFiler.entitlements
   - Check Resources/Extension.entitlements
   - App Group must be registered in Apple Developer portal

### "App is damaged and can't be opened"

**Problem:** Gatekeeper quarantine issue.

**Solution:**
```bash
# Check quarantine attributes
xattr -l OneFiler.app

# Remove quarantine (for testing only!)
xattr -d com.apple.quarantine OneFiler.app

# For distribution, must notarize properly
```

### DMG Won't Mount on Other Machines

**Problem:** DMG created incorrectly or not notarized.

**Solution:**
```bash
# Verify DMG format
hdiutil verify dist/OneFiler-1.0.0.dmg

# Check if notarization ticket is stapled
stapler validate dist/OneFiler-1.0.0.dmg

# If not stapled, staple it:
xcrun stapler staple dist/OneFiler-1.0.0.dmg
```

## Configuration

### Update Version Number

Edit `scripts/build-distribution.sh`:
```bash
VERSION="${VERSION:-1.0.0}"  # Change this
```

Or pass as environment variable:
```bash
VERSION=1.1.0 ./scripts/build-distribution.sh
```

### Custom Developer ID

If you have multiple certificates:
```bash
DEVELOPER_ID="Developer ID Application: Company Name (TEAM_ID)" \
  ./scripts/build-distribution.sh
```

### Skip Notarization (for testing)

```bash
# Don't set NOTARIZATION_APPLE_ID
unset NOTARIZATION_APPLE_ID
./scripts/build-distribution.sh
# Will skip notarization step
```

## Distribution Checklist

Before releasing to users:

- [ ] Version number updated in build script
- [ ] Developer ID Application certificate installed and valid
- [ ] App Group registered in Apple Developer portal
- [ ] Notarization credentials configured
- [ ] Full build completes without errors: `./scripts/build-distribution.sh`
- [ ] Code signature verified: `codesign --verify --deep --strict OneFiler.app`
- [ ] Gatekeeper accepts: `spctl --assess --type execute OneFiler.app`
- [ ] Notarization ticket stapled: `stapler validate dist/OneFiler-1.0.0.dmg`
- [ ] Tested on clean machine (not development Mac)
- [ ] App launches without security warnings
- [ ] File Provider extension loads and registers domains
- [ ] Filesystem operations work correctly
- [ ] DMG/PKG installer works correctly

## Security Considerations

### Code Signing Best Practices

1. **Protect your certificates:**
   - Never commit certificates to git
   - Store in secure keychain
   - Rotate certificates before expiration

2. **Sign everything:**
   - All executables must be signed
   - Bundled Node.js binary must be signed
   - CLI tool must be signed
   - Extension must be signed

3. **Enable Hardened Runtime:**
   - Required for notarization
   - Provides security hardening
   - Already enabled in build script

### Notarization

Notarization is required for:
- Distribution outside Mac App Store
- macOS 10.15 Catalina and later
- Apps that users download from the internet

Without notarization:
- Users see "unidentified developer" warning
- App may not launch at all on newer macOS
- Extension may not load

## References

- **Apple Developer Documentation:**
  - [Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/)
  - [Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
  - [Distributing Your App Outside the Mac App Store](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)

- **Tools Documentation:**
  - `man codesign` - Code signing utility
  - `man notarytool` - Notarization tool
  - `man pkgbuild` - Package creation utility
  - `man hdiutil` - Disk image utility

- **OneFiler Documentation:**
  - CLAUDE.md - Development guide
  - README.md - Project overview
  - specs/001-apple-file-provider/ - Feature specifications
