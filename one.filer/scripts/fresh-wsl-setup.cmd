@echo off
echo Fresh WSL2 Debian Setup for ONE.filer
echo ========================================
echo.

echo Step 1: Removing old Debian installation...
wsl --unregister Debian
echo ✅ Old Debian installation removed
echo.

echo Step 2: Installing fresh Debian...
wsl --install -d Debian --no-launch
echo ✅ Fresh Debian installation completed
echo.

echo Step 3: Setting up user refinio...
call scripts\setup-debian-user.cmd

echo Step 4: Now installing Node.js...
call scripts\install-nodejs-fresh.cmd 