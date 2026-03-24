#!/bin/bash
#
# Bundle official Node.js binary (no external dependencies)
#
set -e

NODE_VERSION="v20.11.0"
NODE_ARCH="darwin-arm64"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_ARCH}.tar.gz"
NODE_TARBALL="/tmp/node-official.tar.gz"
NODE_EXTRACTED="/tmp/node-${NODE_VERSION}-${NODE_ARCH}"
NODE_BIN="${NODE_EXTRACTED}/bin/node"

DEST_DIR="Resources/bin"

echo "📦 Bundling official Node.js binary..."

# Download if not cached
if [ ! -f "$NODE_BIN" ]; then
    echo "   Downloading Node.js ${NODE_VERSION}..."
    curl -L "$NODE_URL" -o "$NODE_TARBALL"
    echo "   Extracting..."
    cd /tmp && tar -xzf "$NODE_TARBALL"
else
    echo "   Using cached Node.js binary"
fi

# Verify it's the official binary (only system dependencies)
echo "   Verifying dependencies..."
DEPS=$(otool -L "$NODE_BIN" | grep -v ":" | awk '{print $1}' | grep -E '^/')
NON_SYSTEM=$(echo "$DEPS" | grep -v -E '^/(System|usr)/' || true)
if [ -n "$NON_SYSTEM" ]; then
    echo "   ⚠️  Warning: Non-system dependencies found:"
    echo "$NON_SYSTEM"
fi

# Clean and create directory
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

# Copy node binary
echo "   Copying node binary..."
cp "$NODE_BIN" "$DEST_DIR/node"
chmod +x "$DEST_DIR/node"

# Re-sign (ad-hoc signature)
echo "   Re-signing binary..."
codesign --force --sign - "$DEST_DIR/node" 2>&1 | grep -v "replacing existing signature" || true

echo ""
echo "✅ Node.js bundle complete!"
echo ""
echo "   Binary: $DEST_DIR/node ($(du -h "$DEST_DIR/node" | awk '{print $1}'))"
echo "   Version: $("$DEST_DIR/node" --version)"
echo ""
echo "Dependencies:"
otool -L "$DEST_DIR/node"
