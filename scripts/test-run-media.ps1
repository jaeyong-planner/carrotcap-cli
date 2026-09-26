<#
.SYNOPSIS
    Tests scripts/run-media.ps1 against a fake `grok` (no login, no real generation).

.DESCRIPTION
    Copies the runner + contract into a throwaway project and puts a fake grok.cmd first
    on PATH. Cases:
      1. grok exits 0 and writes the media log  -> success, raw stdout deleted
      2. grok exits 0 but writes no log          -> failure, raw stdout kept
      3. log already exists, grok does not touch -> failure (stale result not accepted)
      4. grok exits 1                            -> failure, raw stdout kept
      5. TaskId with a path                      -> rejected before running
    Usage: powershell -ExecutionPolicy Bypass -File scripts\test-run-media.ps1
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$tmp  = Join-Path ([System.IO.Path]::GetTempPath()) ("carrotcap-media-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$proj = Join-Path $tmp "project"
$bin  = Join-Path $tmp "bin"
New-Item -ItemType Directory -Force -Path (Join-Path $proj "scripts"), (Join-Path $proj "agents"), $bin | Out-Null
Copy-Item (Join-Path $repo "scripts\run-media.ps1") (Join-Path $proj "scripts\run-media.ps1")
Copy-Item (Join-Path $repo "agents\media.md") (Join-Path $proj "agents\media.md")

# Fake grok: behaviour chosen by FAKE_GROK_MODE; with "write" it creates the log named in the prompt.
@'
@echo off
echo fake grok %*
if "%FAKE_GROK_MODE%"=="fail" exit /b 1
if "%FAKE_GROK_MODE%"=="write" (
  if not exist "%FAKE_GROK_PROJECT%\logs\media" mkdir "%FAKE_GROK_PROJECT%\logs\media"
  echo # Media Log> "%FAKE_GROK_PROJECT%\logs\media\%FAKE_GROK_LOG%"
)
exit /b 0
'@ | Set-Content -Encoding ASCII (Join-Path $bin "grok.cmd")

$env:PATH = "$bin;$env:PATH"
$env:FAKE_GROK_PROJECT = $proj
$pass = 0; $fail = 0
function Check($name, $cond) {
    if ($cond) { Write-Host "  PASS  $name"; $script:pass++ } else { Write-Host "  FAIL  $name"; $script:fail++ }
}
function Run($taskId, $slug, $mode) {
    $env:FAKE_GROK_MODE = $mode
    $env:FAKE_GROK_LOG = "$($taskId)_$($slug).md"
    try { & (Join-Path $proj "scripts\run-media.ps1") -TaskId $taskId -Slug $slug -Request "test" *> $null; return $true }
    catch { return $false }
}
$logDir = Join-Path $proj "logs\media"

try {
    Check "1. writes log -> success" (Run "t1" "ok" "write")
    Check "1. raw stdout deleted on success" (-not (Test-Path (Join-Path $logDir "t1_ok.grok-stdout.log")))

    Check "2. no log -> failure" (-not (Run "t2" "nolog" "silent"))
    Check "2. raw stdout kept on failure" (Test-Path (Join-Path $logDir "t2_nolog.grok-stdout.log"))

    "# old" | Set-Content (Join-Path $logDir "t3_stale.md")
    Check "3. stale existing log -> failure" (-not (Run "t3" "stale" "silent"))
    Check "3. previous log restored after the failed run" ((Get-Content (Join-Path $logDir "t3_stale.md") -Raw).Trim() -eq "# old")
    Check "3. re-run that writes the log -> success, no .prev left" ((Run "t3" "stale" "write") -and -not (Test-Path (Join-Path $logDir "t3_stale.md.prev")))

    Check "4. grok exit 1 -> failure" (-not (Run "t4" "exit" "fail"))
    Check "4. raw stdout kept" (Test-Path (Join-Path $logDir "t4_exit.grok-stdout.log"))

    Check "5. path-like TaskId rejected" (-not (Run "..\x" "ok" "write"))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "Summary: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
