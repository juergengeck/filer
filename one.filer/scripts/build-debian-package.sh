#!/bin/bash
set -e

# Build script for ONE Leute Replicant Debian package
echo "🔨 Building ONE Leute Replicant Debian package..."

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "one.leute.replicant" ]; then
    echo "❌ Error: This script must be run from the one.filer project root"
    echo "   Expected files: package.json, one.leute.replicant/"
    exit 1
fi

# Check for required tools
if ! command -v dpkg-buildpackage &> /dev/null; then
    echo "❌ Error: dpkg-buildpackage not found. Install with:"
    echo "   sudo apt-get install dpkg-dev build-essential"
    exit 1
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf debian/one-leute-replicant
rm -f ../one-leute-replicant_*.deb
rm -f ../one-leute-replicant_*.changes
rm -f ../one-leute-replicant_*.buildinfo

# Make scripts executable
chmod +x debian/postinst
chmod +x debian/prerm
chmod +x debian/rules

# Ensure one.leute.replicant dependencies are built
echo "🔧 Preparing one.leute.replicant..."
cd one.leute.replicant

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing one.leute.replicant dependencies..."
    npm install
fi

# Build if needed
if [ ! -d "lib" ]; then
    echo "🔨 Building one.leute.replicant..."
    npm run build
fi

cd ..

# Build the Debian package
echo "📦 Building Debian package..."
dpkg-buildpackage -us -uc -b

# Check if package was created
if [ -f "../one-leute-replicant_4.0.0-beta-1_amd64.deb" ]; then
    echo "✅ Debian package built successfully!"
    echo "📁 Package location: ../one-leute-replicant_4.0.0-beta-1_amd64.deb"
    echo ""
    echo "📊 Package information:"
    dpkg-deb --info "../one-leute-replicant_4.0.0-beta-1_amd64.deb"
    echo ""
    echo "📋 Package contents:"
    dpkg-deb --contents "../one-leute-replicant_4.0.0-beta-1_amd64.deb" | head -20
    echo ""
    echo "🚀 To install the package:"
    echo "   sudo dpkg -i ../one-leute-replicant_4.0.0-beta-1_amd64.deb"
    echo "   sudo apt-get install -f  # Fix any dependency issues"
else
    echo "❌ Error: Package build failed"
    exit 1
fi 