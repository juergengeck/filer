@echo off
echo Automated Node.js Setup for WSL2 Debian...
echo.

echo Step 1: Updating package lists...
wsl -d Debian -- sudo apt update -y

echo Step 2: Installing curl and build tools...
wsl -d Debian -- sudo apt install -y curl build-essential

echo Step 3: Installing Node.js LTS...
wsl -d Debian -- bash -c "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
wsl -d Debian -- sudo apt-get install -y nodejs

echo Step 4: Verifying Node.js installation...
wsl -d Debian -- node --version
wsl -d Debian -- npm --version

echo Step 5: Installing project dependencies...
wsl -d Debian -- bash -c "cd /mnt/c/Users/juerg/source/one.filer && npm install"

echo Step 6: Installing one.leute.replicant dependencies...
wsl -d Debian -- bash -c "cd /mnt/c/Users/juerg/source/one.filer/one.leute.replicant && npm install"

echo.
echo ✅ Automated setup completed!
echo Running verification...
echo.

call scripts\verify-setup.cmd 