#Requires -RunAsAdministrator

<#
.SYNOPSIS
    ONE Filer Windows Installer
    
.DESCRIPTION
    This script automates the installation of ONE Filer on Windows by:
    1. Enabling WSL2 feature if needed
    2. Installing Debian distribution
    3. Deploying the ONE Leute Replicant Debian package
    4. Configuring Windows Explorer integration
    5. Setting up auto-start services
    
.PARAMETER SkipWSLSetup
    Skip WSL2 setup if already configured
    
.PARAMETER MountPoint
    Windows mount point for ONE files (default: Z:)
    
.PARAMETER DebianPackagePath
    Path to the ONE Leute Replicant Debian package
#>

param(
    [switch]$SkipWSLSetup,
    [string]$MountPoint = "Z:",
    [string]$DebianPackagePath = ""
)

# Configuration
$WSL_DISTRO_NAME = "ONE-Debian"
$WSL_USER = "one-user"
$PACKAGE_NAME = "one-leute-replicant_4.0.0-beta-1_amd64.deb"
$SERVICE_NAME = "ONEFilerService"

Write-Host "🪟 ONE Filer Windows Installer" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Check if running as administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "❌ This script must be run as Administrator"
    exit 1
}

# Function to check if WSL2 is enabled
function Test-WSL2Enabled {
    try {
        $wslVersion = wsl --version 2>$null
        return $wslVersion -and $wslVersion.Contains("WSL version")
    }
    catch {
        return $false
    }
}

# Function to enable WSL2
function Enable-WSL2 {
    Write-Host "🔧 Enabling WSL2 feature..." -ForegroundColor Yellow
    
    # Enable WSL feature
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
    
    # Enable Virtual Machine Platform
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
    
    # Set WSL2 as default
    wsl --set-default-version 2
    
    Write-Host "✅ WSL2 feature enabled (restart may be required)" -ForegroundColor Green
}

# Function to install Debian
function Install-Debian {
    Write-Host "🐧 Installing Debian distribution..." -ForegroundColor Yellow
    
    # Check if Debian is already installed
    $existingDistros = wsl --list --quiet
    if ($existingDistros -contains $WSL_DISTRO_NAME) {
        Write-Host "⚠️  Debian distribution already exists. Removing..." -ForegroundColor Yellow
        wsl --unregister $WSL_DISTRO_NAME
    }
    
    # Download and install Debian
    $debianUrl = "https://aka.ms/wsl-debian-gnulinux"
    $debianPath = "$env:TEMP\debian.appx"
    
    Write-Host "📥 Downloading Debian..." -ForegroundColor Blue
    Invoke-WebRequest -Uri $debianUrl -OutFile $debianPath
    
    Write-Host "📦 Installing Debian..." -ForegroundColor Blue
    Add-AppxPackage -Path $debianPath
    
    # Initialize Debian
    Write-Host "🔧 Initializing Debian..." -ForegroundColor Blue
    debian.exe install --root
    
    # Set up user
    wsl -d $WSL_DISTRO_NAME -- useradd -m -s /bin/bash $WSL_USER
    wsl -d $WSL_DISTRO_NAME -- usermod -aG sudo $WSL_USER
    wsl -d $WSL_DISTRO_NAME -- passwd -d $WSL_USER  # Remove password for convenience
    
    Write-Host "✅ Debian installed successfully" -ForegroundColor Green
}

