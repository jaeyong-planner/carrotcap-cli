# Review Report — task-018 (`feature/v0.2.0..HEAD`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/test-validate-settings.js`, `scripts/repair-cli.ps1`, `INSTALLER.md`, `scripts/test-launchers.js`, `backlog/task-018.md`
- 변경 라인 수: 474 추가 / 219 삭제 (8개 파일, 리뷰 로그 제외)
- 리뷰 시점: 2026-09-26T23:39:36Z

## 2. 전체 판단

- ❌ 반려
- installer upgrade 경로는 보강됐지만, Settings에서 실행하는 uninstaller가 변조된 `InstallLocation`을 따라 외부 디렉터리를 재귀 삭제할 수 있습니다.

## 3. Critical 이슈

- [build/installer.nsh:102-106] `customInit`은 installer에서만 `$INSTDIR`을 전용 폴더로 강제합니다. electron-builder uninstaller는 registry `InstallLocation`을 다시 읽은 뒤 `customUnInit`을 호출하고 `$INSTDIR`을 재귀 삭제합니다. 따라서 `HKCU\Software\<APP_GUID>\InstallLocation`이 외부 경로로 변조된 상태에서 Settings > Apps uninstall을 실행하면 해당 외부 경로가 삭제될 수 있습니다. → `customUnInit`에서 `$INSTDIR`이 정확히 `%LOCALAPPDATA%\Programs\carrotcap-cli`인지 검증하고, 불일치하면 `SetErrorLevel 2` 후 즉시 중단해야 합니다.
- [INSTALLER.md:58-63] r2 Critical “구 설치 위치의 uninstaller 실행 안내” — **RESOLVED.** 구 `Programs\carrotcap`/Cream CLI 경로의 uninstaller 실행을 금지하고 수동 정리 절차로 변경했습니다.
- [build/installer.nsh:62-106] r2 Critical “upgrade 시 기존 `InstallLocation` 재사용 삭제 위험” — **RESOLVED.** HKCU/HKLM의 실제 `INSTALL_REGISTRY_KEY\InstallLocation`을 전용 경로와 비교하고, `initMultiUser` 이후에도 설치 경로를 강제합니다. 단, 위 direct-uninstall 경로는 별도 Critical 이슈입니다.

## 4. Major 이슈

- [scripts/repair-cli.ps1:75-76] `where.exe` 결과가 `carrotcap.bat`이 아니어도 warning만 출력한 뒤 “`carrotcap` works” 성공 메시지를 출력하고 종료 코드 0으로 끝납니다. WindowsApps 미포함 PATH, `.CMD` 우선 PATHEXT, 선행 `.exe`/`.com`에서는 실제 기능이 실패합니다. → 기대 launcher가 아니면 `Write-Err`와 구체적 조치 안내를 출력하고 non-zero로 종료하십시오. r2 Major “repair 결과 판정” — **UNRESOLVED.**
- [build/installer.nsh:121-136] r2 Major “foreign launcher 충돌이 사용자에게 보이지 않음” — **RESOLVED.** one-click 설치에서도 marker 없는 launcher 충돌을 MessageBox로 표시합니다.

## 5. Minor 이슈

- [main.js:482-487] `%`를 포함한 합법적인 Windows profile/install path는 `buildLaunchShims()`가 거부합니다. 반면 installer는 같은 경로를 batch에 그대로 기록하므로 `%NAME%` 확장으로 실행 경로가 깨지고, 앱 self-heal과 repair script도 이를 복구하지 않습니다. → batch용 경로에서는 `%`를 `%%`로 escape하고, Git Bash용 경로와 byte-identical 생성 규칙을 맞춘 뒤 `%` 포함 경로 테스트를 추가하십시오.
- [scripts/test-launchers.js:90-102] Git Bash integration test는 `C:\Program Files\Git\bin\bash.exe`에만 의존하며, 다른 설치 위치 또는 미설치 환경에서는 성공 상태로 skip됩니다. → `where.exe bash` 등으로 실제 Bash를 탐색하고, Git Bash 검증을 실행하지 못한 경우 CI에서 명시적으로 skip 사유를 보고하십시오. r2 Minor “Git Bash 실제 command-resolution 검증” — **PARTIAL.**
- [scripts/test-launchers.js:104-106] `.CMD` 우선 PATHEXT 한계는 cmd에서만 검증합니다. PowerShell 5.1 및 pwsh 7에서도 변경 PATHEXT 시 Cream launcher가 선택되는지 또는 다른 command-resolution 규칙이 적용되는지 검증하지 않습니다. → 두 PowerShell 버전에도 동일한 altered-PATHEXT integration case를 추가하십시오. r2 Minor “cmd/PowerShell quoting 및 PATHEXT 검증” — **PARTIAL.**
- [main.js:505-527] app self-heal이 launcher 충돌·WindowsApps 접근 실패를 console warning으로만 남깁니다. 일반 사용자는 Start Menu에서 앱을 열어도 command registration 실패를 알 수 없습니다. → launcher 확보 실패 상태를 UI 또는 실행 가능한 repair 안내로 노출하십시오. r2에서 인용된 self-heal feedback 이슈 — **UNRESOLVED**; 단, foreign 파일을 덮어쓰지 않는 소유권 보호 자체는 **RESOLVED**입니다.

## 6. Optional 제안

- [package.json:41] `${arch}`가 artifact name에서 제거되어 x64/arm64를 같은 output directory에 빌드하면 setup 파일명이 충돌합니다. → 다중 architecture 배포 시 `${arch}`를 artifact name에 복원하거나 output directory를 architecture별로 분리하십시오. r2 Optional 제안 — **UNRESOLVED.**

## 7. 최종 권고

- [ ] `customUnInit`에 전용 install directory 검증을 추가해 Settings uninstall의 외부 경로 재귀 삭제를 차단한다.
- [ ] `repair-cli.ps1`이 기대 launcher를 찾지 못하면 non-zero 실패와 실행 가능한 복구 지침을 반환하게 한다.
- [ ] `%` 포함 profile path에서 installer, self-heal, repair script가 동일하게 안전한 launcher를 생성하는지 검증한다.
- [ ] cmd, PowerShell 5.1, pwsh 7, Git Bash에서 기본 및 `.CMD` 우선 PATHEXT의 해석 결과와 인수 전달을 integration test로 실행한다.
- [ ] direct uninstall, registry `InstallLocation` 변조, self-upgrade, foreign launcher 충돌 각각에서 Cream CLI 및 외부 디렉터리 보존을 Windows integration test로 확인한다.