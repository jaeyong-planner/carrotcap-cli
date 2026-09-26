; CARROTCAP CLI - NSIS customizations (one-click, per-user)
; Goal: double-clicking the setup installs, starts the app, and `carrotcap` opens it
; from any new terminal (task-018).
;
; - Own folder: $LOCALAPPDATA\Programs\carrotcap-cli. Never $LOCALAPPDATA\Programs\carrotcap:
;   that is the parent of the separate Cream CLI install, and the uninstaller removes
;   $INSTDIR recursively.
; - Command: WindowsApps\carrotcap.bat. Cream CLI keeps rewriting WindowsApps\carrotcap.cmd,
;   and .BAT comes before .CMD in PATHEXT, so ours wins without touching Cream's files
;   (its aor.cmd stays as it is). The app writes the Git Bash launcher on first start.
; - The user PATH is NOT edited here: NSIS strings are length-limited and a long PATH
;   would be written back truncated.

!macro preInit
  SetRegView 64
  ; perMachine: false matches per-user install. Avoids requiring UAC elevation.
  ; electron-builder defines UNINSTALL_APP_KEY (NOT UNINSTALL_KEY).
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ${if} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\carrotcap-cli"
  ${endif}
!macroend

!macro customInstall
  CreateDirectory "$LOCALAPPDATA\Microsoft\WindowsApps"
  FileOpen $0 "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.bat" w
  FileWrite $0 `@echo off$\r$\n`
  FileWrite $0 `start "" "$INSTDIR\carrotcap.exe" %*$\r$\n`
  FileClose $0
!macroend

!macro customUnInstall
  ; Only our own launchers — Cream CLI's carrotcap.cmd / aor.cmd are left alone.
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap.bat"
  Delete "$LOCALAPPDATA\Microsoft\WindowsApps\carrotcap"
!macroend
