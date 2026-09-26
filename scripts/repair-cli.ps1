# CARROTCAP CLI - manual repair of the `carrotcap` command (task-018).
#
# Writes the same launchers as the installer and the app's self-heal:
#   %LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.bat  (cmd / PowerShell)
#   %LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap      (Git Bash)
# .BAT comes before .CMD in the default PATHEXT, so these win over Cream CLI's
# carrotcap.cmd, which is left untouched (as is aor.cmd). A same-named file without our
# marker line, a link or a folder is never replaced. The user PATH is not edited.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1 -ExePath 'D:\Tools\carrotcap-cli\carrotcap.exe'

[CmdletBinding()]
param(
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'
$Mark = 'CARROTCAP-CLI-LAUNCHER'

function Write-Info($msg)  { Write-Host "[carrotcap] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[carrotcap] OK: $msg" -ForegroundColor Green }
function Write-WarnX($msg) { Write-Host "[carrotcap] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[carrotcap] ERROR: $msg" -ForegroundColor Red }

# 1) Resolve carrotcap.exe
$candidates = @()
if ($ExePath) { $candidates += $ExePath }
$candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Programs\carrotcap-cli\carrotcap.exe'),
    (Join-Path $PSScriptRoot '..\release\win-unpacked\carrotcap.exe')
)
$resolvedExe = $null
foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { $resolvedExe = (Resolve-Path -LiteralPath $c).Path; break }
}
if (-not $resolvedExe) {
    Write-Err "Could not locate carrotcap.exe. Install the setup first, or pass -ExePath '<full\path\to\carrotcap.exe>'."
    exit 1
}
if ($resolvedExe -match '["%\r\n]') { Write-Err "Unsupported characters in the exe path: $resolvedExe"; exit 1 }
Write-Info "Using carrotcap.exe at: $resolvedExe"

# 2) Launchers (byte-identical to build/installer.nsh and main.js buildLaunchShims)
$shimDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (-not (Test-Path -LiteralPath $shimDir)) { New-Item -ItemType Directory -Force -Path $shimDir | Out-Null }
$bashPath = $resolvedExe.Replace('\', '/').Replace("'", "'\''")
$shims = [ordered]@{
    'carrotcap.bat' = "@echo off`r`nrem $Mark`r`nstart `"`" `"$resolvedExe`" %*`r`n"
    'carrotcap'     = "#!/bin/sh`n# $Mark`n'$bashPath' `"`$@`" >/dev/null 2>&1 &`n"
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($name in $shims.Keys) {
    $p = Join-Path $shimDir $name
    $item = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    if ($item) {
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Write-WarnX "Skipped (a folder or link): $p"; continue }
        $lines = [IO.File]::ReadAllText($p) -split "`n"
        if ($lines.Count -lt 2 -or ($lines[1].TrimEnd("`r") -ne "rem $Mark" -and $lines[1].TrimEnd("`r") -ne "# $Mark")) {
            Write-WarnX "Skipped (belongs to another program): $p"; continue
        }
    }
    [IO.File]::WriteAllText($p, $shims[$name], $utf8)
    Write-Ok "Launcher written: $p"
}

# 3) Verify what a new shell would run
$merged = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) -split ';'
Write-Host ''
Write-Host '--- verification ---'
Write-Host "WindowsApps on PATH: $((@($merged | Where-Object { $_ -match 'WindowsApps' })).Count -gt 0)"
$where = & (Join-Path $env:SystemRoot 'System32\where.exe') carrotcap 2>$null | Select-Object -First 1
Write-Host "carrotcap resolves to: $where"
if ($where -and $where -notlike '*\carrotcap.bat') { Write-WarnX 'Another carrotcap comes first (non-default PATHEXT or a carrotcap.exe/.com on PATH).' }
Write-Ok 'Done. `carrotcap` works in new and already-open terminals.'
