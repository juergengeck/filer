@echo off
echo Configuring WSL2 user for passwordless sudo...
echo.

echo Setting up passwordless sudo for current user...
wsl -d Debian -- bash -c "echo '%sudo ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/wsl-users"

echo Adding current user to sudo group...
wsl -d Debian -- sudo usermod -aG sudo $USER

echo Testing sudo access...
wsl -d Debian -- sudo whoami

echo.
echo ✅ WSL2 user configuration completed!
echo You can now run automated setup scripts.
echo.
pause 