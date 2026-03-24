# Manual Setup Guide for ONE.filer WSL2

Since PowerShell is having display issues, here's a manual step-by-step guide:

## 🔧 Manual Setup Steps

### Step 1: Test Current WSL2 Status

Open a **new Command Prompt** (not PowerShell) and run:
```cmd
wsl --list --verbose
```

You should see Debian listed. If it shows version 1, upgrade it:
```cmd
wsl --set-version Debian 2
```

### Step 2: Access WSL2 and Install Node.js

```cmd
wsl -d Debian
```

Once in WSL2 Debian, run these commands:
```bash
# Update package lists
sudo apt update

# Install curl and build tools
sudo apt install -y curl build-essential

# Install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Step 3: Test Project Access

Still in WSL2, check if you can access the project:
```bash
cd /mnt/c/Users/juerg/source/one.filer
pwd
ls -la
```

### Step 4: Run Our Test Script

```bash
bash scripts/test-one-packages.sh
```

### Step 5: Install Dependencies

```bash
# Install one.leute.replicant dependencies
cd one.leute.replicant
npm install

# Go back and install one.filer dependencies
cd ..
npm install
```

### Step 6: Test one.leute.replicant

```bash
cd one.leute.replicant

# Copy our WSL2 config
cp ../scripts/wsl2-config.json ./configs/

# Check if it can start (Ctrl+C to stop)
npm start -- --config=configs/wsl2-config.json
```

## 🎯 Expected Results

- ✅ WSL2 Debian running version 2
- ✅ Node.js LTS installed (v18+ or v20+)
- ✅ Project files accessible from `/mnt/c/Users/juerg/source/one.filer`
- ✅ Dependencies installed successfully
- ✅ one.leute.replicant starts without errors

## 🐛 If Something Goes Wrong

### Node.js Installation Issues
```bash
# Alternative Node.js installation via snap
sudo apt install snapd
sudo snap install node --classic
```

### Permission Issues
```bash
# Fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### WSL2 Issues
```cmd
# Restart WSL2 (run in Windows Command Prompt)
wsl --shutdown
wsl -d Debian
```

## 🚀 Next Steps After Setup

1. Configure FUSE support
2. Set up the mount point
3. Test Windows Explorer integration
4. Implement data ingestion pipeline

## 📝 Notes

- Use Command Prompt instead of PowerShell if you encounter display issues
- The setup creates a development environment - production deployment will be different
- All ONE packages run natively in Linux (WSL2) for optimal performance 