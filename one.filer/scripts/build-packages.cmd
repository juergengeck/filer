@echo off
echo 🔨 ONE Filer Package Builder
echo ============================
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ❌ Error: This script must be run from the one.filer project root
    echo    Expected file: package.json
    pause
    exit /b 1
)

if not exist "one.leute.replicant" (
    echo ❌ Error: one.leute.replicant directory not found
    echo    Expected directory: one.leute.replicant/
    pause
    exit /b 1
)

echo 📦 Preparing ONE Filer packages for distribution...
echo.
echo ℹ️  Note: one.leute.replicant will be built in WSL2 during deployment
echo    (fuse-native requires Linux environment and cannot be built on Windows)
echo.

REM Create output directory
if not exist "dist" mkdir dist
if not exist "dist\debian" mkdir dist\debian
if not exist "dist\windows" mkdir dist\windows

echo 📁 Copying Debian package files...
xcopy /E /I /Y debian dist\debian\debian
xcopy /E /I /Y one.leute.replicant dist\debian\one.leute.replicant
xcopy /E /I /Y one.core dist\debian\one.core
xcopy /E /I /Y one.models dist\debian\one.models

REM Create windows-integration directory and copy files
if not exist "dist\debian\windows-integration" mkdir dist\debian\windows-integration
if exist "src\filer\Windows*.ts" (
    copy "src\filer\Windows*.ts" "dist\debian\windows-integration\"
)
if exist "src\examples\windows-explorer-integration.ts" (
    copy "src\examples\windows-explorer-integration.ts" "dist\debian\windows-integration\"
)

echo ✅ Debian package files copied
echo.

REM Copy Windows installer files to dist
echo 📁 Copying Windows installer files...
xcopy /E /I /Y windows-installer dist\windows\
if exist "README.md" copy README.md dist\windows\
if exist "LICENSE.md" copy LICENSE.md dist\windows\

echo ✅ Windows installer files copied
echo.

REM Copy the Debian build script to the dist directory
copy "scripts\build-debian-package.sh" "dist\debian\"

echo 📋 Package Summary:
echo ==================
echo 📁 Debian Package Files: dist\debian\
echo    - debian\ (package configuration)
echo    - one.leute.replicant\ (main application source)
echo    - one.core\ (core library source)
echo    - one.models\ (models library source)
echo    - windows-integration\ (Windows-specific components)
echo    - build-debian-package.sh (build script for WSL2)
echo.
echo 📁 Windows Installer: dist\windows\
echo    - install-one-filer.ps1 (PowerShell installer)
echo    - install-one-filer.bat (Batch wrapper)
echo    - README.md (Installation guide)
echo.
echo 🚀 Next Steps:
echo ==============
echo 1. Build Debian package in WSL2:
echo    cd dist\debian
echo    wsl -- chmod +x build-debian-package.sh
echo    wsl -- ./build-debian-package.sh
echo.
echo 2. Test Windows installer:
echo    cd dist\windows
echo    Right-click install-one-filer.bat → Run as administrator
echo.
echo 3. Distribute packages:
echo    - Share dist\debian\*.deb for Linux users
echo    - Share dist\windows\ folder for Windows users
echo.
echo ℹ️  The Windows installer will automatically:
echo    - Set up WSL2 and Debian
echo    - Install dependencies in the Linux environment
echo    - Deploy and configure the ONE Leute Replicant service
echo    - Create Windows Explorer integration
echo.
echo ✅ Package preparation completed successfully!
pause 