# CARROTCAP CLI - PTY auto-repair
# Goal: get `require('node-pty')` to succeed against the Electron version this app uses.
# Why this script exists: users sometimes start the app via `npm start` or the global
#   `carrotcap.cmd` shim, which both bypass start.bat's repair branch. This script can be
#   run on demand without remembering the exact npm flags.
#
# Usage (in C:\carrotcap-cli):
#   powershell -ExecutionPolicy Bypass -File scripts\fix-pty.ps1

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }

Step "Diagnose current state"
$nodePtyPath = Join-Path $Root 'node_modules\node-pty'
$hasFolder = Test-Path $nodePtyPath
Write-Host "node-pty folder exists: $hasFolder"

$electronPkg = Join-Path $Root 'node_modules\electron\package.json'
if (-not (Test-Path $electronPkg)) { Fail "node_modules\electron not found. Run 'npm install' first." }
$electronVer = (Get-Content $electronPkg -Raw | ConvertFrom-Json).version
Write-Host "Electron version: $electronVer"

Step "Ensure node-pty is installed (without running its native build under system Node)"
# CRITICAL: --ignore-scripts prevents npm from trying to build node-pty against the
#           system Node version (e.g., Node 24), which would fail and leave npm in a bad state.
#           We will rebuild it cleanly against the Electron ABI in the next step.
$env:GYP_MSVS_VERSION = '2022'
$env:npm_config_msvs_version = '2022'
if (Test-Path $nodePtyPath) {
  Write-Host "Removing previous node-pty folder for a clean state..."
  Remove-Item -Recurse -Force $nodePtyPath
}
& npm install node-pty@1.0.0 --save --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install node-pty failed" }
if (-not (Test-Path $nodePtyPath)) { Fail "npm reported success but node_modules\node-pty is missing." }
Ok "node-pty source at $nodePtyPath"

Step "Rebuild node-pty against Electron $electronVer ABI (this is the only build that matters)"
& npx electron-rebuild -f -w node-pty -v $electronVer
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Rebuild failed. Common causes (in order of likelihood):" -ForegroundColor Yellow
  Write-Host "  1) MSB8020 'ClangCL not found' — install ClangCL workload."
  Write-Host "     Fix: VS Installer -> Build Tools 2022 -> Modify -> Individual components ->"
  Write-Host "          check 'C++ Clang Compiler for Windows' AND 'MSBuild support for LLVM (clang-cl) toolset'."
  Write-Host "          Then reopen PowerShell and re-run this script."
  Write-Host "  2) MSVC v143 / Windows SDK missing — enable 'Desktop development with C++' workload."
  Write-Host "  3) Python 3 not on PATH."
  Write-Host "     Fix: winget install Python.Python.3.12, then reopen this PowerShell."
  Fail "electron-rebuild reported errors"
}

Step "Verify require('node-pty') works"
$verify = & node -e "try { require('node-pty'); console.log('OK') } catch (e) { console.log('FAIL:' + e.message) }" 2>&1
Write-Host $verify
if ($verify -notmatch '^OK') {
  Fail "node-pty still cannot be required. See message above."
}

Step "Done"
Ok "PTY is healthy. Restart CARROTCAP (close all windows, then run: npm start)"
Write-Host ""
Write-Host "Validation in the new window:" -ForegroundColor Cyan
Write-Host "  - Pane header shows blue 'powershell.exe' (no '(no-PTY)' tag)"
Write-Host "  - Type some text and press Backspace - characters delete"
