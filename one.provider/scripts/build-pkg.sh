#!/bin/bash
#
# Build standalone Node.js binary using pkg
#
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "📦 Building standalone Node.js binary with pkg..."
echo ""

# Step 1: Ensure TypeScript is built
echo "🔨 Building TypeScript..."
npm run build

# Step 2: Create a wrapper entry point for pkg
echo "📝 Creating pkg entry point..."
cat > node-runtime/lib/pkg-entry.js << 'EOF'
#!/usr/bin/env node
// pkg entry point - this file is compatible with pkg
import('./index.js').catch(err => {
    console.error('Failed to load IPC server:', err);
    process.exit(1);
});
EOF

# Step 3: Build with pkg
echo "📦 Running pkg..."
mkdir -p Resources/bin
npx pkg node-runtime/lib/pkg-entry.js \
    --target node20-macos-arm64 \
    --output Resources/bin/node-ipc \
    --compress Brotli

# Step 4: Verify
echo ""
echo "✅ Standalone binary created: Resources/bin/node-ipc"
echo ""
echo "Verification:"
ls -lh Resources/bin/node-ipc
echo ""
echo "Dependencies:"
otool -L Resources/bin/node-ipc | head -15
echo ""
echo "Testing..."
echo '{"jsonrpc":"2.0","id":1,"method":"test"}' | Resources/bin/node-ipc 2>&1 | head -5 || echo "(IPC server should start)"
