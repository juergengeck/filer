@echo off
echo ONE Filer Windows Installer
echo ===========================
echo.
echo This will install ONE Filer on your Windows system.
echo Administrator privileges are required.
echo.
pause

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running as Administrator...
) else (
    echo ERROR: This installer must be run as Administrator.
    echo Please right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Execute the PowerShell installer
powershell.exe -ExecutionPolicy Bypass -File "%~dp0install-one-filer.ps1"

echo.
echo Installation completed. Press any key to exit.
pause 