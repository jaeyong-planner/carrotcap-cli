# CARROTCAP CLI - manual repair script.
#
# Run this on any Windows PC where the `carrotcap` command is missing,
# even though the GUI is already installed. Common reasons it fails:
#   - antivirus quarantined the .cmd shim during install
#   - %LOCALAPPDATA%\Microsoft\WindowsApps was removed from PATH
#   - the user copied carrotcap.exe by hand instead of running the .exe installer
#   - the user is using a portable/unpacked build (release\win-unpacked)
#
# Usage (from any PowerShell window):
#   powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\repair-cli.ps1 -ExePath 'D:\Tools\carrotcap\carrotcap.exe'
#
# After this finishes successfully, OPEN A NEW PowerShell window and run:
#   carrotcap
#   aor

[CmdletBinding()]
param(
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg)  { Write-Host "[carrotcap] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[carrotcap] OK: $msg" -ForegroundColor Green }
function Write-WarnX($msg) { Write-Host "[carrotcap] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[carrotcap] ERROR: $msg" -ForegroundColor Red }

# 1) Resolve carrotcap.exe location
$candidates = @()
if ($ExePath) { $candidates += $ExePath }
$candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Programs\carrotcap\carrotcap.exe'),
    (Join-Path $env:ProgramFiles 'CARROTCAP CLI\carrotcap.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'CARROTCAP CLI\carrotcap.exe'),
    (Join-Path $PSScriptRoot '..\release\win-unpacked\carrotcap.exe')
)

$resolvedExe = $null
foreach ($c in $candidates) {
    if (-not $c) { continue }
    if (Test-Path -LiteralPath $c) {
        $resolvedExe = (Resolve-Path -LiteralPath $c).Path
        break
    }
}

if (-not $resolvedExe) {
    Write-Err "Could not locate carrotcap.exe. Install the .exe first, or pass -ExePath '<full\path\to\carrotcap.exe>'."
    exit 1
}
Write-Info "Using carrotcap.exe at: $resolvedExe"
$installDir = Split-Path -Parent $resolvedExe

# 2) Create / refresh the .cmd shims in WindowsApps (default user PATH on Win 10/11)
$shimDir  = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
if (-not (Test-Path -LiteralPath $shimDir)) {
    New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
}
$shimContent = "@echo off`r`nstart `"`" `"$resolvedExe`" %*`r`n"
$shimPaths = @(
    (Join-Path $shimDir 'carrotcap.cmd'),
    (Join-Path $shimDir 'aor.cmd')
)
foreach ($shimPath in $shimPaths) {
    Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ASCII -NoNewline
    Write-Ok "Shim written: $shimPath"
}

# 3) Ensure the install dir is on the user PATH (HKCU\Environment\Path)
#    HKCU only -> never requires admin.
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $current) { $current = '' }
$parts = $current -split ';' | Where-Object { $_ -ne '' }
$normalized = $parts | ForEach-Object { $_.TrimEnd('\').ToLowerInvariant() }
$installDirNorm = $installDir.TrimEnd('\').ToLowerInvariant()

if ($normalized -notcontains $installDirNorm) {
    $next = if ($current.Length -gt 0) { "$current;$installDir" } else { "$installDir" }
    try {
        [Environment]::SetEnvironmentVariable('Path', $next, 'User')
        Write-Ok "Added to user PATH: $installDir"
    } catch {
        Write-WarnX "Could not update user PATH: $($_.Exception.Message)"
        Write-WarnX "The WindowsApps shims were still written. If WindowsApps is on PATH, carrotcap/aor will work in a new shell."
    }
} else {
    Write-Info "User PATH already contains the install dir."
}

# 4) Broadcast WM_SETTINGCHANGE so newly opened terminals see the new PATH immediately.
try {
    $sig = @'
[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    $type = Add-Type -MemberDefinition $sig -Name Win32SendMessageTimeout -Namespace Win32Functions -PassThru
    $HWND_BROADCAST = [IntPtr]0xffff
    $WM_SETTINGCHANGE = 0x1A
    $SMTO_ABORTIFHUNG = 2
    $out = [UIntPtr]::Zero
    [void]$type::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [UIntPtr]::Zero, 'Environment', $SMTO_ABORTIFHUNG, 3000, [ref]$out)
    Write-Info "Broadcasted environment change."
} catch {
    Write-WarnX "Could not broadcast environment change: $($_.Exception.Message)"
}

# 5) Verify
$userPathNow    = [Environment]::GetEnvironmentVariable('Path', 'User')
$machinePathNow = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$mergedPath     = "$machinePathNow;$userPathNow"
Write-Host ''
Write-Host '--- verification ---'
Write-Host "carrotcap shim exists:       $(Test-Path -LiteralPath (Join-Path $shimDir 'carrotcap.cmd'))"
Write-Host "aor shim exists:             $(Test-Path -LiteralPath (Join-Path $shimDir 'aor.cmd'))"
Write-Host "WindowsApps on effective PATH: $((($mergedPath -split ';') -match 'WindowsApps').Count -gt 0)"
Write-Host "Install dir on user PATH:    $((($userPathNow -split ';') -match [regex]::Escape($installDir)).Count -gt 0)"
Write-Host ''
Write-Ok 'Done. Open a NEW PowerShell window and run: carrotcap or aor'
