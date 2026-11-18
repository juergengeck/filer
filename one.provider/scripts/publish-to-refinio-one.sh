#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILER_WORKSPACE_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
REFINIO_WORKSPACE_ROOT="${REFINIO_WORKSPACE_ROOT:-$(cd "$FILER_WORKSPACE_ROOT/../refinio" && pwd)}"
PUBLISH_SCRIPT="$REFINIO_WORKSPACE_ROOT/packages/refinio.one/scripts/deploy-filer-downloads.sh"
VERSION="${VERSION:-$(node -p "require('$PROJECT_DIR/package.json').version")}"
MAC_FILE="${MAC_FILE:-$PROJECT_DIR/dist/OneFiler-${VERSION}.dmg}"

# Keep the artifact that is verified below identical to the published input.
for argument in "$@"; do
  case "$argument" in
    --version|--mac-file|--mac-arch)
      echo 'Set VERSION or MAC_FILE in the environment; the macOS architecture is validated as universal' >&2
      exit 1
      ;;
  esac
done

if [[ ! -x "$PUBLISH_SCRIPT" ]]; then
  echo "Missing refinio.one OneFiler publisher: $PUBLISH_SCRIPT" >&2
  exit 1
fi
if [[ ! -f "$MAC_FILE" ]]; then
  echo "Missing signed OneFiler disk image: $MAC_FILE" >&2
  exit 1
fi

MOUNT_DIR="$(mktemp -d)"
cleanup() {
  hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR"
}
trap cleanup EXIT
hdiutil attach "$MAC_FILE" -readonly -nobrowse -mountpoint "$MOUNT_DIR" >/dev/null
python3 "$PROJECT_DIR/scripts/verify-macos-runtime.py" "$MOUNT_DIR/OneFiler.app"
codesign --verify --deep --strict "$MOUNT_DIR/OneFiler.app"
ARTIFACT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MOUNT_DIR/OneFiler.app/Contents/Info.plist")"
if [[ "$ARTIFACT_VERSION" != "$VERSION" ]]; then
  echo "Disk image version $ARTIFACT_VERSION does not match requested release $VERSION" >&2
  exit 1
fi
xcrun stapler validate "$MAC_FILE"

"$PUBLISH_SCRIPT" \
  --version "$VERSION" \
  --mac-file "$MAC_FILE" \
  --mac-arch universal \
  "$@"
