; CARROTCAP CLI - NSIS customizations (one-click, per-user)
; Goal: double-clicking the setup installs, starts the app, and `carrotcap` opens it
; from any new terminal (task-018).
;
; - Own appId (com.carrotcap.carrotcap-cli) and own folder $LOCALAPPDATA\Programs\carrotcap-cli.
;   On 2026-09-27 CARROTCAP still shared Cream CLI's appId: electron-builder treated Cream
;   as the old version, ran Cream's uninstaller and installed over it.
; - electron-builder removes an existing install before installing: it runs the uninstaller
;   named in the Uninstall key, on the folder in Software\<GUID>\InstallLocation, and that
;   uninstaller deletes the folder recursively. So the setup STOPS unless every existing
;   entry for our appId (HKCU and HKLM) is a CARROTCAP CLI inside our own folder.
; - Command: WindowsApps\carrotcap.bat (cmd / PowerShell) + extensionless carrotcap
;   (Git Bash). Cream CLI rewrites WindowsApps\carrotcap.cmd; .BAT comes before .CMD in the
;   default PATHEXT, so ours wins without touching Cream's files. Assumes WindowsApps on
;   PATH (Windows 10/11 default) and the default PATHEXT order.
; - Ownership: our launchers carry the marker line below. A file with that name that
;   lacks the marker, a link or a folder is never written or deleted.
; - The user PATH is NOT edited: NSIS strings are length-limited and a long PATH would
;   be written back truncated.

!include "WordFunc.nsh"

!define CC_MARK "CARROTCAP-CLI-LAUNCHER"
!define CC_SHIMDIR "$LOCALAPPDATA\Microsoft\WindowsApps"
!define CC_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"

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

; Links inside our folder (review task-018 r4): electron-builder deletes $INSTDIR
; recursively on upgrade/uninstall, so a junction in there (or $INSTDIR itself being one)
; could reach someone else's files. Refuse if any is found. CC_Found = first link found.
Var CC_Found
!macro CC_ReparseCallback UN
; (Defined when this file is included — before LogicLib — so plain jumps, no ${If}.)
Function ${UN}CC_ReparseCb
  Push $0
  System::Call 'kernel32::GetFileAttributesW(w "$R9") i .r0'
  IntOp $0 $0 & 0x400 ; FILE_ATTRIBUTE_REPARSE_POINT
  IntCmp $0 0 cc_plain_${UN}
    StrCpy $CC_Found "$R9"
    Pop $0
    Push "StopLocate"
    Return
  cc_plain_${UN}:
    Pop $0
    Push ""
FunctionEnd
!macroend
!ifdef BUILD_UNINSTALLER
  !insertmacro CC_ReparseCallback "un."
!else
  !insertmacro CC_ReparseCallback ""
!endif

!macro CC_RefuseLinks CB
  Push $0
  Push $1
  StrCpy $CC_Found ""
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .r0'
  ${If} $0 != -1
    IntOp $1 $0 & 0x400
    ${If} $1 != 0
      StrCpy $CC_Found "$INSTDIR"
    ${Else}
      ${Locate} "$INSTDIR" "/L=D /G=1" "${CB}"
    ${EndIf}
  ${EndIf}
  Pop $1
  Pop $0
  ${If} $CC_Found != ""
    MessageBox MB_OK|MB_ICONSTOP "$CC_Found$\r$\nis a link or junction inside the CARROTCAP CLI folder. Removing the folder could delete the files it points to, so nothing was changed. Remove the link, then try again." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

