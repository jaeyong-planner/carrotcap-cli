@echo off
REM CARROTCAP CLI launcher (English-only to avoid codepage issues)
chcp 65001 >nul
setlocal ENABLEDELAYEDEXPANSION

set "ROOT=%~dp0"
cd /d "%ROOT%"
title CARROTCAP CLI

echo.
echo ============================================
echo   CARROTCAP CLI - launcher
echo   %ROOT%
echo ============================================
echo.

REM 0) If carrotcap is already installed system-wide (NSIS .cmd shim), prefer it.
REM    This avoids running 'npm install' on machines that already have the app.
where carrotcap >nul 2>nul
if not errorlevel 1 (
  REM Make sure the resolved 'carrotcap' is NOT this start.bat itself, otherwise infinite loop.
  for /f "delims=" %%I in ('where carrotcap') do (
    set "FOUND=%%I"
    goto :have_found
  )
  :have_found
  echo [carrotcap] Found existing install: !FOUND!
  if /I not "!FOUND!"=="%~f0" (
    echo [carrotcap] Launching existing install...
    call "!FOUND!" %*
    exit /b %ERRORLEVEL%
  )
)

REM 1) Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo   Install LTS from https://nodejs.org/ and re-run.
  echo   Tip: enable "Tools for Native Modules" during setup.
  echo.
  pause
  exit /b 1
)

REM 2) Check npm
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please verify your Node.js installation.
  echo.
  pause
  exit /b 1
)

REM 3) Decide whether dependencies are healthy.
REM    Two gates: (a) marker file .installed, (b) require('electron/package.json') succeeds.
set "INSTALLED_OK=0"
if exist "%ROOT%node_modules\.installed" (
  node -e "require('electron/package.json')" >nul 2>nul
  if not errorlevel 1 set "INSTALLED_OK=1"
)

if "%INSTALLED_OK%"=="1" (
  echo [carrotcap] Dependencies healthy - skipping install.
) else (
  echo [carrotcap] Installing dependencies (first run or cache invalidated)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [WARN] npm install reported errors.
    echo        If node-pty native build failed, the app will use fallback mode.
    echo        Installing Visual Studio Build Tools is recommended.
    echo.
  ) else (
    REM Write marker so next runs skip install.
    > "%ROOT%node_modules\.installed" echo carrotcap-installed %DATE% %TIME%
  )
)

echo.
echo [carrotcap] Starting Electron...
echo.

REM 4) Run
call npm start

REM 5) Keep window open on error
if errorlevel 1 (
  echo.
  echo [ERROR] App exited with errors. See log above.
  pause
)

endlocal
exit /b 0
