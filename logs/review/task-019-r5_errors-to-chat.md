# Review Report — task-019 errors-to-chat (Round 5)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +246 / -27
- 리뷰 시점: 2026-09-27T01:11:34Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 이전 Critical 이슈는 해소됐으나, guarded paste가 시작된 뒤 첨부를 새로고침하면 이미 전송한 에러가 다음 첨부에 남아 중복 전송될 수 있습니다.

## 3. Critical 이슈

- [renderer-browser.js:246-275, renderer.js:717-724] 이전 Round 3 Critical — page-derived error text가 Composer value/history/clipboard에 남아 plain shell로 유입될 수 있음: **RESOLVED**. 에러는 `textContent`만 쓰는 읽기 전용 chip에 보관되고, Composer value 및 history에는 사용자 입력만 저장됩니다.

- [renderer.js:729-750] 이전 Round 2 Critical — `decorate()` 예외 또는 예상 밖 반환 시 plain path로 전송될 수 있음: **RESOLVED**. 첨부 존재 시 예외와 non-context 결과를 모두 `blocked`로 fail-closed 처리하고 입력을 복원합니다.

- [renderer-browser.js:291-340, main-browser.js:459-517] 이전 Round 2 Critical — stale document/context token으로 page-derived text가 전송될 수 있음: **RESOLVED**. generation, loading state, one-time token 및 전송 직전 attachment identity를 모두 확인합니다.

- [renderer-browser.js:246-268, styles.css:139-144] 이전 Round 2 Critical — chip/clipboard 경유로 hostile page text가 markup 또는 editable input에 들어갈 수 있음: **RESOLVED**. chip은 `textContent`만 사용하고 `user-select: none`이며, 전달은 guarded paste 경로로 제한됩니다.

## 4. Major 이슈

- [renderer-browser.js:324-340, renderer-browser.js:344-378, renderer.js:755-768] guarded paste가 시작된 뒤 사용자가 “첨부 새로고침”을 누르면, 기존 `attach`가 이미 agent pane에 전달된 후 새 snapshot이 `st.attach`에 남습니다. 이후 `commit()`은 옛 mark만 commit하고 새 chip은 유지하므로, 새 chip에는 이미 전달된 에러가 포함되어 다음 전송에서 중복됩니다. → `composerSending` 동안 첨부 버튼을 비활성화하거나, `commit()`에서 현재 attachment의 mark/contents가 delivered mark 이하인 항목을 제거하도록 send·refresh lifecycle을 직렬화해야 합니다.

- [main-browser.js:491-495, renderer-browser.js:356-365] 이전 Round 4 Major — noToken lookup이 전송 중 context ticket을 덮어씀: **RESOLVED**. `noToken: true` 조회는 ticket을 만들거나 교체하지 않습니다.

- [renderer-browser.js:60-74, renderer-browser.js:193-218, renderer-browser.js:356-370] 이전 Round 4 Major — close/reopen 또는 navigation 중 늦은 attachment lookup이 chip을 되살림: **RESOLVED**. active/open/openToken/pageGen을 await 뒤 재검사하고 closed state에서도 attachment를 제거합니다.

- [renderer-browser.js:337-340, renderer.js:760-768] 이전 Round 4 Major — 준비 중 ✕/refresh로 attachment가 바뀌어도 전송·commit함: **RESOLVED**. delivery 직전 identity 검사에 실패하면 입력·pins를 유지하고 전송을 중단합니다.

## 5. Minor 이슈

- [renderer-browser.js:376-379] 이전 Round 4 Minor — attachment IPC 실패가 silent fail: **RESOLVED**. catch에서 재시도 가능한 Composer notice를 표시합니다.

- [scripts/test-electron-browser.js:156-177, scripts/test-electron-browser.js:400-405] 이전 Round 4 Minor — async lifecycle 경쟁 상태 회귀 테스트 부족: **PARTIAL**. prepare 중 ✕, noToken ticket 보존, close 직전 lookup은 검증하지만, guarded paste가 시작된 뒤 refresh하여 중복 전달되는 이번 Major 경로는 검증하지 않습니다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] guarded paste 진행 중 attachment refresh를 차단하거나, delivery mark 기준으로 refresh attachment를 정리한다.
- [ ] `pasteGuarded()` 호출 후 Enter 대기 구간에서 refresh를 발생시키고, 기존 에러가 다음 전송에 포함되지 않는 E2E 테스트를 추가한다.
- [ ] 수정 후 `test:browser`, `test`, `test:smoke`를 실행해 task-015 pins/context-token/hostile-page 회귀를 확인한다.