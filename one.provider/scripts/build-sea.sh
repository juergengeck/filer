#!/bin/bash
#
# Build Node.js Single Executable Application (SEA) for sandboxed extension
#
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "🔨 Building Node.js SEA..."
echo ""

# Step 1: Ensure TypeScript is built
echo "📦 Building TypeScript..."
npm run build

# Step 2: Generate the blob
echo "📝 Generating SEA blob..."
node --experimental-sea-config sea-config.json

# Step 3: Copy node binary
echo "🔧 Copying Node.js binary..."
mkdir -p Resources/bin
cp $(which node) Resources/bin/node-sea
chmod +w Resources/bin/node-sea

# Step 4: Remove signature (required on macOS before injection)
echo "✂️  Removing code signature..."
codesign --remove-signature Resources/bin/node-sea

# Step 5: Inject the blob
echo "💉 Injecting application blob..."
npx postject Resources/bin/node-sea NODE_SEA_BLOB sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    --macho-segment-name NODE_SEA

# Step 6: Sign the binary (ad-hoc for development)
echo "🔏 Signing SEA binary..."
codesign --sign - Resources/bin/node-sea

# Step 7: Verify
echo ""
echo "✅ SEA binary created: Resources/bin/node-sea"
echo ""
echo "Verification:"
ls -lh Resources/bin/node-sea
echo ""
otool -L Resources/bin/node-sea | head -10
echo ""
echo "Testing SEA binary..."
echo '{"jsonrpc":"2.0","id":1,"method":"test"}' | Resources/bin/node-sea 2>&1 | head -5 || echo "(Expected: IPC server should start)"
