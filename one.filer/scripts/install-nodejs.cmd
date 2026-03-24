@echo off
echo Installing Node.js in WSL2 Debian...
echo.
echo Please run these commands in WSL2 Debian:
echo.
echo 1. First, access WSL2:
echo    wsl -d Debian
echo.
echo 2. Update package lists:
echo    sudo apt update
echo.
echo 3. Install curl and build tools:
echo    sudo apt install -y curl build-essential
echo.
echo 4. Install Node.js LTS:
echo    curl -fsSL https://deb.nodesource.com/setup_lts.x ^| sudo -E bash -
echo    sudo apt-get install -y nodejs
echo.
echo 5. Verify installation:
echo    node --version
echo    npm --version
echo.
echo 6. Navigate to project and install dependencies:
echo    cd /mnt/c/Users/juerg/source/one.filer
echo    npm install
echo.
echo 7. Install one.leute.replicant dependencies:
echo    cd one.leute.replicant
echo    npm install
echo.
echo After completing these steps, run verify-setup.cmd again.
echo.
pause 