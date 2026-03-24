@echo off
echo Fixing Debian repository sources...
echo.

echo Updating sources.list to use current Debian repositories...
wsl -d Debian -- sudo bash -c "cat > /etc/apt/sources.list << 'EOF'
deb http://deb.debian.org/debian bullseye main
deb-src http://deb.debian.org/debian bullseye main

deb http://security.debian.org/debian-security bullseye-security main
deb-src http://security.debian.org/debian-security bullseye-security main

deb http://deb.debian.org/debian bullseye-updates main
deb-src http://deb.debian.org/debian bullseye-updates main
EOF"

echo Testing repository update...
wsl -d Debian -- sudo apt update

if %errorlevel% equ 0 (
    echo ✅ Repository sources fixed successfully!
    echo.
    echo Now installing Node.js...
    
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
    echo ❌ Could not update repositories.
    echo The Debian installation may need to be updated or reinstalled.
)

echo.
pause 