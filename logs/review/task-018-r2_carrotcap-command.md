# Review Report — task-018 (`feature/v0.2.0..HEAD`)

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/test-validate-settings.js`, `scripts/repair-cli.ps1`, `INSTALLER.md`, `backlog/task-018.md`
- 변경 라인 수: 360 추가 / 220 삭제 (8개 파일)
- 리뷰 시점: 2026-09-26T23:27:02Z

## 2. 전체 판단
- ❌ 반려
- 구 버전 제거 안내와 installer registry guard가 여전히 Cream CLI 등 외부 파일의 재귀 삭제 경로를 만들 수 있습니다.

## 3. Critical 이슈
- [INSTALLER.md:52-54] 구 버전이 `%LOCALAPPDATA%\Programs\carrotcap`에 설치된 경우 Settings에서 먼저 uninstall하라고 안내합니다. 해당 구 uninstaller는 `$INSTDIR`을 재귀 삭제하며, 이 경로는 Cream CLI 설치 폴더의 부모입니다. 문서 절차 자체가 Cream CLI 삭제를 재발시킬 수 있습니다. → 구 버전 uninstaller 실행을 금지하고, 구 CARROTCAP 파일만 식별·제거하는 별도 안전 migration/retirement 절차를 제공해야 합니다. **r1 Major “구 설치 경로 migration” — UNRESOLVED.**
- [build/installer.nsh:61-89] guard는 Uninstall registry key만 검사하고 `InstallLocation`도 그 key에서 읽습니다. 그러나 electron-builder는 실제 설치 위치를 `Software\${APP_GUID}`에 저장하며, 이후 `initMultiUser`가 그 값을 다시 `$INSTDIR`에 적용합니다. 이 값이 전용 폴더 밖이면 `uninstallOldVersion`이 해당 경로를 `_?=`로 old uninstaller에 넘기고, uninstaller의 `RMDir /r $INSTDIR`가 외부 폴더를 삭제할 수 있습니다. `preInit`의 `$INSTDIR` 설정도 이후 초기화에서 덮어써집니다. → 실제 `INSTALL_REGISTRY_KEY`의 `InstallLocation`을 전용 경로와 정확히 비교하고, 초기화 후에도 불일치 시 중단하도록 guard 위치/대상을 수정해야 합니다. **r1 Critical “기존 InstallLocation 재사용 삭제 위험” — PARTIAL.**

## 4. Major 이슈
- [build/installer.nsh:98-121] 동일 이름의 foreign launcher가 있으면 올바르게 덮어쓰지 않지만, one-click installer는 `DetailPrint`만 남기고 성공 처리합니다. 기본 one-click UI에서는 상세 로그가 보이지 않아 사용자는 설치가 성공했다고 보지만 `carrotcap`은 다른 프로그램을 실행하거나 실패합니다. → 충돌 시 눈에 보이는 오류 안내와 non-zero 종료를 제공하거나, 설치 완료 화면/앱 내에 명시적인 repair-required 상태를 표시해야 합니다.
- [scripts/repair-cli.ps1:72-76] WindowsApps가 PATH에 없거나 `.CMD` 우선 PATHEXT/선행 `.exe` 때문에 해석이 실패해도 마지막에 “works”라고 성공 메시지를 출력합니다. → 검증 결과가 기대 launcher가 아니면 성공 메시지 대신 실패 상태와 실행 가능한 복구 지침을 반환해야 합니다. **r1 Major “WindowsApps 미포함 PATH” — RESOLVED(지원 한계 문서화), 단 repair 결과 판정은 미흡.**

## 5. Minor 이슈
- [scripts/test-validate-settings.js:746-750] Git Bash 검증은 생성 문자열을 현재 `bash -c`로 실행할 뿐, 실제 WindowsApps-equivalent PATH에서 extensionless `carrotcap`이 Git Bash에 의해 선택되는지 검증하지 않습니다. → 임시 PATH와 실제 shim 파일을 사용한 Git Bash command-resolution integration test를 추가해야 합니다. **r1 Minor “Git Bash 해석 테스트” — PARTIAL.**
- [scripts/test-validate-settings.js:741-752] `.bat` 내용 비교만 수행하며 실제 `cmd.exe`에서 공백·apostrophe 포함 경로와 `%*` 인수 전달을 검증하지 않습니다. 또한 `.CMD`가 `.BAT`보다 앞선 PATHEXT 사례도 없습니다. → cmd, Windows PowerShell 5.1, pwsh 7에서 기본/변경 PATHEXT 각각의 command resolution과 인수 전달을 integration test로 추가해야 합니다. **r1 Minor “cmd quoting 테스트” — PARTIAL; r1 Major “PATHEXT 한계” — PARTIAL.**
- [main.js:505-527] self-heal 실패는 console warning만 남기며 사용자에게 launcher 충돌 또는 WindowsApps 접근 실패가 표시되지 않습니다. → launcher를 확보하지 못한 경우 앱 UI 또는 명시적 repair 안내를 제공해야 합니다. **r1 Major “self-heal foreign file overwrite” — RESOLVED.**

## 6. Optional 제안
- [package.json:40] `${arch}`가 artifact name에서 제거되어 여러 Windows architecture를 같은 `release` 디렉터리에 빌드하면 산출물 이름이 충돌합니다. → 다중 architecture 배포가 예정되면 `${arch}`를 복원하거나 architecture별 output 경로를 분리하십시오.

## 7. 최종 권고
- [ ] `INSTALLER.md`의 구 버전 uninstall 안내를 즉시 제거하고, Cream CLI를 건드리지 않는 migration 절차를 구현한다.
- [ ] `build/installer.nsh` guard가 실제 `INSTALL_REGISTRY_KEY`의 설치 경로를 검사하도록 수정하고, foreign/legacy parent 경로에서 old uninstaller가 실행되지 않음을 검증한다.
- [ ] foreign `carrotcap.bat` 또는 extensionless `carrotcap` 충돌을 one-click 설치 성공으로 처리하지 않도록 한다.
- [ ] 실제 Windows에서 구 설치 경로, foreign registry `InstallLocation`, uninstall, upgrade 각각에 대해 Cream CLI 파일 보존 integration test를 추가한다.
- [ ] cmd, PowerShell 5.1, pwsh 7, Git Bash에서 기본 및 `.CMD` 우선 PATHEXT의 command resolution과 인수 전달을 검증한다.
- [ ] r1 상태: Critical #1 PARTIAL, Critical #2 RESOLVED, Critical #3 RESOLVED; Major #1 RESOLVED, Major #2 UNRESOLVED, Major #3 RESOLVED, Major #4 PARTIAL, Major #5 RESOLVED; Minor #1 PARTIAL, Minor #2 RESOLVED, Minor #3 PARTIAL.