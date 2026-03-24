@echo off
echo Installing Node.js on Fresh Debian
echo ====================================
echo.

echo Step 1: Updating package lists...
wsl -d Debian -u refinio -- sudo apt update

echo Step 2: Installing curl and build tools...
wsl -d Debian -u refinio -- sudo apt install -y curl build-essential

echo Step 3: Installing Node.js LTS...
wsl -d Debian -u refinio -- bash -c "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
wsl -d Debian -u refinio -- sudo apt-get install -y nodejs

echo Step 4: Verifying installation...
wsl -d Debian -u refinio -- node --version
wsl -d Debian -u refinio -- npm --version

echo Step 5: Installing project dependencies...
wsl -d Debian -u refinio -- bash -c "cd /mnt/c/Users/juerg/source/one.filer && npm install"

echo Step 6: Installing one.leute.replicant dependencies...
wsl -d Debian -u refinio -- bash -c "cd /mnt/c/Users/juerg/source/one.filer/one.leute.replicant && npm install"

echo.
echo ✅ Fresh Node.js installation completed!
echo.
echo Running final verification...
call scripts\verify-setup.cmd 