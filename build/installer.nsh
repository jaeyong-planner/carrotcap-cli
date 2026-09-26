; CARROTCAP CLI - NSIS customizations (one-click, per-user)
; Goal: double-clicking the setup installs, starts the app, and `carrotcap` opens it
; from any new terminal (task-018).
;
; - Own folder: $LOCALAPPDATA\Programs\carrotcap-cli. Never $LOCALAPPDATA\Programs\carrotcap:
;   that is the parent of the separate Cream CLI install, and electron-builder removes
;   $INSTDIR recursively on uninstall/upgrade. An existing install anywhere else stops
;   the setup instead of being reused (review task-018 r1).
; - Command: WindowsApps\carrotcap.bat (cmd / PowerShell) + extensionless carrotcap
;   (Git Bash). Cream CLI keeps rewriting WindowsApps\carrotcap.cmd; .BAT comes before
;   .CMD in the default PATHEXT, so ours wins without touching Cream's files (its aor.cmd
;   stays as it is). Assumes WindowsApps is on PATH (Windows 10/11 default) and the
;   default PATHEXT order.
; - Ownership: our launchers carry the marker line below. A file with that name that
;   lacks the marker, a link or a folder is never written or deleted.
; - The user PATH is NOT edited: NSIS strings are length-limited and a long PATH would
;   be written back truncated.

!include "WordFunc.nsh"

!define CC_MARK "CARROTCAP-CLI-LAUNCHER"
!define CC_SHIMDIR "$LOCALAPPDATA\Microsoft\WindowsApps"

; $R9 = "ok" when PATH may be written/removed by us: missing, or a plain file (no
; directory / reparse point) whose second line is our marker. Registers are preserved.
!macro CC_CanOwn PATH
  Push $R4
  Push $R5
  Push $R6
  Push $R7
  StrCpy $R9 "no"
  System::Call 'kernel32::GetFileAttributesW(w "${PATH}") i .R7'
  ${If} $R7 == -1
    StrCpy $R9 "ok"
  ${Else}
    IntOp $R6 $R7 & 0x410 ; FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT
    ${If} $R6 == 0
      ClearErrors
      FileOpen $R5 "${PATH}" r
      ${IfNot} ${Errors}
        FileRead $R5 $R4
        FileRead $R5 $R4
        FileClose $R5
        ${If} $R4 == "rem ${CC_MARK}$\r$\n"
        ${OrIf} $R4 == "# ${CC_MARK}$\n"
          StrCpy $R9 "ok"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
!macroend

; Refuses to run when the uninstall entry for our appId belongs to something else or
; lives outside our folder: electron-builder would run THAT uninstaller and install over
; it. This happened on 2026-09-27 when CARROTCAP shared Cream CLI's appId (the entry had
; no InstallLocation, so only checking that value was not enough).
!macro preInit
  SetRegView 64
  ; perMachine: false matches per-user install. Avoids requiring UAC elevation.
  ; electron-builder defines UNINSTALL_APP_KEY (NOT UNINSTALL_KEY).
  StrCpy $3 "$LOCALAPPDATA\Programs\carrotcap-cli"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayName"
  ReadRegStr $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "InstallLocation"
  ${if} "$0$1$2" != ""
    StrCpy $7 "ours"
    StrCpy $4 $0 13                       ; DisplayName must start with "CARROTCAP CLI"
    ${if} $4 != "CARROTCAP CLI"
      StrCpy $7 "foreign"
    ${endif}
    StrLen $5 '"$3\'
    StrCpy $6 $1 $5                       ; uninstaller must be "<our folder>\...
    ${if} $6 != '"$3\'
      StrCpy $7 "foreign"
    ${endif}
    ${if} "$2" != ""
    ${andif} "$2" != "$3"
      StrCpy $7 "foreign"
    ${endif}
    ${if} $7 == "foreign"
      MessageBox MB_OK|MB_ICONSTOP "Another installation is registered under this app's ID:$\r$\n$0$\r$\n$1$\r$\n$\r$\nSetup stopped so it is not removed. Uninstall it from Settings > Apps if it is an old CARROTCAP CLI, then run this setup again." /SD IDOK
      Quit
    ${endif}
  ${endif}
  StrCpy $INSTDIR $3
!macroend

!macro customInstall
  Push $0
  Push $1
  Push $R9
  CreateDirectory "${CC_SHIMDIR}"

  !insertmacro CC_CanOwn "${CC_SHIMDIR}\carrotcap.bat"
  ${If} $R9 == "ok"
    FileOpen $0 "${CC_SHIMDIR}\carrotcap.bat" w
    FileWrite $0 `@echo off$\r$\n`
    FileWrite $0 `rem ${CC_MARK}$\r$\n`
    FileWrite $0 `start "" "$INSTDIR\carrotcap.exe" %*$\r$\n`
    FileClose $0
  ${Else}
    DetailPrint "Skipped ${CC_SHIMDIR}\carrotcap.bat (belongs to another program)"
  ${EndIf}

  ; Git Bash: C:/path/carrotcap.exe in single quotes, run in the background.
  ${WordReplace} "$INSTDIR\carrotcap.exe" "\" "/" "+" $1
  ${WordReplace} "$1" "'" "'\''" "+" $1
  !insertmacro CC_CanOwn "${CC_SHIMDIR}\carrotcap"
  ${If} $R9 == "ok"
    FileOpen $0 "${CC_SHIMDIR}\carrotcap" w
    FileWrite $0 `#!/bin/sh$\n`
    FileWrite $0 `# ${CC_MARK}$\n`
    FileWrite $0 `'$1' "$$@" >/dev/null 2>&1 &$\n`
    FileClose $0
  ${Else}
    DetailPrint "Skipped ${CC_SHIMDIR}\carrotcap (belongs to another program)"
  ${EndIf}
  Pop $R9
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  Push $R9
  ; Only our own launchers (marker checked) — Cream CLI's carrotcap.cmd / aor.cmd stay.
  !insertmacro CC_CanOwn "${CC_SHIMDIR}\carrotcap.bat"
  ${If} $R9 == "ok"
    Delete "${CC_SHIMDIR}\carrotcap.bat"
  ${EndIf}
  !insertmacro CC_CanOwn "${CC_SHIMDIR}\carrotcap"
  ${If} $R9 == "ok"
    Delete "${CC_SHIMDIR}\carrotcap"
  ${EndIf}
  Pop $R9
!macroend
