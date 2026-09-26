<#
.SYNOPSIS
    Install node_modules OUTSIDE the Google Drive-synced source folder and link it back
    with a directory junction.

.DESCRIPTION
    The source tree lives under "내 드라이브" (Google Drive mirror). Syncing ~400MB of
    node_modules is slow and has corrupted files before (partially-synced packages).
    This script:
      1. Runs `npm ci` in a local cache dir (default: %USERPROFILE%\.carrotcap-dev\carrotcap-cli).
      2. Replaces <project>\node_modules with a junction pointing at that install.
    Re-run it whenever package-lock.json changes.

.PARAMETER CacheRoot
    Local directory that will hold node_modules.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
#>
[CmdletBinding()]
param(
    [string] $CacheRoot = (Join-Path $env:USERPROFILE ".carrotcap-dev\carrotcap-cli")
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$linkPath    = Join-Path $projectRoot "node_modules"
$targetPath  = Join-Path $CacheRoot "node_modules"

New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
foreach ($f in @("package.json", "package-lock.json", ".npmrc")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $f) -Destination $CacheRoot -Force
}

Push-Location $CacheRoot
try {
    & npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

if (Test-Path -LiteralPath $linkPath) {
    $item = Get-Item -LiteralPath $linkPath -Force
    if ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink") {
        # Removing a junction never touches the target's contents.
        $item.Delete()
    } else {
        Write-Host "[setup-dev] removing in-Drive node_modules (regenerable)..." -ForegroundColor Yellow
        Remove-Item -LiteralPath $linkPath -Recurse -Force
    }
}
New-Item -ItemType Junction -Path $linkPath -Target $targetPath | Out-Null

foreach ($f in @("package.json", "package-lock.json", ".npmrc")) {
    Remove-Item -LiteralPath (Join-Path $CacheRoot $f) -Force -ErrorAction SilentlyContinue
}

Write-Host "[setup-dev] node_modules -> $targetPath" -ForegroundColor Green
