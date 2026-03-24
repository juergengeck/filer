# Build ONE Filer Debian package using local dependencies
param(
    [switch]$Clean = $false
)

Write-Host "Building ONE Filer with local dependencies..." -ForegroundColor Cyan

$projectRoot = Get-Location
$wslProjectRoot = "/mnt/c/Users/juerg/source/one.filer"

try {
    # Step 1: Backup original package.json and use local version
    Write-Host "Setting up local dependencies..." -ForegroundColor Yellow
    
    if ($Clean) {
        Write-Host "Cleaning previous build..." -ForegroundColor Blue
        wsl -d Debian -- bash -c "cd $wslProjectRoot/one.leute.replicant && rm -rf node_modules lib"
    }
    
    # Copy the local package.json
    Copy-Item "one.leute.replicant/package.json" "one.leute.replicant/package.json.backup" -Force
    Copy-Item "one.leute.replicant/package-local.json" "one.leute.replicant/package.json" -Force
    Write-Host "  Using local package.json" -ForegroundColor Green
    
    # Step 2: Install dependencies in WSL
    Write-Host "Installing dependencies in WSL..." -ForegroundColor Yellow
    wsl -d Debian -- bash -c "cd $wslProjectRoot/one.leute.replicant && npm install"
    
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed"
    }
    Write-Host "  Dependencies installed" -ForegroundColor Green
    
    # Step 3: Build the project
    Write-Host "Building project..." -ForegroundColor Yellow
    wsl -d Debian -- bash -c "cd $wslProjectRoot/one.leute.replicant && npm run build"
    
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed"
    }
    Write-Host "  Build completed" -ForegroundColor Green
    
    # Step 4: Build Debian package
    Write-Host "Building Debian package..." -ForegroundColor Yellow
    wsl -d Debian -- bash -c "cd $wslProjectRoot && bash dist/debian/build-debian-package.sh"
    
    if ($LASTEXITCODE -ne 0) {
        throw "Debian package build failed"
    }
    
    # Step 5: Check for the package
    $debFile = Get-ChildItem -Path ".." -Name "*.deb" | Select-Object -First 1
    if ($debFile) {
        Write-Host "SUCCESS! Debian package created: $debFile" -ForegroundColor Green
        Write-Host "Package location: $(Resolve-Path "../$debFile")" -ForegroundColor Cyan
    } else {
        Write-Warning "Debian package not found in parent directory"
    }
    
} catch {
    Write-Error "Build failed: $($_.Exception.Message)"
    exit 1
} finally {
    # Restore original package.json
    if (Test-Path "one.leute.replicant/package.json.backup") {
        Write-Host "Restoring original package.json..." -ForegroundColor Blue
        Copy-Item "one.leute.replicant/package.json.backup" "one.leute.replicant/package.json" -Force
        Remove-Item "one.leute.replicant/package.json.backup" -Force
    }
}

Write-Host "Build process completed!" -ForegroundColor Green 