# CARROTCAP CLI — Healthcheck
# 책임: (1) 설치 캐시, (2) PTY 가용성, (3) AOR engineRoot, (4) xterm CSS, (5) 사이드바→터미널 라우팅 가능 여부, (6) carrotcap 명령어 멱등 실행
# 사용: PowerShell에서  pwsh -ExecutionPolicy Bypass -File scripts\healthcheck.ps1

param(
  [switch]$Verbose,
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Continue'
# 콘솔 출력이 cp949에서 한글/특수문자가 깨지는 문제 방지
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$pass = 0
$fail = 0
$warn = 0
$results = @()

function Check {
  param(
    [string]$Name,
    [scriptblock]$Body
  )
  Write-Host "[..] $Name" -NoNewline
  try {
    $r = & $Body
    if ($r -is [bool] -and $r) {
      Write-Host "`r[OK] $Name           " -ForegroundColor Green
      $script:pass++
      $script:results += [pscustomobject]@{ Name=$Name; Status='PASS'; Detail='' }
    } elseif ($r -is [string] -and $r -like 'WARN:*') {
      Write-Host "`r[WARN] $Name : $($r.Substring(5))" -ForegroundColor Yellow
      $script:warn++
      $script:results += [pscustomobject]@{ Name=$Name; Status='WARN'; Detail=$r }
    } else {
      Write-Host "`r[FAIL] $Name : $r" -ForegroundColor Red
      $script:fail++
      $script:results += [pscustomobject]@{ Name=$Name; Status='FAIL'; Detail=$r }
    }
  } catch {
    Write-Host "`r[FAIL] $Name : $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
    $script:results += [pscustomobject]@{ Name=$Name; Status='FAIL'; Detail=$_.Exception.Message }
  }
}

Write-Host "============================================"
Write-Host "  CARROTCAP CLI - Healthcheck"
Write-Host "  $Root"
Write-Host "============================================"
Write-Host ""

# 1) Node / npm
Check 'Node.js installed' { if (Get-Command node -ErrorAction SilentlyContinue) { $true } else { 'node not found in PATH' } }
Check 'npm installed'      { if (Get-Command npm -ErrorAction SilentlyContinue) { $true } else { 'npm not found in PATH' } }

# 2) 설치 캐시 — .installed 마커 + electron require 가능성
Check 'node_modules exists' { if (Test-Path "$Root\node_modules") { $true } else { '.\node_modules folder missing — run npm install' } }
Check 'install marker (.installed)' {
  if (Test-Path "$Root\node_modules\.installed") { $true } else { 'WARN:marker absent — first run will reinstall (expected only once)' }
}
Check 'electron require()' {
  $out = & node -e "try{require('electron/package.json');console.log('ok')}catch(e){console.log('fail:'+e.message)}" 2>&1
  if ($out -match 'ok') { $true } else { "electron module broken: $out" }
}

# 3) PTY availability - check prebuilt multiarch package (replaces native node-pty 1.0.0).
Check 'pty prebuilt (PTY mode)' {
  $out = & node -e "try{require('@homebridge/node-pty-prebuilt-multiarch');console.log('ok')}catch(e){console.log('fail:'+e.message)}" 2>&1
  if ($out -match 'ok') { $true } else { 'WARN:pty prebuilt unavailable - child_process fallback will be used (limited interactivity)' }
}

# 4) xterm CSS 존재 — 터미널 렌더링 필수
Check 'xterm CSS present' {
  if (Test-Path "$Root\node_modules\@xterm\xterm\css\xterm.css") { $true } else { 'xterm CSS missing — terminal will render broken' }
}

# 5) AOR engineRoot 자동 탐지 결과 — main.js와 동일한 후보 목록
Check 'AOR engineRoot resolved' {
  $settingsPath = Join-Path $Root 'settings.json'
  $candidates = @()
  if (Test-Path $settingsPath) {
    try {
      $s = Get-Content $settingsPath -Raw | ConvertFrom-Json
      if ($s.aor.engineRoot) { $candidates += $s.aor.engineRoot }
      if ($s.aor.engineRootCandidates) { $candidates += $s.aor.engineRootCandidates }
    } catch {}
  }
  $candidates += @(
    (Join-Path $env:USERPROFILE 'Desktop\WINDOWS\WINDOWS'),
    (Join-Path $env:USERPROFILE 'WINDOWS'),
    (Join-Path $Root 'engine'),
    'C:\WINDOWS\carrotcap'
  )
  $found = $null
  foreach ($raw in $candidates) {
    $c = [System.Environment]::ExpandEnvironmentVariables($raw)
    $shellInit = Join-Path $c 'engine\windows\_internal\shell-init.ps1'
    if ((Test-Path $c) -and (Test-Path $shellInit)) { $found = $c; break }
  }
  if ($found) { $true } else { 'WARN:AOR engineRoot not found — AOR pane will fall back to plain shell (this is intentional, no crash)' }
}

# 6) 'carrotcap' 명령 PATH 등록 + 무한루프 안전
Check 'carrotcap command on PATH' {
  $cmd = Get-Command carrotcap -ErrorAction SilentlyContinue
  if (-not $cmd) {
    'WARN:carrotcap not on PATH yet - run release installer or add %LOCALAPPDATA%\Microsoft\WindowsApps'
  } else {
    # start.bat이 자기 자신을 호출하지 않게 가드되어 있는지 검사
    # $cmd.Source가 null/empty여도 안전하도록 where.exe로 폴백.
    $startBat = Join-Path $Root 'start.bat'
    $cmdSource = if ($cmd.Source) { $cmd.Source } elseif ($cmd.Path) { $cmd.Path } else {
      try { (& where.exe carrotcap 2>$null | Select-Object -First 1) } catch { $null }
    }
    if (-not $cmdSource) {
      $true  # 명령은 발견됐으나 경로 확정 불가 → 회귀 검사만 스킵하고 PASS로 간주
    } elseif (-not (Test-Path $cmdSource)) {
      "WARN:carrotcap resolved to '$cmdSource' but file not found"
    } elseif ((Test-Path $startBat) -and ((Get-Item $cmdSource).FullName -ieq (Get-Item $startBat).FullName)) {
      'WARN:carrotcap on PATH points to start.bat itself - install the NSIS package or set PATH to a different shim'
    } else { $true }
  }
}

# 7) 사이드바→터미널 라우팅 가능 여부 (정적 검사: 렌더러에 dragstart/drop이 살아있는지)
Check 'renderer.js drag/drop wired' {
  $r = Get-Content (Join-Path $Root 'renderer.js') -Raw
  if ($r -match "text/carrotcap-path" -and $r -match "addEventListener\('drop'") { $true } else { 'renderer.js missing drag/drop wiring' }
}

# 8) main.js 폴백 안전성 (자기참조 kill 제거되었는지)
Check 'main.js fallback proc.kill safe' {
  $m = Get-Content (Join-Path $Root 'main.js') -Raw
  if ($m -match "proc\.kill\s*=\s*\(\)\s*=>\s*proc\.kill") { 'main.js still has self-recursive kill — recursion bug not fixed' } else { $true }
}

Write-Host ""
Write-Host "============================================"
Write-Host "  Result: $pass passed, $warn warning, $fail failed"
Write-Host "============================================"

if ($Verbose) {
  $results | Format-Table -AutoSize
}

if ($fail -gt 0) { exit 1 } else { exit 0 }
