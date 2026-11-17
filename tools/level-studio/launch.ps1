param([switch]$Headless)
$ErrorActionPreference = 'Stop'
$studioRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$studioLogs = Join-Path $PSScriptRoot 'data\logs'
New-Item -ItemType Directory -Path $studioLogs -Force | Out-Null
try {
    $studioNode = Join-Path $studioRoot 'tools\runtime\node.exe'
    if (-not (Test-Path -LiteralPath $studioNode)) { throw 'Bundled Node.js is missing. Extract the complete project ZIP first.' }
    $studioUrl = & $studioNode (Join-Path $PSScriptRoot 'ensure-server.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'APP startup failed. See server-error.log.' }
    $studioUrl = [string]($studioUrl | Select-Object -Last 1)
    if ($studioUrl -notmatch '^http://127\.0\.0\.1:\d+/$') { throw 'Invalid APP startup response.' }
    if (-not $Headless) {
        $studioEdge = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
            (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if ($studioEdge) { Start-Process -FilePath $studioEdge -ArgumentList @("--app=$studioUrl", '--window-size=1440,960') }
        else { Start-Process $studioUrl }
    }
    Write-Output $studioUrl
} catch {
    $_ | Out-String | Add-Content -LiteralPath (Join-Path $studioLogs 'launcher-error.log')
    Write-Error $_
    exit 1
}
