#!/usr/bin/env bash
# Explicit local installation; leaves existing domains and ONE storage intact.
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
npm run prepare:runtime
xcodegen generate
xcodebuild -project OneFiler.xcodeproj -scheme OneFilerHost -configuration Debug \
  -derivedDataPath build/install build
APP_PATH="$PROJECT_DIR/build/install/Build/Products/Debug/OneFilerHost.app"
# Quit OneFiler normally before replacing its bundle so ONE storage closes cleanly.
if pgrep -x OneFilerHost >/dev/null; then
  echo "Quit OneFiler before installing this build." >&2
  exit 1
fi
DESTINATION="${FILER_INSTALL_PATH:-/Applications/OneFiler.app}"
case "$DESTINATION" in /*.app) ;; *) echo "FILER_INSTALL_PATH must be an absolute .app path" >&2; exit 1 ;; esac
rm -rf "$DESTINATION"
ditto "$APP_PATH" "$DESTINATION"
open "$DESTINATION"
echo "Installed $DESTINATION. Register domains from its menu; legacy configurations require explicit migration."
