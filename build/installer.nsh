; CARROTCAP CLI — NSIS install hooks
; Behaviors:
;  1) Default install path: %LOCALAPPDATA%\Programs\CARROTCAP CLI
;     (Per-user install — no admin elevation required.)
;  2) Create %LOCALAPPDATA%\Microsoft\WindowsApps\carrotcap.cmd shim so users
;     can launch the app from any PowerShell with `carrotcap`.

!macro preInit
  SetRegView 64
  ; electron-builder defines UNINSTALL_APP_KEY (NOT UNINSTALL_KEY — that's a frequent typo).
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ${if} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\CARROTCAP CLI"
  ${endif}
!macroend

!macro customInstall
  ; Create per-user PATH shim: `carrotcap` works in any new PowerShell session.
  CreateDirectory "$LOCALAPPDATA\Microsoft\WindowsApps"
  FileOpen $0 "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.cmd" w
  FileWrite $0 `@echo off$\r$\n`
  FileWrite $0 `start "" "$INSTDIR\carrotcap.exe" %*$\r$\n`
  FileClose $0
!macroend

!macro customUnInstall
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.cmd"
!macroend
