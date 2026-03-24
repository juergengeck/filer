# ONE.filer WSL2 Setup Script
# This script sets up the WSL2 environment for running ONE packages

Write-Host "🚀 Setting up WSL2 environment for ONE packages..." -ForegroundColor Green

# Step 1: Verify WSL2 is running
Write-Host "📋 Checking WSL2 status..." -ForegroundColor Yellow
wsl --list --verbose

# Step 2: Access WSL2 and install Node.js
Write-Host "📦 Installing Node.js in WSL2 Debian..." -ForegroundColor Yellow
wsl -d Debian -- bash -c "
    echo '🔍 Checking current environment...'
    pwd
    whoami
    
    echo '📦 Updating package lists...'
    sudo apt update
    
    echo '🔧 Installing curl and build tools...'
    sudo apt install -y curl build-essential
    
    echo '📥 Installing Node.js LTS...'
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    echo '✅ Verifying installation...'
    node --version
    npm --version
    
    echo '📁 Checking project access...'
    ls -la /mnt/c/Users/juerg/source/one.filer/
"

# Step 3: Install dependencies in WSL2
Write-Host "📦 Installing ONE package dependencies in WSL2..." -ForegroundColor Yellow
wsl -d Debian -- bash -c "
    cd /mnt/c/Users/juerg/source/one.filer
    
    echo '📦 Installing one.leute.replicant dependencies...'
    cd one.leute.replicant
    npm install
    
    echo '📦 Installing one.filer dependencies...'
    cd ../
    npm install
    
    echo '✅ Setup complete!'
    echo '🎯 Next steps:'
    echo '  1. Configure one.leute.replicant for WSL2'
    echo '  2. Set up FUSE mount point'
    echo '  3. Test Windows Explorer integration'
"

Write-Host "✅ WSL2 setup script completed!" -ForegroundColor Green
Write-Host "💡 You can now run: wsl -d Debian" -ForegroundColor Cyan 