param(
    [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs\Refinio Filer'),
    [switch]$StartAtLogin,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Filer requires 64-bit Windows.' }
if (-not (Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\ProjectedFSLib.dll'))) {
    throw 'Enable the Windows Projected File System feature (Client-ProjFS), then run this installer again.'
}
$packageRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$installRoot = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $installRoot) { throw 'The destination already exists. Quit Filer and uninstall its program files before installing this build. Your profile and files are kept.' }
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64') { throw 'Unsupported Filer package.' }
$entries = @($manifest.files.PSObject.Properties)
foreach ($entry in $entries) {
    $source = [IO.Path]::GetFullPath((Join-Path $packageRoot $entry.Name))
    if (-not $source.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package path.' }
    $item = Get-Item -LiteralPath $source
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Package files must be regular files.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.Value) { throw "Package integrity check failed: $($entry.Name)" }
}
$actual = @(Get-ChildItem -LiteralPath $packageRoot -File -Recurse)
if ($actual.Count -ne $entries.Count + 1) { throw 'Package contains unlisted files.' }
New-Item -ItemType Directory -Path $installRoot | Out-Null
foreach ($entry in $entries) {
    $target = Join-Path $installRoot $entry.Name
    New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $packageRoot $entry.Name) -Destination $target
}
Copy-Item -LiteralPath (Join-Path $packageRoot 'manifest.json') -Destination $installRoot
Set-Content -LiteralPath (Join-Path $installRoot '.filer-install.json') -Value (@{format = 1; root = $installRoot} | ConvertTo-Json) -Encoding UTF8
if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Refinio Filer.lnk'))
    $shortcut.TargetPath = Join-Path $installRoot 'Filer.exe'; $shortcut.WorkingDirectory = $installRoot; $shortcut.Save()
}
if ($StartAtLogin) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Refinio Filer.lnk'))
    $shortcut.TargetPath = Join-Path $installRoot 'Filer.exe'; $shortcut.Arguments = '--background'; $shortcut.WorkingDirectory = $installRoot; $shortcut.Save()
}
Write-Output "Installed Filer at $installRoot. Run Filer.exe to configure your ONE instance."
