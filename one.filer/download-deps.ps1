# Download GitHub dependencies for ONE Filer build
# This script downloads private GitHub repos using token authentication

param(
    [string]$GitHubToken = $env:GITHUB_TOKEN,
    [string]$TempDir = "temp-deps"
)

if (-not $GitHubToken) {
    Write-Error "GitHub token required. Set GITHUB_TOKEN environment variable or pass -GitHubToken"
    exit 1
}

Write-Host "Downloading GitHub dependencies..." -ForegroundColor Cyan
Write-Host "Using token: $($GitHubToken.Substring(0,8))..." -ForegroundColor Gray

# Create temp directory
if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
}
New-Item -ItemType Directory -Path $TempDir | Out-Null

# Dependencies to download
$deps = @(
    @{
        repo = "refinio/one.core"
        tag = "v0.6.1-beta-1"
        name = "one.core"
    },
    @{
        repo = "refinio/one.models" 
        tag = "14.1.0-beta-1"
        name = "one.models"
    },
    @{
        repo = "refinio/fuse-native"
        tag = "main"  # or whatever the default branch is
        name = "fuse-native"
    }
)

foreach ($dep in $deps) {
    Write-Host "Downloading $($dep.repo)#$($dep.tag)..." -ForegroundColor Yellow
    
    $url = "https://api.github.com/repos/$($dep.repo)/tarball/$($dep.tag)"
    Write-Host "  URL: $url" -ForegroundColor Gray
    
    $headers = @{
        "Authorization" = "token $GitHubToken"
        "Accept" = "application/vnd.github.v3+json"
        "User-Agent" = "PowerShell-Script"
    }
    
    $tarFile = "$TempDir/$($dep.name).tar.gz"
    $extractDir = "$TempDir/$($dep.name)"
    
    try {
        # Download tarball
        Write-Host "  Downloading..." -ForegroundColor Blue
        $response = Invoke-WebRequest -Uri $url -Headers $headers -OutFile $tarFile -PassThru
        Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Blue
        Write-Host "  Downloaded: $tarFile" -ForegroundColor Green
        
        # Check if file exists and has content
        if (-not (Test-Path $tarFile)) {
            throw "Downloaded file not found"
        }
        
        $fileSize = (Get-Item $tarFile).Length
        if ($fileSize -eq 0) {
            throw "Downloaded file is empty"
        }
        Write-Host "  File size: $fileSize bytes" -ForegroundColor Blue
        
        # Extract using tar (available in Windows 10+)
        Write-Host "  Extracting..." -ForegroundColor Blue
        New-Item -ItemType Directory -Path $extractDir | Out-Null
        tar -xzf $tarFile -C $extractDir --strip-components=1
        Write-Host "  Extracted to: $extractDir" -ForegroundColor Green
        
        # Remove tarball
        Remove-Item $tarFile
        
    } catch {
        Write-Host "  Error details: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Error type: $($_.Exception.GetType().Name)" -ForegroundColor Red
        if ($_.Exception.Response) {
            Write-Host "  HTTP Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
            Write-Host "  HTTP Reason: $($_.Exception.Response.ReasonPhrase)" -ForegroundColor Red
        }
        Write-Error "Failed to download $($dep.repo): $($_.Exception.Message)"
        exit 1
    }
}

Write-Host "All dependencies downloaded to $TempDir" -ForegroundColor Green
Write-Host "Next: Copy to WSL and modify package.json to use local paths" -ForegroundColor Cyan 