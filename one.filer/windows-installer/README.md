# ONE Filer Windows Installer

This installer package provides automated setup of ONE Filer on Windows systems, enabling seamless integration between ONE's federated database and Windows Explorer through WSL2.

## What Gets Installed

The installer automates the complete setup process:

1. **WSL2 Feature** - Enables Windows Subsystem for Linux 2
2. **Debian Distribution** - Installs a clean Debian environment in WSL2
3. **ONE Leute Replicant** - Deploys the federated file system service
4. **Windows Integration** - Configures FUSE mounting for Windows Explorer
5. **System Service** - Creates auto-start Windows service
6. **System Tray App** - Provides easy management interface

## Prerequisites

- **Windows 10 version 2004** or later, or **Windows 11**
- **Administrator privileges** for installation
- **Internet connection** for downloading components
- **Virtualization enabled** in BIOS/UEFI (for WSL2)

## Installation Methods

### Method 1: Simple Installation (Recommended)

1. **Download** the installer package
2. **Extract** all files to a folder
3. **Right-click** on `install-one-filer.bat`
4. **Select** "Run as administrator"
5. **Follow** the on-screen prompts

### Method 2: PowerShell Installation

```powershell
# Run PowerShell as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install-one-filer.ps1
```

### Method 3: Custom Installation

```powershell
# Custom mount point and package location
.\install-one-filer.ps1 -MountPoint "C:\ONE-Files" -DebianPackagePath ".\one-leute-replicant_4.0.0-beta-1_amd64.deb"

# Skip WSL setup if already configured
.\install-one-filer.ps1 -SkipWSLSetup
```

## Installation Process

The installer performs these steps automatically:

### 1. WSL2 Setup
- Enables WSL and Virtual Machine Platform features
- Downloads and installs Debian distribution
- Creates dedicated user account
- Configures WSL2 settings

### 2. Package Deployment
- Installs Node.js, npm, and FUSE dependencies
- Deploys ONE Leute Replicant Debian package
- Configures systemd service
- Sets up logging and data directories

### 3. Windows Integration
- Creates mount point for Windows Explorer access
- Configures WSL2-Windows file system bridge
- Sets up Windows file attributes support
- Enables extended attributes and alternate data streams

### 4. Service Management
- Creates Windows service for auto-start
- Installs system tray management application
- Configures startup shortcuts
- Starts the federated file system service

## Post-Installation

After successful installation:

### Accessing Your Files
- **Mount Point**: Your ONE files appear at `Z:` drive (or custom location)
- **Windows Explorer**: Browse files normally through Windows Explorer
- **Network Path**: `\\wsl$\Debian\mnt\one-files` (alternative access)

### Managing the Service

#### System Tray Application
- **Right-click** the ONE Filer icon in system tray
- **Start/Stop** service as needed
- **Check Status** of the service
- **Exit** to close tray application

#### PowerShell Commands
```powershell
# Check service status
Get-Service ONEFilerService

# Start service
Start-Service ONEFilerService

# Stop service
Stop-Service ONEFilerService

# Restart service
Restart-Service ONEFilerService
```

#### WSL Commands
```bash
# Access WSL environment
wsl -d ONE-Debian

# Check service status in WSL
sudo systemctl status one-leute-replicant

# View logs
sudo journalctl -u one-leute-replicant -f
```

## Configuration

### Default Configuration
- **WSL Distribution**: ONE-Debian
- **Mount Point**: Z: drive
- **Service Port**: 8080 (REST API)
- **Data Directory**: `/opt/one-leute-replicant/data`
- **Log Directory**: `/var/log/one-leute-replicant/`

### Customization
Edit the configuration file:
```bash
wsl -d ONE-Debian
sudo nano /etc/one-leute-replicant/config.json
sudo systemctl restart one-leute-replicant
```

## Troubleshooting

### Common Issues

#### WSL2 Not Available
- **Cause**: Virtualization disabled or Windows version too old
- **Solution**: Enable virtualization in BIOS, update Windows

#### Installation Fails
- **Cause**: Insufficient privileges or network issues
- **Solution**: Run as Administrator, check internet connection

#### Service Won't Start
- **Cause**: Port conflicts or configuration errors
- **Solution**: Check logs, verify configuration

#### Files Not Visible
- **Cause**: Mount point issues or service not running
- **Solution**: Restart service, check mount point

### Log Locations
- **Windows Service**: Event Viewer → Windows Logs → Application
- **WSL Service**: `/var/log/one-leute-replicant/replicant.log`
- **System Journal**: `sudo journalctl -u one-leute-replicant`

### Getting Help
```bash
# Check WSL status
wsl --status

# List WSL distributions
wsl --list --verbose

# Check ONE service
wsl -d ONE-Debian -- sudo systemctl status one-leute-replicant

# View detailed logs
wsl -d ONE-Debian -- sudo journalctl -u one-leute-replicant --no-pager
```

## Uninstallation

To remove ONE Filer:

1. **Stop the service**:
   ```powershell
   Stop-Service ONEFilerService
   ```

2. **Remove Windows service**:
   ```powershell
   sc.exe delete ONEFilerService
   ```

3. **Remove WSL distribution**:
   ```powershell
   wsl --unregister ONE-Debian
   ```

4. **Clean up files**:
   - Remove `C:\Program Files\ONE Filer\`
   - Remove startup shortcut from `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`

## Support

For technical support and documentation:
- **GitHub**: https://github.com/refinio/one.filer
- **Documentation**: https://github.com/refinio/one.leute.replicant
- **Issues**: Report bugs and feature requests on GitHub

## License

See LICENSE.md for license information.

---

**ONE Filer** - Making federated databases accessible through familiar file system interfaces. 