#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

TEAM_ID="${TEAM_ID:-26W8AC52QS}"
DEVELOPER_ID="${DEVELOPER_ID:-Developer ID Application: Refinio GmbH (26W8AC52QS)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-OneFiler Notarization}"
if [[ -z "${NOTARYTOOL:-}" ]]; then
  if [[ -x /Library/Developer/CommandLineTools/usr/bin/notarytool ]]; then
    NOTARYTOOL=/Library/Developer/CommandLineTools/usr/bin/notarytool
  else
    NOTARYTOOL="$(xcrun -f notarytool)"
  fi
fi
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
BUILD_DIR="$PROJECT_DIR/build/distribution"
ARCHIVE_PATH="$BUILD_DIR/OneFiler.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
DIST_DIR="$PROJECT_DIR/dist"
APP_PATH=""
DMG_PATH="$DIST_DIR/OneFiler-${VERSION}.dmg"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

check_prerequisites() {
  for command in codesign hdiutil npm security spctl xcodebuild xcodegen xcrun; do
    require_command "$command"
  done

  local identities
  identities="$(security find-identity -v -p codesigning)"
  if [[ "$identities" != *"$DEVELOPER_ID"* ]]; then
    echo "Developer ID Application identity is unavailable: $DEVELOPER_ID" >&2
    exit 1
  fi

  "$NOTARYTOOL" history --keychain-profile "$NOTARY_PROFILE" >/dev/null
}

build_archive() {
  npm ci
  npm run prepare:runtime
  xcodegen generate

  rm -rf "$BUILD_DIR"
  mkdir -p "$BUILD_DIR" "$DIST_DIR"

  xcodebuild \
    -project OneFiler.xcodeproj \
    -scheme OneFilerHost \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    ENABLE_HARDENED_RUNTIME=YES \
    REGISTER_APP_GROUPS=YES \
    clean archive

  xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist Resources/DeveloperIDExportOptions.plist \
    -allowProvisioningUpdates

  APP_PATH="$(find "$EXPORT_DIR" -maxdepth 2 -type d -name 'OneFilerHost.app' -print -quit)"
  if [[ -z "$APP_PATH" ]]; then
    echo "Xcode did not export OneFilerHost.app" >&2
    exit 1
  fi
}

sign_exported_app() {
  local host_executable="$APP_PATH/Contents/MacOS/OneFilerHost"
  local extension_path="$APP_PATH/Contents/PlugIns/OneFilerExtension.appex"
  local extension_executable="$extension_path/Contents/MacOS/OneFilerExtension"

  while IFS= read -r -d '' file_path; do
    # The bundle signatures live on their primary executables. Signing these
    # as bare Mach-O files would discard Xcode's provisioned entitlements.
    if [[ "$file_path" == "$host_executable" || "$file_path" == "$extension_executable" ]]; then
      continue
    fi
    if file "$file_path" | grep -q 'Mach-O'; then
      codesign \
        --force \
        --sign "$DEVELOPER_ID" \
        --timestamp \
        --options runtime \
        --preserve-metadata=entitlements \
        "$file_path"
    fi
  done < <(find "$APP_PATH" -type f \( -name '*.dylib' -o -perm -111 \) -print0)

  codesign \
    --force \
    --sign "$DEVELOPER_ID" \
    --timestamp \
    --options runtime \
    --preserve-metadata=identifier,entitlements,requirements \
    "$extension_path"

  codesign \
    --force \
    --sign "$DEVELOPER_ID" \
    --timestamp \
    --options runtime \
    --preserve-metadata=identifier,entitlements,requirements \
    "$APP_PATH"
}

verify_app_group_profile() {
  local bundle_path="$1"
  local profile_path="$bundle_path/Contents/embedded.provisionprofile"
  local decoded_profile
  local signature_entitlements
  local profile_details
  local signature_details
  decoded_profile="$(mktemp)"
  signature_entitlements="$(mktemp)"

  if [[ ! -f "$profile_path" ]]; then
    echo "Missing Developer ID provisioning profile in $bundle_path" >&2
    rm -f "$decoded_profile" "$signature_entitlements"
    exit 1
  fi

  security cms -D -i "$profile_path" >"$decoded_profile"
  codesign -d --entitlements "$signature_entitlements" --xml "$bundle_path" 2>/dev/null
  profile_details="$(plutil -p "$decoded_profile")"
  signature_details="$(plutil -p "$signature_entitlements")"

  if [[ "$profile_details" != *'group.one.filer'* ]]; then
    echo "The provisioning profile for $bundle_path does not authorize group.one.filer" >&2
    rm -f "$decoded_profile" "$signature_entitlements"
    exit 1
  fi
  if [[ "$signature_details" != *'com.apple.application-identifier'* ]]; then
    echo "The signature for $bundle_path has no com.apple.application-identifier" >&2
    rm -f "$decoded_profile" "$signature_entitlements"
    exit 1
  fi

  rm -f "$decoded_profile" "$signature_entitlements"
}

verify_exported_app() {
  local extension_path="$APP_PATH/Contents/PlugIns/OneFilerExtension.appex"
  local signing_details
  codesign --verify --deep --strict --verbose=4 "$APP_PATH"
  signing_details="$(codesign -dvv "$APP_PATH" 2>&1)"

  if [[ "$signing_details" != *"Authority=$DEVELOPER_ID"* ]]; then
    echo "The host app is not signed with $DEVELOPER_ID" >&2
    exit 1
  fi
  if [[ "$signing_details" != *'flags=0x10000(runtime)'* ]]; then
    echo "The host app does not have hardened runtime enabled" >&2
    exit 1
  fi

  verify_app_group_profile "$APP_PATH"
  verify_app_group_profile "$extension_path"
}

notarize_app() {
  local zip_path="$BUILD_DIR/OneFiler-${VERSION}.zip"
  local zip_root="$BUILD_DIR/notary-app"
  rm -rf "$zip_root" "$zip_path"
  mkdir -p "$zip_root"
  ditto "$APP_PATH" "$zip_root/OneFiler.app"
  ditto -c -k --keepParent "$zip_root/OneFiler.app" "$zip_path"

  "$NOTARYTOOL" submit "$zip_path" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait
  xcrun stapler staple "$APP_PATH"
  xcrun stapler validate "$APP_PATH"
  spctl --assess --type execute --verbose=4 "$APP_PATH"
}

create_dmg() {
  local dmg_root="$BUILD_DIR/dmg-root"
  rm -rf "$dmg_root" "$DMG_PATH"
  mkdir -p "$dmg_root"
  ditto "$APP_PATH" "$dmg_root/OneFiler.app"
  ln -s /Applications "$dmg_root/Applications"

  hdiutil create \
    -volname OneFiler \
    -srcfolder "$dmg_root" \
    -format UDZO \
    -ov \
    "$DMG_PATH"

  codesign \
    --force \
    --sign "$DEVELOPER_ID" \
    --timestamp \
    "$DMG_PATH"
  codesign --verify --verbose=4 "$DMG_PATH"
}

notarize_dmg() {
  "$NOTARYTOOL" submit "$DMG_PATH" \
    --keychain-profile "$NOTARY_PROFILE" \
    --wait
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
  spctl --assess \
    --type open \
    --context context:primary-signature \
    --verbose=4 \
    "$DMG_PATH"
}

main() {
  check_prerequisites
  build_archive
  sign_exported_app
  verify_exported_app
  notarize_app
  create_dmg
  notarize_dmg

  echo "Signed OneFiler release ready: $DMG_PATH"
}

main "$@"
