#!/bin/bash
echo "Fixing Debian sources and installing Node.js..."

# Backup original sources
sudo cp /etc/apt/sources.list /etc/apt/sources.list.backup

# Update sources to use current Debian repositories
sudo tee /etc/apt/sources.list > /dev/null <<EOF
deb http://deb.debian.org/debian bullseye main
deb-src http://deb.debian.org/debian bullseye main

deb http://security.debian.org/debian-security bullseye-security main
deb-src http://security.debian.org/debian-security bullseye-security main

deb http://deb.debian.org/debian bullseye-updates main
deb-src http://deb.debian.org/debian bullseye-updates main
EOF

echo "Updated sources.list to use Debian Bullseye"

# Update package lists
echo "Updating package lists..."
sudo apt update

if [ $? -eq 0 ]; then
    echo "✅ Repository update successful!"
    
    # Install curl and build tools
    echo "Installing curl and build tools..."
    sudo apt install -y curl build-essential
    
    # Install Node.js
    echo "Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    # Verify installation
    echo "Verifying installation..."
    echo "Node.js version: $(node --version)"
    echo "NPM version: $(npm --version)"
    
    echo "✅ Node.js installation completed!"
else
    echo "❌ Repository update failed. The WSL2 Debian installation may need to be updated."
    echo "You might need to install a newer Debian distribution."
fi 