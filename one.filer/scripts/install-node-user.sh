#!/bin/bash
echo "Installing Node.js to user directory..."

# Create local bin directory
mkdir -p ~/.local/bin
export PATH=~/.local/bin:$PATH

# Check if Node.js is already installed
if command -v node &> /dev/null; then
    echo "Node.js already installed:"
    node --version
    npm --version
    exit 0
fi

echo "Downloading Node.js LTS..."
cd /tmp

# Download Node.js binary
wget -q https://nodejs.org/dist/v18.18.0/node-v18.18.0-linux-x64.tar.xz

if [ $? -eq 0 ]; then
    echo "Extracting Node.js..."
    tar -xf node-v18.18.0-linux-x64.tar.xz
    
    echo "Installing to ~/.local/..."
    cp -r node-v18.18.0-linux-x64/* ~/.local/
    
    # Add to PATH permanently
    echo 'export PATH=~/.local/bin:$PATH' >> ~/.bashrc
    
    echo "Node.js installed successfully!"
    echo "Version: $(~/.local/bin/node --version)"
    echo "NPM Version: $(~/.local/bin/npm --version)"
    
    # Clean up
    rm -rf node-v18.18.0-linux-x64*
else
    echo "Failed to download Node.js"
    exit 1
fi 