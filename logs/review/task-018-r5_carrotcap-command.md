# Review Report — task-018-r5 (`feature/v0.2.0..HEAD`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/test-validate-settings.js`, `scripts/repair-cli.ps1`, `INSTALLER.md`, `scripts/test-launchers.js`, `backlog/task-018.md`
- 변경 라인 수: 793 추가 / 221 삭제
- 리뷰 시점: 2026-09-26T23:52:44Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r4의 설치·제거 외부 데이터 삭제 위험은 차단됐지만, 배포본에 없는 복구 스크립트를 안내해 충돌 시 복구 경로가 실패합니다.

## 3. Critical 이슈

- [build/installer.nsh:60-106, 150-167] r4 Critical “설치 루트/하위 junction·reparse point가 update/uninstall에서 외부 데이터를 재귀 삭제할 수 있음” — **RESOLVED.** 루트 및 하위 디렉터리의 `FILE_ATTRIBUTE_REPARSE_POINT`를 검사하고, 발견 시 upgrade와 uninstall을 종료 코드 2로 중단합니다.
- [build/installer.nsh:160-166] r3 Critical “변조된 `InstallLocation`을 사용한 Settings uninstall 외부 경로 삭제” — **RESOLVED.** 전용 설치 경로와 불일치하면 제거 전에 중단합니다.
- [INSTALLER.md:58-63] r3 Critical “구 `Programs\carrotcap`/Cream CLI 경로의 uninstaller 실행 위험” — **RESOLVED.** 구 설치의 Settings uninstall 금지 및 수동 정리 절차가 명시됐습니다.
- [build/installer.nsh:108-156] r3 Critical “upgrade 시 기존 `InstallLocation` 재사용 삭제 위험” — **RESOLVED.** HKCU/HKLM 등록값 검증 및 `customInit`의 전용 경로 강제가 적용됐습니다.

## 4. Major 이슈

- [package.json:42-57] 설치 충돌 안내가 지시하는 `scripts\repair-cli.ps1`과 `INSTALLER.md`가 `build.files`에 포함되지 않습니다. 설치본의 `resources\app.asar`에는 두 파일이 없으므로, [build/installer.nsh:186], [renderer.js:52], [INSTALLER.md:46-50]의 복구 경로가 실제 one-click 사용자에게 실패합니다. → `repair-cli.ps1`와 필요한 안내 문서를 배포본에 포함하고, 설치 후 해당 경로에서 repair를 실행하는 integration test를 추가하십시오.
- [main.js:499-515] r4 Major “설치 위치 밖의 packaged copy가 launcher를 탈취” — **RESOLVED.** canonical 설치 경로 및 `realpath` 일치를 요구합니다.
- [scripts/repair-cli.ps1:69-95] r3 Major “실제 command-resolution 실패인데 성공 종료” — **RESOLVED.** PATH×PATHEXT 결과가 기대 launcher가 아니면 원인별 오류와 종료 코드 2를 반환합니다.
- [build/installer.nsh:178-201] r3 Major “foreign launcher 충돌이 one-click 사용자에게 보이지 않음” — **RESOLVED.** marker 없는 충돌을 MessageBox로 표시합니다.

## 5. Minor 이슈

- [main.js:486, build/installer.nsh:181-184, scripts/repair-cli.ps1:51] `.bat` launcher는 `%`만 escape합니다. `cmd /V:ON`에서 설치 경로에 `!NAME!`이 있으면 delayed expansion으로 executable path가 변형되어 실행에 실패할 수 있습니다. → batch 본문에서 `setlocal DisableDelayedExpansion`을 적용하고, `!` 포함 `%LOCALAPPDATA%` 경로와 `cmd /V:ON` 실행 테스트를 추가하십시오.
- [main.js:499-504, scripts/test-validate-settings.js:759-776] Windows 전용 helper를 macOS/Linux에서도 실행되는 `npm test`에 직접 추가했습니다. POSIX temp path는 `path.win32.join()` 결과와 `realpathSync.native()` 결과가 달라 “installed copy may self-register” assertion이 실패합니다. → 테스트를 Windows 전용으로 gate하거나 Windows path/filesystem을 mock하십시오.
- [build/installer.nsh:186] r4 Minor “foreign launcher 충돌 시 효과 없는 앱 실행 안내” — **RESOLVED.** 충돌 파일 점검·제거와 repair 절차를 안내합니다.
- [main.js:518-542, renderer.js:48-53] r3 Minor “self-heal 실패가 일반 사용자에게 보이지 않음” — **RESOLVED.** 실패 상태가 IPC를 통해 renderer의 상태 줄에 표시됩니다.
- [main.js:482-487, build/installer.nsh:176-197, scripts/repair-cli.ps1:48-52] r3 Minor “`%` 포함 경로 batch escaping” — **RESOLVED.** batch는 `%%`, Git Bash는 POSIX single quote escaping을 사용합니다.
- [scripts/test-launchers.js:91-110] r3 Minor “Git Bash 실제 command-resolution 검증” — **RESOLVED.**
- [scripts/test-launchers.js:113-118] r3 Minor “PowerShell 5.1/pwsh 7의 `.CMD` 우선 PATHEXT 검증” — **RESOLVED.**

## 6. Optional 제안

- [package.json:41] `${arch}`가 artifact name에서 제거되어 x64와 arm64를 같은 `release` 디렉터리에 생성하면 installer 파일명이 충돌합니다. r3 Optional — **UNRESOLVED.** multi-arch 배포 시 architecture별 output directory 또는 `${arch}`를 사용하십시오.

## 7. 최종 권고

- [ ] `scripts/repair-cli.ps1`와 repair 안내 문서를 packaged app에 포함하고 설치본에서 실행 가능함을 검증한다.
- [ ] `cmd /V:ON` 및 `!` 포함 설치 경로에서 `.bat` launcher가 정확한 executable을 실행하는 테스트를 추가한다.
- [ ] macOS/Linux의 `npm test`가 Windows-only canonical-install assertion 때문에 실패하지 않도록 테스트를 분리한다.
- [ ] root junction, 하위 junction, 변조된 `InstallLocation`, Cream CLI 공존 상태의 canary 보존 Windows integration test를 CI 또는 release checklist에 고정한다.