@echo off
echo Setting up Debian user: refinio
echo ================================
echo.

echo Creating user refinio with password refinio...
wsl -d Debian -u root -- bash /mnt/c/Users/juerg/source/one.filer/scripts/setup-user.sh

echo Setting refinio as default user...
wsl --set-default-user Debian refinio

echo Testing user setup...
wsl -d Debian -- whoami
wsl -d Debian -- sudo whoami

echo.
echo ✅ User refinio configured successfully!
echo. 