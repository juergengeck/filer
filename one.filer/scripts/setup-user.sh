#!/bin/bash
echo "Setting up user refinio..."

# Create user refinio
useradd -m -s /bin/bash refinio

# Set password
echo 'refinio:refinio' | chpasswd

# Add to sudo group
usermod -aG sudo refinio

# Enable passwordless sudo
echo 'refinio ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/refinio

echo "User refinio created successfully!" 