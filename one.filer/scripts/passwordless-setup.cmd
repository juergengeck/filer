@echo off
echo Setting up passwordless WSL2 operations...
echo.

echo Method 1: Trying to install Node.js without sudo (using snap)...
wsl -d Debian -- bash -c "
if ! command -v node &> /dev/null; then
    echo 'Installing snapd...'
    # Try to install snapd without sudo first
    if command -v snap &> /dev/null; then
        echo 'Snap already available'
        snap install node --classic
    else
        echo 'Need to install Node.js via alternative method'
        # Try using NodeSource without sudo
        curl -fsSL https://deb.nodesource.com/setup_lts.x -o nodesource_setup.sh
        echo 'Downloaded NodeSource setup script'
        echo 'This requires sudo access - please run: sudo bash nodesource_setup.sh'
    fi
else
    echo 'Node.js already installed:'
    node --version
fi
"

echo.
echo Method 2: Check if we can use existing Node.js installation...
wsl -d Debian -- which node
wsl -d Debian -- node --version 2>nul

echo.
echo Method 3: Try installing via package manager without sudo...
wsl -d Debian -- bash -c "
# Check if we can install to user directory
mkdir -p ~/.local/bin
export PATH=~/.local/bin:$PATH

# Try to download and install Node.js to user directory
if ! command -v node &> /dev/null; then
    echo 'Downloading Node.js binary...'
    cd /tmp
    wget https://nodejs.org/dist/v18.18.0/node-v18.18.0-linux-x64.tar.xz
    tar -xf node-v18.18.0-linux-x64.tar.xz
    cp -r node-v18.18.0-linux-x64/* ~/.local/
    echo 'Node.js installed to ~/.local/'
    echo 'export PATH=~/.local/bin:$PATH' >> ~/.bashrc
fi
"

echo.
echo Testing Node.js availability...
wsl -d Debian -- bash -c "export PATH=~/.local/bin:$PATH && node --version"

echo.
pause 