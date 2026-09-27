# Review Report — task-023-r3 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: branch diff 기준 1,263줄 (1,258 additions, 5 deletions)
- 리뷰 시점: 2026-09-27T07:22:31Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- renderer 입력·프로젝트 경로로 실행 파일이나 argv를 주입할 수 없고 r2의 write/timeout/UI 이슈는 해소됐지만, 원격 third-party 플러그인의 실제 동작 내용을 동의 전에 확인할 수 없습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [main-skills.js:221-249, renderer-skills.js:100-123] r2 원격 플러그인 공급망 확인 이슈 — **PARTIAL**. 고정 SHA의 tree, manifest, hook/MCP 설정과 스크립트 개수는 표시·동의 전 차단됩니다. 그러나 `SKILL.md` 및 hook이 호출하는 `run-hook.cmd` 같은 스크립트 본문은 내려받거나 표시하지 않습니다. 따라서 네트워크 접근, 파일 삭제, credential 접근, 추가 shell 실행은 사용자가 확인할 수 없습니다. → 원격 third-party 설치 전 `SKILL.md`와 hook/MCP가 직접 실행하는 스크립트 본문 또는 보안 요약을 표시하고, 내용을 읽지 못하면 설치를 거부해야 합니다.

## 5. Minor 이슈

- [main-skills.js:302-320] r2 link/junction TOCTOU 이슈 — **RESOLVED**. plain-file/hard-link/ancestor 검증 후 escape가 발견되면 새 파일은 삭제하고 기존 파일은 원문으로 복구합니다.

- [scripts/test-skills.js:71-126, scripts/test-electron-skills.js:151-167] r2 timeout·동시 실행·BrowserView·원격 검사 테스트 부족 — **RESOLVED**. process-tree timeout, concurrent install 거부, BrowserView 0-width 전이, 원격 SHA/목록 잘림 거부를 추가 검증합니다.

- [scripts/test-skills.js:82-109] 원격 검사 테스트가 manifest·hooks JSON과 파일 수만 검증하고 `SKILL.md`·실행 스크립트 본문을 읽는지 검증하지 않습니다. → Major 수정 시 악성 shell/network/file-access 문자열을 포함한 원격 fixture를 만들고, 본문 표시 또는 설치 거부를 검증해야 합니다.

## 6. Optional 제안

- [main-skills.js:325-330, main.js:102-110, main.js:1822-1832] r2 설정 기반 executable 신뢰 가정 — **UNRESOLVED**. renderer와 project folder는 executable을 제어하지 못하며 `findCommandSync`는 절대 경로만 반환합니다. 다만 사용자가 직접 수정한 `settings.json`의 absolute `cli.claude.command`는 임의 실행 파일일 수 있습니다. → 설치 확인 화면에 resolved executable 경로를 표시하는 방안을 검토하세요.

## 7. 최종 권고

- 원격 third-party 플러그인의 `SKILL.md`와 실행 스크립트 본문을 설치 전 표시하거나, 검사 불가 시 설치를 차단한다.
- 위 경로의 script-content fixture와 설치 차단/표시 테스트를 추가한다.
- 수정 후 `npm test` 및 `npm run test:skills`를 실행해 회귀를 확인한다.