; Quits unless the existing registration under ROOT (HKCU / HKLM) is absent or is a
; CARROTCAP CLI inside $3 (our folder). Uses $0-$2, $4-$7.
!macro CC_GuardRoot ROOT
  ReadRegStr $0 ${ROOT} "${CC_UNINSTALL_KEY}" "DisplayName"
  ReadRegStr $1 ${ROOT} "${CC_UNINSTALL_KEY}" "UninstallString"
  ReadRegStr $2 ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
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
    ${if} $2 != $3                        ; the folder the old uninstaller would delete
      StrCpy $7 "foreign"
    ${endif}
    ${if} $7 == "foreign"
      MessageBox MB_OK|MB_ICONSTOP "Another installation is registered under this app's ID:$\r$\n$0$\r$\n$1$\r$\n$2$\r$\n$\r$\nSetup stopped so nothing is removed. If it is an old CARROTCAP CLI in a folder shared with other programs (for example next to Cream CLI), do NOT uninstall it from Settings: its uninstaller deletes the whole folder. Remove its own files and registry entry by hand (INSTALLER.md, $\"Upgrade from an older install location$\"), then run this setup again." /SD IDOK
      SetErrorLevel 2
      Quit
    ${endif}
  ${endif}
!macroend

!macro preInit
  SetRegView 64
  StrCpy $3 "$LOCALAPPDATA\Programs\carrotcap-cli"
  ; preInit also runs in the build-time pass that only writes the uninstaller — the
  ; build machine's registry must not stop the build.
  !ifndef BUILD_UNINSTALLER
    !insertmacro CC_GuardRoot HKCU
    !insertmacro CC_GuardRoot HKLM
  !endif
  StrCpy $INSTDIR $3
!macroend

; After electron-builder's initMultiUser (which re-reads the registry and /D): the install
; folder is always ours.
!macro customInit
  ${if} $INSTDIR != "$LOCALAPPDATA\Programs\carrotcap-cli"
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\carrotcap-cli"
  ${endif}
  ; before an existing install is removed for the upgrade
  !insertmacro CC_RefuseLinks "CC_ReparseCb"
!macroend

; The uninstaller re-reads InstallLocation from the registry and deletes $INSTDIR
; recursively. Refuse unless it is exactly our folder (review task-018 r3).
!macro customUnInit
  ${if} $INSTDIR != "$LOCALAPPDATA\Programs\carrotcap-cli"
    MessageBox MB_OK|MB_ICONSTOP "This uninstaller would remove$\r$\n$INSTDIR$\r$\nwhich is not the CARROTCAP CLI folder ($LOCALAPPDATA\Programs\carrotcap-cli). Nothing was removed; see $LOCALAPPDATA\Programs\carrotcap-cli\resources\INSTALLER.md." /SD IDOK
    SetErrorLevel 2
    Quit
  ${endif}
  !insertmacro CC_RefuseLinks "un.CC_ReparseCb"
!macroend

!macro customInstall
  Push $0
  Push $1
  Push $2
  Push $R9
  CreateDirectory "${CC_SHIMDIR}"

  ; cmd would expand %NAME% inside the path: escape % as %% (same as main.js).
  ${WordReplace} "$INSTDIR\carrotcap.exe" "%" "%%" "+" $2
  !insertmacro CC_CanOwn "${CC_SHIMDIR}\carrotcap.bat"
  ${If} $R9 == "ok"
    FileOpen $0 "${CC_SHIMDIR}\carrotcap.bat" w
    FileWrite $0 `@echo off$\r$\n`
    FileWrite $0 `rem ${CC_MARK}$\r$\n`
    FileWrite $0 `setlocal DisableDelayedExpansion$\r$\n`
    FileWrite $0 `start "" "$2" %*$\r$\n`
    FileClose $0
  ${Else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "CARROTCAP CLI is installed, but the `carrotcap` command was not registered: another program owns$\r$\n${CC_SHIMDIR}\carrotcap.bat$\r$\n$\r$\nCheck or remove that file, then run$\r$\n$INSTDIR\resources\repair-cli.ps1$\r$\n(see $INSTDIR\resources\INSTALLER.md). Meanwhile use the Start Menu or Desktop shortcut." /SD IDOK
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
    MessageBox MB_OK|MB_ICONEXCLAMATION "The Git Bash `carrotcap` command was not registered: another program owns$\r$\n${CC_SHIMDIR}\carrotcap" /SD IDOK
  ${EndIf}
  Pop $R9
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  Push $R9
  ; Only our own launchers (marker checked) — other programs' carrotcap.cmd / aor.cmd stay.
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
