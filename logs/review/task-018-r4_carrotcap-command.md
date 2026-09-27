# Review Report — task-018-r4 (`feature/v0.2.0..HEAD`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/repair-cli.ps1`, `scripts/test-launchers.js`, `scripts/test-validate-settings.js`, `INSTALLER.md`, `backlog/task-018.md`
- 변경 라인 수: 536 추가 / 219 삭제 (리뷰 로그 제외)
- 리뷰 시점: 2026-09-26T23:45:01Z

## 2. 전체 판단

- ❌ 반려
- `InstallLocation` 문자열 변조 방어는 해결됐지만, 전용 설치 폴더 내부/자체의 junction·reparse point를 따라 electron-builder uninstaller가 외부 데이터를 재귀 처리할 수 있습니다.

## 3. Critical 이슈

- [build/installer.nsh:102-115] `$INSTDIR`의 문자열만 전용 경로와 비교하며, 해당 경로 또는 하위 디렉터리가 junction/reparse point인지 검사하지 않습니다. electron-builder의 update/uninstall 흐름은 `$INSTDIR`을 재귀 순회·삭제하므로, 예를 들어 `Programs\carrotcap-cli\resources` 또는 설치 루트가 Cream CLI/외부 폴더를 가리키는 junction이면 외부 파일을 이동·삭제할 수 있습니다. → installer와 uninstaller에서 루트 및 재귀 삭제 전 하위 경로의 `FILE_ATTRIBUTE_REPARSE_POINT`를 검사해 중단하고, root/child junction을 각각 둔 upgrade·Settings uninstall 보존 테스트를 추가하십시오.
- [build/installer.nsh:110-115] r3 Critical “변조된 `InstallLocation`을 사용한 Settings uninstall 외부 경로 삭제” — **RESOLVED.** `customUnInit`이 전용 경로와 불일치하면 종료 코드 2로 중단합니다.
- [INSTALLER.md:58-63] r3 Critical “구 `Programs\carrotcap`/Cream CLI 경로 uninstaller 실행 위험” — **RESOLVED.** 구 설치 제거 프로그램 실행 금지와 수동 정리 절차가 명시됐습니다.
- [build/installer.nsh:62-106] r3 Critical “upgrade 시 기존 `InstallLocation` 재사용 삭제 위험” — **RESOLVED.** HKCU/HKLM 등록값 검증 및 `customInit` 경로 강제가 적용됐습니다.

## 4. Major 이슈

- [main.js:497-505] self-heal 대상이 “packaged 상태이며 파일명이 `carrotcap.exe`인 모든 실행 파일”입니다. 전용 설치 폴더 밖의 오래된 복사본이나 임의의 packaged Electron 실행 파일도 실행만 하면 WindowsApps의 우리 launcher를 자기 경로로 영구 변경할 수 있습니다. → self-registration은 canonical `%LOCALAPPDATA%\Programs\carrotcap-cli\carrotcap.exe` 및 non-reparse 실제 경로로 제한하고, 다른 경로는 명시적으로 사용자가 실행한 repair 절차만 허용하십시오.
- [scripts/repair-cli.ps1:76-95] r3 Major “실제 command-resolution 실패인데 성공 종료” — **RESOLVED.** PATH×PATHEXT 결과가 기대 launcher와 다르면 원인별 오류와 종료 코드 2를 반환합니다.
- [build/installer.nsh:127-150] r3 Major “foreign launcher 충돌이 사용자에게 보이지 않음” — **RESOLVED.** one-click 설치에서도 marker 없는 launcher 충돌을 MessageBox로 알립니다.

## 5. Minor 이슈

- [build/installer.nsh:135] `carrotcap.bat`이 다른 프로그램 소유여서 등록하지 못한 경우에도 “Start CARROTCAP CLI from the Start Menu or Desktop”을 해결책으로 안내합니다. [main.js:517-520]의 self-heal도 같은 foreign file을 의도적으로 건너뛰므로, 앱 실행은 충돌을 해결하지 못합니다. → 해당 문구를 충돌 파일을 확인·제거하거나 `repair-cli.ps1` 결과를 따르라는 실행 가능한 안내로 교체하십시오.
- [main.js:517-529] r3 Minor “self-heal 실패가 일반 사용자에게 보이지 않음” — **UNRESOLVED.** 충돌·권한 오류가 console warning에만 남습니다.
- [main.js:482-488] r3 Minor “`%` 포함 경로 batch escaping” — **RESOLVED.** batch에는 `%%`, Git Bash launcher에는 원문 `%`가 적용되고 테스트도 추가됐습니다.
- [scripts/test-launchers.js:91-110] r3 Minor “Git Bash 실제 command-resolution 검증” — **RESOLVED.** `git.exe` 인접 `bin\bash.exe`를 탐색하고 미설치 시 명시적 SKIP을 출력합니다.
- [scripts/test-launchers.js:113-118] r3 Minor “PowerShell 5.1/pwsh 7의 `.CMD` 우선 PATHEXT 검증” — **RESOLVED.** 각 발견된 PowerShell 실행 파일에 altered-PATHEXT case가 적용됩니다.

## 6. Optional 제안

- [package.json:41] `${arch}`가 artifact name에서 제거돼 x64와 arm64를 동일 `release` 디렉터리에 빌드하면 installer 파일명이 충돌합니다. → multi-arch 배포 시 `${arch}`를 복원하거나 architecture별 output directory를 사용하십시오. r3 Optional — **UNRESOLVED.**

## 7. 최종 권고

- [ ] root 및 하위 junction/reparse point가 있는 설치에서 upgrade와 Settings uninstall이 외부 파일을 건드리지 않도록 제거 흐름을 차단한다.
- [ ] self-heal을 canonical 전용 설치본으로 제한하고, 다른 실행본의 자동 command takeover를 막는다.
- [ ] foreign launcher 충돌 안내에서 효과 없는 “앱 실행” 문구를 실제 복구 절차로 교체한다.
- [ ] root junction, `resources` junction, 변조된 `InstallLocation`, Cream CLI 공존 상태 각각에 대해 canary 보존 Windows integration test를 추가한다.