# Function to deploy ONE Leute Replicant
function Deploy-ONEReplicant {
    param([string]$PackagePath)
    
    Write-Host "🚀 Deploying ONE Leute Replicant..." -ForegroundColor Yellow
    
    if (-not $PackagePath) {
        # Look for package in current directory
        $PackagePath = Get-ChildItem -Path "." -Name $PACKAGE_NAME -ErrorAction SilentlyContinue
        if (-not $PackagePath) {
            Write-Error "❌ Debian package not found. Please specify -DebianPackagePath"
            exit 1
        }
    }
    
    if (-not (Test-Path $PackagePath)) {
        Write-Error "❌ Debian package not found at: $PackagePath"
        exit 1
    }
    
    # Copy package to WSL
    $wslPackagePath = "/tmp/$PACKAGE_NAME"
    wsl -d $WSL_DISTRO_NAME -- rm -f $wslPackagePath
    wsl -d $WSL_DISTRO_NAME -- cp "/mnt/c/$(($PackagePath -replace '\\', '/') -replace 'C:', '')" $wslPackagePath
    
    # Update package lists
    Write-Host "📦 Updating package lists..." -ForegroundColor Blue
    wsl -d $WSL_DISTRO_NAME -- sudo apt-get update
    
    # Install dependencies
    Write-Host "📦 Installing dependencies..." -ForegroundColor Blue
    wsl -d $WSL_DISTRO_NAME -- sudo apt-get install -y nodejs npm fuse3 libfuse3-dev build-essential python3 git
    
    # Install the package
    Write-Host "📦 Installing ONE Leute Replicant..." -ForegroundColor Blue
    wsl -d $WSL_DISTRO_NAME -- sudo dpkg -i $wslPackagePath
    wsl -d $WSL_DISTRO_NAME -- sudo apt-get install -f -y
    
    Write-Host "✅ ONE Leute Replicant deployed successfully" -ForegroundColor Green
}

# Function to configure Windows integration
function Configure-WindowsIntegration {
    param([string]$MountPoint)
    
    Write-Host "🪟 Configuring Windows integration..." -ForegroundColor Yellow
    
    # Create mount point directory if it's a path
    if ($MountPoint -notmatch "^[A-Z]:$") {
        $parentDir = Split-Path $MountPoint -Parent
        if ($parentDir -and -not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force
            Write-Host "📁 Created directory: $parentDir" -ForegroundColor Blue
        }
    }
    
    # Update WSL configuration for the mount point
    $wslConfig = @"
[automount]
enabled = true
root = /mnt/
options = "metadata,umask=22,fmask=11"

[network]
generateHosts = true
generateResolvConf = true
"@
    
    $wslConfigPath = "$env:USERPROFILE\.wslconfig"
    $wslConfig | Out-File -FilePath $wslConfigPath -Encoding UTF8
    
    Write-Host "✅ Windows integration configured" -ForegroundColor Green
}

