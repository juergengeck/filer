@echo off
echo Configuring WSL2 user and installing Node.js...
echo.

echo Step 1: Setting up WSL2 user configuration...
echo This will configure the WSL2 user to work without password prompts.
echo.

echo Method 1: Try to configure passwordless sudo via root...
wsl -d Debian -u root -- bash -c "echo 'gecko ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers.d/gecko"

echo Method 2: Add user to sudo group...
wsl -d Debian -u root -- usermod -aG sudo gecko

echo Method 3: Test sudo access...
wsl -d Debian -- sudo whoami

if %errorlevel% equ 0 (
    echo ✅ Sudo access configured successfully!
    echo.
    echo Now installing Node.js...
    
    wsl -d Debian -- sudo apt update
    wsl -d Debian -- sudo apt install -y curl build-essential
    wsl -d Debian -- bash -c "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    wsl -d Debian -- sudo apt-get install -y nodejs
    
    echo.
    echo Verifying installation...
    wsl -d Debian -- node --version
    wsl -d Debian -- npm --version
    
    echo.
    echo ✅ Node.js installation completed!
) else (
    echo ❌ Could not configure sudo access.
    echo Please try running WSL as administrator or set a password for the user.
)

echo.
pause 