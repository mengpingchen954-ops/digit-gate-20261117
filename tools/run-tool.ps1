param([Parameter(Mandatory=$true)][string]$Tool)
$ErrorActionPreference = 'Stop'
$toolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Tool))
if (-not $toolFile.StartsWith($PSScriptRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Tool must stay inside the project tools folder.' }
Set-Location -LiteralPath $toolRoot
& (Join-Path $PSScriptRoot 'runtime\node.exe') $toolFile
exit $LASTEXITCODE