# Function to create Windows service
function Create-WindowsService {
    Write-Host "🔧 Creating Windows service..." -ForegroundColor Yellow
    
    # Create service script
    $serviceScript = @"
@echo off
wsl -d $WSL_DISTRO_NAME -- sudo systemctl start one-leute-replicant
"@
    
    $serviceScriptPath = "$env:ProgramFiles\ONE Filer\start-service.bat"
    $serviceDir = Split-Path $serviceScriptPath -Parent
    
    if (-not (Test-Path $serviceDir)) {
        New-Item -ItemType Directory -Path $serviceDir -Force
    }
    
    $serviceScript | Out-File -FilePath $serviceScriptPath -Encoding ASCII
    
    # Create Windows service
    $servicePath = "cmd.exe /c `"$serviceScriptPath`""
    
    try {
        # Remove existing service if it exists
        $existingService = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
        if ($existingService) {
            Stop-Service -Name $SERVICE_NAME -Force -ErrorAction SilentlyContinue
            sc.exe delete $SERVICE_NAME
        }
        
        # Create new service
        sc.exe create $SERVICE_NAME binPath= $servicePath start= auto DisplayName= "ONE Filer Service"
        sc.exe description $SERVICE_NAME "ONE Filer - Federated File System Service"
        
        Write-Host "✅ Windows service created" -ForegroundColor Green
    }
    catch {
        Write-Warning "⚠️  Could not create Windows service: $($_.Exception.Message)"
    }
}

# Function to create system tray application
function Create-SystemTrayApp {
    Write-Host "🖥️  Creating system tray application..." -ForegroundColor Yellow
    
    $trayAppScript = @'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Create system tray icon
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon("$env:SystemRoot\System32\shell32.dll")
$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = $icon
$trayIcon.Text = "ONE Filer"
$trayIcon.Visible = $true

# Create context menu
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$startItem = $contextMenu.Items.Add("Start ONE Filer")
$stopItem = $contextMenu.Items.Add("Stop ONE Filer")
$statusItem = $contextMenu.Items.Add("Status")
$contextMenu.Items.Add("-")
$exitItem = $contextMenu.Items.Add("Exit")

$trayIcon.ContextMenuStrip = $contextMenu

# Event handlers
$startItem.Add_Click({
    Start-Service -Name "ONEFilerService" -ErrorAction SilentlyContinue
    $trayIcon.ShowBalloonTip(3000, "ONE Filer", "Service started", [System.Windows.Forms.ToolTipIcon]::Info)
})

$stopItem.Add_Click({
    Stop-Service -Name "ONEFilerService" -ErrorAction SilentlyContinue
    $trayIcon.ShowBalloonTip(3000, "ONE Filer", "Service stopped", [System.Windows.Forms.ToolTipIcon]::Info)
})

$statusItem.Add_Click({
    $service = Get-Service -Name "ONEFilerService" -ErrorAction SilentlyContinue
    $status = if ($service) { $service.Status } else { "Not Found" }
    $trayIcon.ShowBalloonTip(3000, "ONE Filer Status", "Service: $status", [System.Windows.Forms.ToolTipIcon]::Info)
})

$exitItem.Add_Click({
    $trayIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

# Keep the application running
[System.Windows.Forms.Application]::Run()
'@
    
    $trayAppPath = "$env:ProgramFiles\ONE Filer\ONE-Filer-Tray.ps1"
    $trayAppScript | Out-File -FilePath $trayAppPath -Encoding UTF8
    
    # Create startup shortcut
    $startupPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\ONE Filer.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startupPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayAppPath`""
    $shortcut.WorkingDirectory = "$env:ProgramFiles\ONE Filer"
    $shortcut.Save()
    
    Write-Host "✅ System tray application created" -ForegroundColor Green
}

# Main installation process
try {
    Write-Host "🚀 Starting ONE Filer installation..." -ForegroundColor Green
    
    # Step 1: Enable WSL2 if needed
    if (-not $SkipWSLSetup) {
        if (-not (Test-WSL2Enabled)) {
            Enable-WSL2
            Write-Host "⚠️  Please restart your computer and run this script again" -ForegroundColor Yellow
            exit 0
        }
        
        # Step 2: Install Debian
        Install-Debian
    }
    
    # Step 3: Deploy ONE Leute Replicant
    Deploy-ONEReplicant -PackagePath $DebianPackagePath
    
    # Step 4: Configure Windows integration
    Configure-WindowsIntegration -MountPoint $MountPoint
    
    # Step 5: Create Windows service
    Create-WindowsService
    
    # Step 6: Create system tray application
    Create-SystemTrayApp
    
    # Step 7: Start the service
    Write-Host "🚀 Starting ONE Filer service..." -ForegroundColor Yellow
    wsl -d $WSL_DISTRO_NAME -- sudo systemctl start one-leute-replicant
    Start-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
    
    Write-Host ""
    Write-Host "🎉 ONE Filer installation completed successfully!" -ForegroundColor Green
    Write-Host "📁 Your ONE files will be available at: $MountPoint" -ForegroundColor Cyan
    Write-Host "🖥️  System tray application will start automatically" -ForegroundColor Cyan
    Write-Host "📊 Check service status: Get-Service $SERVICE_NAME" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "🔧 Manual commands:" -ForegroundColor Yellow
    Write-Host "   Start service: Start-Service $SERVICE_NAME" -ForegroundColor Gray
    Write-Host "   Stop service:  Stop-Service $SERVICE_NAME" -ForegroundColor Gray
    Write-Host "   WSL access:    wsl -d $WSL_DISTRO_NAME" -ForegroundColor Gray
    
}
catch {
    Write-Error "❌ Installation failed: $($_.Exception.Message)"
    Write-Host "📋 Check the error details above and try again" -ForegroundColor Yellow
    exit 1
} 