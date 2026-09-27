# Review Report — task-018 (`git show HEAD`)

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`, `build/installer.nsh`, `package.json`, `scripts/test-validate-settings.js`, `backlog/task-018.md`
- 변경 라인 수: 104 추가 / 95 삭제
- 리뷰 시점: 2026-09-26T23:09:09Z

## 2. 전체 판단
- ❌ 반려
- 기존 설치본 업그레이드 시 Cream CLI가 있는 상위 설치 폴더를 계속 사용할 수 있어, 이번 변경의 핵심인 삭제 안전성이 보장되지 않습니다.

## 3. Critical 이슈
- [build/installer.nsh:18-21] 기존 동일 `appId` 설치의 `InstallLocation`을 그대로 유지합니다. 이전 버전은 `%LOCALAPPDATA%\Programs\carrotcap`을 설치 경로로 사용했으며, 이는 Cream CLI 설치 폴더의 부모입니다. 해당 설치본에서 업그레이드하면 새 전용 경로가 아니라 기존 상위 경로에 설치되고, electron-builder의 이전 버전 정리 또는 이후 제거 시 `$INSTDIR` 재귀 삭제로 Cream CLI 파일까지 삭제할 수 있습니다. → 기존 `InstallLocation`이 정확히 `%LOCALAPPDATA%\Programs\carrotcap-cli`인 경우에만 재사용하고, 구 경로인 경우에는 전용 경로로 migration하되 구 경로 전체를 제거 대상으로 삼지 않도록 수정해야 합니다.
- [build/installer.nsh:26-29] `FileOpen ... w`는 기존 `WindowsApps\carrotcap.bat`의 소유자·내용·reparse point 여부를 확인하지 않고 덮어씁니다. 다른 제품의 일반 파일은 물론 링크가 존재할 때 링크 대상까지 변경될 수 있어 외부 파일 훼손 위험이 있습니다. → 설치 전에 reparse point/디렉터리를 거부하고, 관리 마커 및 기대 내용으로 소유권을 확인한 경우에만 갱신하십시오. 충돌 시 설치 실패 또는 사용자에게 명시적으로 알려야 합니다.
- [build/installer.nsh:34-35] 제거 시 파일의 현재 내용이나 소유권을 확인하지 않고 전역 `WindowsApps`의 두 이름을 삭제합니다. 설치 후 다른 프로그램이 같은 이름을 생성한 경우 해당 프로그램의 launcher를 삭제합니다. → 생성한 launcher에 식별 가능한 관리 마커를 넣고, 제거 시 그 마커와 기대 내용을 검증한 경우에만 삭제하십시오.

## 4. Major 이슈
- [main.js:502-506] self-heal은 링크와 디렉터리만 건너뛰며, 동일 이름의 일반 파일은 내용이 다르면 무조건 덮어씁니다. 설치 단계와 동일하게 다른 제품의 `carrotcap.bat` 또는 `carrotcap`을 파괴할 수 있고, 앱 실행마다 반복됩니다. → 관리 마커가 없는 기존 일반 파일은 덮어쓰지 말고 경고 로그와 사용자 안내를 제공하십시오.
- [build/installer.nsh:18-21] 구 설치 경로에서 새 설치 경로로의 안전한 migration이 없습니다. `InstallLocation`을 전용 경로로 바꾸기만 해도 구 경로의 uninstaller/업데이터가 남을 수 있으므로, 구 설치본과 Cream CLI의 파일을 개별적으로 식별하는 migration·rollback 시나리오가 필요합니다. → 구 버전 설치 상태에서 upgrade, uninstall, repair를 각각 검증하는 NSIS integration test를 추가하십시오.
- [build/installer.nsh:25-29] 설치 직후에는 `.bat`만 생성되고 Git Bash용 확장자 없는 launcher는 앱이 실제로 시작된 뒤에만 생성됩니다. `runAfterFinish` 자동 실행이 실패·차단되거나 설치 후 즉시 Git Bash에서 실행하면 요구한 명령이 동작하지 않습니다. → installer에서도 확장자 없는 launcher를 생성하고, Git Bash에서 실행 가능한 속성/실행 해석을 실제 Windows 환경에서 검증하십시오.
- [main.js:470-472] `.BAT` 우선 전략은 기본 `PATHEXT`가 `.BAT`를 `.CMD`보다 앞에 둘 때만 성립합니다. 사용자가 `PATHEXT`를 변경하여 `.CMD`를 우선시한 cmd, PowerShell 5.1, pwsh 7에서는 Cream CLI의 `carrotcap.cmd`가 다시 선택됩니다. 또한 PowerShell function/alias가 있으면 외부 launcher보다 먼저 해석됩니다. → 지원 범위를 기본 `PATHEXT` 환경으로 명시하거나, 대상 shell별 실제 command resolution을 검사해 충돌을 경고하고 테스트에 변경된 `PATHEXT` 사례를 추가하십시오.
- [build/installer.nsh:25-29] `WindowsApps`가 PATH에 없는 환경에서는 PATH fallback을 제거한 뒤 `carrotcap`을 찾을 방법이 없습니다. 근거는 특정 머신의 machine PATH 측정치이며 모든 지원 환경의 보장은 아닙니다. → PATH를 재작성하지 않는 대체 등록 방식 또는 WindowsApps 미포함 환경의 명시적 지원 정책과 안내를 마련하십시오.

## 5. Minor 이슈
- [scripts/test-validate-settings.js:742-744] 테스트는 생성된 shell 본문을 직접 `bash -c`로 실행할 뿐, 실제 Git Bash의 `PATH` 검색과 `WindowsApps\carrotcap` 선택을 검증하지 않습니다. → 실제 shim 파일을 WindowsApps와 동등한 테스트 PATH에 생성한 뒤 `carrotcap` 이름으로 해석·실행하는 integration test를 추가하십시오.
- [INSTALLER.md:25-76] 변경된 설치 경로, launcher 이름, PATH fallback 제거 내용이 문서에 반영되지 않았습니다. 현재 문서는 `carrotcap.cmd`, `%LOCALAPPDATA%\Programs\carrotcap`, PATH 추가를 안내해 사용자 복구 절차가 틀립니다. → task-018 동작과 경로로 문서를 갱신하십시오.
- [scripts/test-validate-settings.js:735-748] `%`, 큰따옴표, 줄바꿈 거부는 검증하지만 `.bat` 실제 실행에서 공백·apostrophe·특수문자가 포함된 설치 경로와 `%*` 전달이 안전한지는 검증하지 않습니다. → Windows `cmd.exe`에서 shim을 실행하는 테스트를 추가하십시오.

## 6. Optional 제안
- [package.json:40] artifact 이름에 `${os}`와 `${arch}`가 없어 여러 Windows architecture를 같은 output 디렉터리에 빌드하면 산출물이 충돌할 수 있습니다. → 다중 architecture 배포가 예정된 경우 `${arch}`를 유지하거나 output 분리를 명시하십시오.

## 7. 최종 권고
- [ ] 구 버전의 `%LOCALAPPDATA%\Programs\carrotcap` 설치 상태에서 upgrade/uninstall해 Cream CLI가 보존되는지 검증하고, 안전한 migration을 구현한다.
- [ ] installer·self-heal·uninstaller 모두 launcher 소유권/내용/reparse point를 검증하도록 수정한다.
- [ ] installer가 Git Bash launcher까지 생성하도록 하고, cmd·PowerShell 5.1·pwsh 7·Git Bash의 실제 command resolution 테스트를 추가한다.
- [ ] `PATHEXT` 변경 및 WindowsApps 비포함 PATH 환경의 동작 또는 지원 범위를 검증한다.
- [ ] `INSTALLER.md`의 구 경로·구 launcher·PATH fallback 안내를 갱신한다.
- [ ] `npm test`는 sandbox의 Temp 디렉터리 생성 권한 제한으로 중단되어 전체 통과 여부를 확인하지 못했다. 쓰기 가능한 Windows 테스트 환경에서 재실행이 필요하다.