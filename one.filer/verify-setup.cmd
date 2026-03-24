@echo off
echo.
echo ========================================
echo   ONE.filer WSL2 Setup Verification
echo ========================================
echo.

echo [1/5] Checking WSL2 status...
wsl --list --verbose
if %errorlevel% neq 0 (
    echo ERROR: WSL2 not available
    goto :error
)
echo ✅ WSL2 is available
echo.

echo [2/5] Testing Debian access...
wsl -d Debian -- echo "WSL2 Debian is accessible"
if %errorlevel% neq 0 (
    echo ERROR: Cannot access Debian
    goto :error
)
echo ✅ Debian is accessible
echo.

echo [3/5] Checking Node.js in WSL2...
wsl -d Debian -- node --version
if %errorlevel% neq 0 (
    echo ⚠️  Node.js not installed - run manual setup
    goto :nodejs_missing
)
echo ✅ Node.js is installed
echo.

echo [4/5] Checking project access...
wsl -d Debian -- ls /mnt/c/Users/juerg/source/one.filer/package.json
if %errorlevel% neq 0 (
    echo ERROR: Cannot access project files
    goto :error
)
echo ✅ Project files accessible
echo.

echo [5/5] Testing ONE packages...
wsl -d Debian -- ls /mnt/c/Users/juerg/source/one.filer/one.leute.replicant/package.json
if %errorlevel% neq 0 (
    echo ERROR: ONE packages not found
    goto :error
)
echo ✅ ONE packages found
echo.

echo ========================================
echo   ✅ SETUP VERIFICATION SUCCESSFUL!
echo ========================================
echo.
echo Next steps:
echo 1. Follow MANUAL_SETUP.md to install Node.js (if needed)
echo 2. Install dependencies with npm install
echo 3. Configure and test one.leute.replicant
echo.
goto :end

:nodejs_missing
echo.
echo Node.js is not installed. Please:
echo 1. Run: wsl -d Debian
echo 2. Follow the Node.js installation steps in MANUAL_SETUP.md
echo.
goto :end

:error
echo.
echo ❌ Setup verification failed!
echo Please check MANUAL_SETUP.md for troubleshooting steps.
echo.

:end
pause 