# Review Report — task-018-r6 (`feature/v0.2.0..HEAD`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/test-validate-settings.js`, `scripts/repair-cli.ps1`, `scripts/test-launchers.js`, `INSTALLER.md`, `renderer.js`, `backlog/task-018.md`
- 변경 라인 수: 872 추가 / 223 삭제
- 리뷰 시점: 2026-09-26T23:59:21Z

## 2. 전체 판단

- ✅ 승인
- 전용 appId·설치 경로·preInit/customUnInit 가드와 marker 기반 launcher 소유권 검사가 Cream CLI 삭제/덮어쓰기 위험을 차단하며, r5 지적 사항도 반영되었습니다.

## 3. Critical 이슈

- [build/installer.nsh:60-105, 150-166] r4 Critical “설치 루트·하위 junction/reparse point를 따라 upgrade/uninstall이 외부 데이터를 삭제할 수 있음” — **RESOLVED.** 설치와 제거 전 모두 루트 및 하위 reparse point를 검사하고 발견 시 종료 코드 2로 중단합니다.
- [build/installer.nsh:160-166] r3 Critical “변조된 `InstallLocation`으로 Settings uninstall이 외부 경로를 재귀 삭제할 수 있음” — **RESOLVED.** `$INSTDIR`가 전용 경로와 다르면 제거 전에 중단합니다.
- [build/installer.nsh:108-156] r3 Critical “upgrade가 기존 등록값을 따라 Cream CLI 또는 외부 경로를 제거할 수 있음” — **RESOLVED.** HKCU/HKLM의 `DisplayName`, `UninstallString`, `InstallLocation`을 검증하고 설치 경로를 전용 폴더로 강제합니다.
- [INSTALLER.md:58-70] r3 Critical “구 `Programs\carrotcap`/Cream CLI 경로의 old uninstaller 실행 위험” — **RESOLVED.** 실행 금지와 수동 정리 절차가 명시되었습니다.

## 4. Major 이슈

- [package.json:59-76, main.js:542-545, build/installer.nsh:187] r5 Major “배포본에 없는 repair script/document를 안내함” — **RESOLVED.** `extraResources`로 `resources\repair-cli.ps1` 및 `resources\INSTALLER.md`를 포함하고, 실제 배포 경로를 안내합니다.
- [main.js:500-516] r4 Major “설치 위치 밖 packaged copy가 launcher를 탈취” — **RESOLVED.** `realpath`와 canonical 설치 경로의 일치를 요구해 설치본만 self-register합니다.
- [scripts/repair-cli.ps1:70-98] r3 Major “실제 command resolution 실패에도 repair가 성공 종료할 수 있음” — **RESOLVED.** PATH×PATHEXT 해석 결과가 기대 launcher와 다르면 종료 코드 2를 반환합니다.
- [build/installer.nsh:178-202] r3 Major “foreign launcher 충돌이 one-click 사용자에게 보이지 않음” — **RESOLVED.** marker 없는 파일·링크·폴더 충돌을 MessageBox로 알리고 repair 경로를 제공합니다.

## 5. Minor 이슈

- [main.js:485-488, build/installer.nsh:176-185, scripts/repair-cli.ps1:51-53] r5 Minor “`cmd /V:ON`에서 `!`가 포함된 설치 경로가 변형될 수 있음” — **RESOLVED.** `setlocal DisableDelayedExpansion`을 세 구현에 동일하게 적용했습니다.
- [scripts/test-launchers.js:32-33, 84-118] r5 Minor “`!` 포함 경로와 delayed expansion 회귀 테스트 부재” — **RESOLVED.** `%CC_X%`와 `!CC_X!`가 포함된 경로 및 `cmd /V:ON` 케이스를 추가했습니다.
- [scripts/test-validate-settings.js:758-779] r5 Minor “Windows 전용 canonical-install 테스트가 POSIX `npm test`를 실패시킬 수 있음” — **RESOLVED.** Windows 전용으로 gate되었습니다.
- [main.js:521-545, renderer.js:48-53] r3 Minor “self-heal 실패가 사용자에게 보이지 않음” — **RESOLVED.** main-process 상태가 renderer의 warning 상태 줄로 전달됩니다.
- [main.js:485-488, build/installer.nsh:176-198, scripts/repair-cli.ps1:49-53] r3 Minor “`%`·apostrophe 포함 경로 인용/escaping” — **RESOLVED.** batch의 `%%` escaping 및 Git Bash POSIX single-quote escaping이 일관되게 적용되었습니다.
- [scripts/test-launchers.js:92-112] r3 Minor “Git Bash 실제 command-resolution 검증 부재” — **RESOLVED.** extensionless launcher와 공백·apostrophe 경로를 통합 테스트합니다.
- [scripts/test-launchers.js:114-118] r3 Minor “PowerShell 5.1/pwsh 7의 `.CMD` 우선 PATHEXT 한계 미검증” — **RESOLVED.** `.CMD` 우선 시 Cream launcher가 선택되는 문서화된 제한을 검증합니다.

## 6. Optional 제안

- [package.json:41] `${arch}`가 artifact name에서 제거되어 x64·arm64 설치 파일을 동일 output directory에 생성하면 이름이 충돌합니다. **UNRESOLVED.** multi-arch 배포 시 `${arch}`를 복구하거나 architecture별 output directory를 사용하십시오.

## 7. 최종 권고

- [ ] Windows release 환경에서 `npm run test:launchers`를 실행해 cmd, PowerShell 5.1, pwsh 7, Git Bash 결과를 확인한다.
- [ ] 실제 NSIS 산출물에서 `resources\repair-cli.ps1`와 `resources\INSTALLER.md` 존재 및 repair 실행을 release checklist에 유지한다.
- [ ] upgrade/uninstall의 junction, 변조된 `InstallLocation`, Cream CLI 공존 canary 검증을 release checklist에 유지한다.
- [ ] multi-arch 배포 시 [package.json:41] installer artifact 충돌 방지 구성을 결정한다.