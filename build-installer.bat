@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "CSC_IDENTITY_AUTO_DISCOVERY=false"
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dist:win

if errorlevel 1 (
  echo.
  echo [ERROR] Windows installer build failed.
  pause
  exit /b 1
)

echo.
echo [OK] Installer created in: %ROOT%release
pause
endlocal
