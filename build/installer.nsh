; CARROTCAP CLI - NSIS customizations
; Goal: after running the .exe installer, `carrotcap` and `aor` must be available
; from any new PowerShell / cmd session, even if %LOCALAPPDATA%\Microsoft\WindowsApps
; is not on PATH for some reason.

!include "WinMessages.nsh"

!macro preInit
  SetRegView 64
  ; perMachine: false matches per-user install. Avoids requiring UAC elevation.
  ; electron-builder defines UNINSTALL_APP_KEY (NOT UNINSTALL_KEY).
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ${if} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\carrotcap"
  ${endif}
!macroend

!macro customInstall
  ; --- 1) Primary: drop command shims into %LOCALAPPDATA%\Microsoft\WindowsApps.
  ;     On Windows 10/11 this folder is on the user PATH by default.
  CreateDirectory "$LOCALAPPDATA\Microsoft\WindowsApps"
  FileOpen $0 "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.cmd" w
  FileWrite $0 `@echo off$\r$\n`
  FileWrite $0 `start "" "$INSTDIR\carrotcap.exe" %*$\r$\n`
  FileClose $0
  FileOpen $0 "$LOCALAPPDATA\Microsoft\WindowsApps\aor.cmd" w
  FileWrite $0 `@echo off$\r$\n`
  FileWrite $0 `start "" "$INSTDIR\carrotcap.exe" %*$\r$\n`
  FileClose $0

  ; --- 2) Fallback: also append $INSTDIR to the user PATH.
  ;     Keep this plugin-free: electron-builder's bundled NSIS does not ship
  ;     the EnVar plugin. The packaged app also self-heals this registration
  ;     on launch, so this installer step is only the first pass.
  ReadRegStr $0 HKCU "Environment" "Path"
  ${if} $0 == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  ${else}
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  ${endif}

  ; --- 3) Broadcast WM_SETTINGCHANGE so newly opened terminals pick up the new PATH
  ;     immediately. Already-running shells must still be reopened.
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
!macroend

!macro customUnInstall
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.cmd"
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\aor.cmd"

  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=3000
!macroend
