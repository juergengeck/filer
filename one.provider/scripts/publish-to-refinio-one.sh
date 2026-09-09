#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILER_WORKSPACE_ROOT="$(cd "$PROJECT_DIR/.." && pwd)"
REFINIO_WORKSPACE_ROOT="${REFINIO_WORKSPACE_ROOT:-$(cd "$FILER_WORKSPACE_ROOT/../refinio" && pwd)}"
PUBLISH_SCRIPT="$REFINIO_WORKSPACE_ROOT/packages/refinio.one/scripts/deploy-filer-downloads.sh"
VERSION="${VERSION:-$(node -p "require('$PROJECT_DIR/package.json').version")}"
MAC_FILE="${MAC_FILE:-$PROJECT_DIR/dist/OneFiler-${VERSION}.dmg}"

if [[ ! -x "$PUBLISH_SCRIPT" ]]; then
  echo "Missing refinio.one OneFiler publisher: $PUBLISH_SCRIPT" >&2
  exit 1
fi
if [[ ! -f "$MAC_FILE" ]]; then
  echo "Missing signed OneFiler disk image: $MAC_FILE" >&2
  exit 1
fi

exec "$PUBLISH_SCRIPT" \
  --version "$VERSION" \
  --mac-file "$MAC_FILE" \
  --mac-arch universal \
  "$@"
