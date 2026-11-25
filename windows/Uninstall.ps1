$ErrorActionPreference = 'Stop'
$installRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$marker = Get-Content -LiteralPath (Join-Path $installRoot '.filer-install.json') -Raw | ConvertFrom-Json
if ($marker.format -ne 1 -or $marker.root -ne $installRoot) { throw 'This is not a recognized Filer installation.' }
$running = Get-Process -Name Filer,node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase) }
if ($running) { throw 'Quit this Filer installation before uninstalling.' }
$manifest = Get-Content -LiteralPath (Join-Path $installRoot 'manifest.json') -Raw | ConvertFrom-Json
$ownedFiles = @($manifest.files.PSObject.Properties.Name) + @('manifest.json', '.filer-install.json')
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @('Programs', 'Startup')) {
    $link = Join-Path ([Environment]::GetFolderPath($folder)) 'Refinio Filer.lnk'
    if ((Test-Path -LiteralPath $link) -and $shell.CreateShortcut($link).TargetPath -eq (Join-Path $installRoot 'Filer.exe')) { Remove-Item -LiteralPath $link }
}
# Remove only enumerated package files. Never recurse over a user-selected directory.
foreach ($name in $ownedFiles) {
    $target = [IO.Path]::GetFullPath((Join-Path $installRoot $name))
    if (-not $target.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid installed package path.' }
    if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target }
}
foreach ($directory in @(Get-ChildItem -LiteralPath $installRoot -Directory -Recurse | Sort-Object FullName -Descending)) {
    if (-not ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -and @(Get-ChildItem -LiteralPath $directory.FullName -Force).Count -eq 0) {
        Remove-Item -LiteralPath $directory.FullName
    }
}
if (@(Get-ChildItem -LiteralPath $installRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $installRoot }
Write-Output 'Filer program files removed. Your protected profile, ONE storage and mounted files have been kept.'
