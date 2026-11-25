param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $Source | Select-Object -ExpandProperty FullName) -DestinationPath $Destination
