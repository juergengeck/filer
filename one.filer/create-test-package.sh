#!/bin/bash
# Create a test .deb package for ONE Filer

echo "Creating test .deb package..."

# Create directory structure
mkdir -p test-package/DEBIAN
mkdir -p test-package/usr/local/bin

# Create control file
cat > test-package/DEBIAN/control << EOF
Package: one-leute-replicant
Version: 4.0.0-beta-1
Section: base
Priority: optional
Architecture: amd64
Maintainer: REFINIO GmbH
Description: ONE Filer Test Package
 This is a test package for ONE Filer installer testing.
EOF

# Create test executable
cat > test-package/usr/local/bin/one-filer << EOF
#!/bin/bash
echo "ONE Filer Test - Hello World!"
echo "Version: 4.0.0-beta-1"
echo "This is a test installation."
EOF

# Make executable
chmod +x test-package/usr/local/bin/one-filer

# Build package
dpkg-deb --build test-package one-leute-replicant_4.0.0-beta-1_amd64.deb

echo "Test package created: one-leute-replicant_4.0.0-beta-1_amd64.deb" 