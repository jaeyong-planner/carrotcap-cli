# Review Report — task-019 errors-to-chat (Round 6)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +262 / -28
- 리뷰 시점: 2026-09-27T01:16:28Z
- 검증: `git diff --check` 통과. `npm test`는 샌드박스의 Temp 디렉터리 생성 권한 거부로 완료하지 못함.

## 2. 전체 판단

- ⚠️ 조건부 승인
- page-derived error text의 plain shell 유입·DOM XSS·history/clipboard 유입 경로는 해소됐으나, 이미 시작된 첨부 새로고침과 전송의 역순 경쟁 상태가 전송을 취소할 수 있습니다.

## 3. Critical 이슈

- [renderer-browser.js:247-276, renderer.js:720-727] 이전 Round 3 Critical — page-derived error text가 Composer value/history/clipboard에 남을 수 있음: **RESOLVED**. 에러는 `textContent` 기반 읽기 전용 chip에만 보관되고 history에는 `typed`만 저장됩니다.

- [renderer.js:729-753] 이전 Round 2 Critical — `decorate()` 예외 또는 예상 밖 반환이 plain send로 fall-through할 수 있음: **RESOLVED**. 첨부가 있으면 예외 및 non-context 결과를 모두 `blocked`로 fail-closed 처리합니다.

- [renderer-browser.js:282-348, main-browser.js:459-517] 이전 Round 2 Critical — stale document/context token으로 page-derived text가 전송될 수 있음: **RESOLVED**. generation, attachment identity, 일회용 token, guarded paste 직전의 main-process 상태를 모두 확인합니다.

- [renderer-browser.js:247-276, styles.css:139-144] 이전 Round 2 Critical — hostile page text가 chip에서 markup으로 실행되거나 editable input에 들어갈 수 있음: **RESOLVED**. preview는 `textContent`만 사용하며 chip은 선택 불가이고 guarded paste 경로로만 전달됩니다.

## 4. Major 이슈

- [renderer-browser.js:359-375, renderer.js:698-710, renderer-browser.js:345-348] 이전 Round 5 Major — 전송과 첨부 새로고침 직렬화: **PARTIAL**. 전송이 먼저 시작된 경우에는 버튼이 비활성화되지만, 이미 시작된 `attachErrors()`가 `await api.browserContext()`를 마친 뒤 `st.sending`을 다시 검사하지 않습니다. 사용자가 첨부 새로고침 직후 전송하면 새 attachment가 기존 snapshot을 교체하고 `prepared.valid()`가 false가 되어 guarded paste가 취소됩니다. 입력은 복구되지만 사용자는 재전송해야 합니다. → `await` 뒤에도 `st.sending`을 검사해 응답을 폐기하거나, 새로고침과 전송을 하나의 상호 배타적 lifecycle으로 직렬화하세요.

- [main-browser.js:491-495, renderer-browser.js:363-370] 이전 Round 4 Major — noToken error lookup이 전송 중 context ticket을 덮어씀: **RESOLVED**. `noToken: true` 조회는 token을 발급하거나 기존 ticket을 교체하지 않습니다.

- [renderer-browser.js:61-75, renderer-browser.js:194-220, renderer-browser.js:363-373] 이전 Round 4 Major — close/reopen/navigation 중 늦은 lookup이 attachment를 되살림: **RESOLVED**. `active`, `open`, `openToken`, `pageGen`을 응답 후 재검사하고 종료 상태에서도 attachment를 제거합니다.

- [renderer-browser.js:345-348, renderer.js:763-771] 이전 Round 4 Major — 준비 중 attachment가 바뀌어도 과거 snapshot을 전달·commit함: **RESOLVED**. guarded paste 직전에 attachment identity를 재검사해 변경 시 전송과 commit을 중단합니다.

## 5. Minor 이슈

- [renderer-browser.js:67-74, renderer-browser.js:194-196] 브라우저 닫힘 시 `dropAttachment()`에 사유를 전달하지 않아, 백로그의 “브라우저 닫기 시 자동 제거 및 알림” 요구를 충족하지 못합니다. navigation은 알림하지만 close는 조용히 제거됩니다. → close 경로에 명시적 사유를 전달하고 Composer notice가 표시되는지 테스트하세요.

- [renderer-browser.js:385-388] 이전 Round 4 Minor — attachment IPC 실패가 silent fail: **RESOLVED**. Promise rejection에서 버튼 상태를 복구하고 재시도 가능한 Composer notice를 표시합니다.

- [scripts/test-electron-browser.js:156-180] 이전 Round 4 Minor — lifecycle 경쟁 상태 회귀 테스트 부족: **PARTIAL**. “전송 시작 뒤 새로고침 클릭”은 검증하지만, “새로고침 요청 시작 뒤 전송”의 역순 경쟁 상태는 검증하지 않아 위 Major 회귀를 잡지 못합니다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] `attachErrors()`의 IPC 응답 후 `st.sending`을 재검사하고, 전송 중이면 attachment 교체 없이 응답을 폐기한다.
- [ ] 첨부 새로고침을 누른 직후 전송해도 guarded paste가 한 번만 수행되고 attachment/mark가 정확히 commit되는 E2E 테스트를 추가한다.
- [ ] browser close로 attachment가 제거될 때 Composer notice를 표시하는 테스트를 추가한다.
- [ ] 수정 후 `test:browser`, `test`, `test:smoke`를 권한 있는 환경에서 실행해 task-015 token, pin, hostile-page 회귀를 확인한다.