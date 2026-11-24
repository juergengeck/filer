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
# Register the installed bundle: Xcode or a moved backup may otherwise remain
# the selected File Provider extension, causing enumerator signals to fail.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
TARGET_EXT="$DESTINATION/Contents/PlugIns/OneFilerExtension.appex"
"$LSREGISTER" -u "$APP_PATH" || true
while IFS= read -r stale_ext; do
  [ -z "$stale_ext" ] && continue
  [ "$stale_ext" = "$TARGET_EXT" ] && continue
  pluginkit -r "$stale_ext" >/dev/null 2>&1 || true
  "$LSREGISTER" -u "${stale_ext%/Contents/PlugIns/OneFilerExtension.appex}" >/dev/null 2>&1 || true
done < <(pluginkit -m -A -D -vvv -i one.filer.extension 2>/dev/null | sed -n 's/^[[:space:]]*Path = //p')
"$LSREGISTER" -f -R -trusted "$DESTINATION"
pluginkit -a "$TARGET_EXT"
pluginkit -e use -i one.filer.extension
open "$DESTINATION"
echo "Installed $DESTINATION. Register domains from its menu; legacy configurations require explicit migration."
