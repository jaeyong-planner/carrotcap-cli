# Review Report — task-023-r9 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: +1,882 / -5
- 리뷰 시점: 2026-09-27T08:05:29Z

## 2. 전체 판단

- ✅ 승인
- r8의 Critical/Major/Minor 이슈는 모두 해소됐으며, native consent·설치본 무결성·프로젝트 경계·모달 상태 관리가 요구사항에 맞게 적용됐습니다.

## 3. Critical 이슈

- [main-skills.js:414-456] r8의 junction 교체 경쟁 시 외부 쓰기 문제는 **RESOLVED (수용된 residual)** 입니다. exclusive temporary file을 열고 FD identity 및 프로젝트 내부 여부를 확인한 뒤에만 내용을 기록하며, 수용 범위의 순간적 빈 파일 외에는 외부 파일에 내용이 쓰이지 않습니다.
- [main-skills.js:461-481] r8의 `CLAUDE.md` read-swap 문제는 **RESOLVED** 입니다. open 전후의 파일 identity와 경로 실체를 대조하여, 링크/하드링크 교체 또는 경로 변경 시 읽기·병합을 중단합니다.

## 4. Major 이슈

- [main-skills.js:673-702, main.js:1847-1865] r8의 renderer boolean만으로 third-party 설치가 가능했던 문제는 **RESOLVED** 입니다. `confirmThirdParty` 값 외에 main process가 native dialog를 표시하고, 취소 또는 창 표시 불가 시 CLI를 실행하지 않습니다.
- [main-skills.js:186-194, 684-690] r8의 malformed third-party source 허용 문제는 **RESOLVED** 입니다. 로컬 출처는 marketplace 내부의 `./` 경로와 realpath 경계를 검증하고, 원격 출처는 pinned GitHub commit 확인을 요구합니다.
- [main-skills.js:543-575, 691-729] r8의 timeout 후 다음 설치와 기존 프로세스 트리가 겹칠 수 있던 문제는 **RESOLVED** 입니다. Windows에서는 `taskkill /T /F` 완료를, POSIX에서는 process-group 종료를 기다린 뒤 runner가 완료됩니다. `running` guard도 동시 설치를 차단합니다.
- [main-skills.js:410-456, 734-742] r8의 `CLAUDE.md` read/write 사이 사용자 편집 덮어쓰기 문제는 **RESOLVED** 입니다. 읽은 stamp와 rename 직전 stamp가 다르면 쓰지 않고 `rulesPending` 상태로 남깁니다.
- [main-skills.js:394-407, 526-534] r8의 media raw-byte integrity 검증 누락은 **RESOLVED** 입니다. media는 raw SHA-256으로 기록·대조됩니다.
- [main-skills.js:635, 718-725, scripts/test-electron-skills.js:278-300] r8의 로컬 plugin 설치본 무결성 E2E 검증 부족은 **RESOLVED** 입니다. 텍스트 변경·추가 파일·이미지 byte 변경·표시된 파일 누락이 모두 uninstall 및 실패로 이어지는 흐름을 검증합니다.
- [main-skills.js:495-497] r8의 remote symlink/submodule 검사 누락은 **RESOLVED** 입니다. Git tree의 symlink와 submodule을 설치 전 거부합니다.

## 5. Minor 이슈

- [main-skills.js:422-456, scripts/test-skills.js:237-246] r8의 temporary-file 생성 직전 junction 경쟁 테스트 부족은 **RESOLVED (수용된 residual)** 입니다. 외부에 내용이 쓰이지 않고 최종 temporary file이 남지 않음을 검증합니다.
- [renderer-skills.js:200-251, renderer.js:1157-1165, renderer-browser.js:48-63] modal busy/partial failure/START continuation/Escape 및 BrowserView 숨김 처리는 **RESOLVED** 입니다. 설치 중 닫기·선택 변경을 차단하고, partial failure에서는 설치된 구성으로 START를 계속할 수 있으며, modal 노출 시 BrowserView bounds를 0으로 설정합니다.

## 6. Optional 제안

- [main.js:105-109, main-skills.js:559-564] absolute `.cmd`/`.bat` 경로는 `cmd.exe` shell에서 실행됩니다. `%VAR%` 등 cmd expansion 문자가 포함된 settings 경로는 검증한 literal path와 다른 명령 해석으로 이어질 수 있습니다. renderer가 `cli` 설정을 변경할 수 없어 권한 상승 경로는 아니지만, `.cmd/.bat` absolute path에서 `%`, `!`, `^`, `&`, `|`, `<`, `>`를 거부하거나 `.exe`만 허용하는 것이 안전합니다.

## 7. 최종 권고

- [ ] `npm test`와 `npm run test:skills`를 Windows 환경에서 실행한다.
- [ ] [main.js:105-109, main-skills.js:559-564] `.cmd/.bat` 경로의 cmd expansion 문자 차단 여부를 결정하고, 채택 시 regression test를 추가한다.
- [x] `git diff --check feature/v0.2.0..HEAD` 통과를 확인했다.