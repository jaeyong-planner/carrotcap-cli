# Review Report — task-019 errors-to-chat (Round 7)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +274 / -28
- 리뷰 시점: 2026-09-27T01:27:23Z
- 검증: `git diff --check` 통과. `npm test`는 일부 통과 후 샌드박스의 Temp 디렉터리 생성 권한 거부(EPERM)로 완료하지 못함.

## 2. 전체 판단

- ⚠️ 조건부 승인
- page-derived error text의 일반 셸·editable input·history·clipboard 유입 경로와 r6 경쟁 상태는 해소됐으나, 첨부 제거 뒤 키보드 focus가 사라지는 접근성 회귀가 남아 있습니다.

## 3. Critical 이슈

- [renderer-browser.js:247-276, renderer.js:720-771, main.js:1495-1508] 이전 Round 3 Critical — page-derived text가 editable input/history/clipboard 또는 plain shell로 유입: **RESOLVED**. 에러 문자열은 `textContent` 기반 읽기 전용 chip과 guarded paste payload에만 존재하며, Composer history에는 `typed`만 저장되고 guarded paste는 main process의 bracketed-paste/token 검증을 통과해야 합니다.

- [renderer.js:729-747] 이전 Round 2 Critical — `decorate()` 예외 또는 예상 밖 반환이 일반 전송으로 fall-through: **RESOLVED**. 첨부 snapshot이 존재하면 예외와 non-context 반환을 모두 `blocked`로 전환합니다.

- [renderer-browser.js:282-348, main-browser.js:461-517, main.js:1495-1508] 이전 Round 2 Critical — stale document/context token으로 오래된 페이지 문자열 전송: **RESOLVED**. attachment generation, 전달 직전 identity, one-time token, main-frame loading 상태를 모두 검증합니다.

- [renderer-browser.js:247-276, styles.css:139-144] 이전 Round 2 Critical — hostile page text의 DOM XSS 또는 editable input 유입: **RESOLVED**. chip preview는 `textContent`만 사용하고 선택 불가이며, hostile-page 테스트도 markup 미생성을 확인합니다.

## 4. Major 이슈

- [renderer-browser.js:359-381, renderer.js:698-710] 이전 Round 6 Major — 새로고침 요청 후 전송이 시작되는 역순 경쟁으로 전송 취소: **RESOLVED**. IPC 응답 뒤 `st.sending`을 재검사해 늦은 새로고침 결과를 폐기하며, 회귀 테스트가 추가됐습니다.

- [main-browser.js:491-495, renderer-browser.js:363-373] 이전 Round 4 Major — `noToken` error lookup이 전송 ticket을 덮어씀: **RESOLVED**. attachment lookup은 ticket을 발급·교체하지 않습니다.

- [renderer-browser.js:61-75, renderer-browser.js:194-220, renderer-browser.js:363-373] 이전 Round 4 Major — close/reopen/navigation 뒤 늦은 lookup이 attachment를 되살림: **RESOLVED**. active/open/openToken/pageGen을 응답 뒤 재검사하고, close 및 navigation에서 attachment를 제거합니다.

- [renderer-browser.js:325-348, renderer.js:763-771] 이전 Round 4 Major — 준비 중 attachment 변경 뒤 과거 snapshot을 전달·commit: **RESOLVED**. 전달 직전 attachment identity를 확인하고, 실제 guarded paste와 Enter 성공 뒤에만 commit합니다.

## 5. Minor 이슈

- [renderer-browser.js:240-245, renderer-browser.js:256-263] ✕ 버튼으로 attachment를 제거하면 `renderAttach()`가 현재 focus된 버튼을 DOM에서 제거하지만 Composer 또는 errors button으로 focus를 옮기지 않습니다. 키보드 사용자 focus가 body로 이동할 수 있습니다. → `dropAttachment()`에 제거 원인을 구분하거나 호출부에서 `composerInput.focus()` 또는 `errorsToChat.focus()`를 명시적으로 수행하고, ✕ 제거 뒤 `document.activeElement` 회귀 테스트를 추가하세요.

- [renderer-browser.js:67-74, scripts/test-electron-browser.js:400-417] 이전 Round 6 Minor — browser close 시 attachment 제거 notice 누락: **RESOLVED**. close 경로가 명시적 사유를 전달하고 E2E 검증도 추가됐습니다.

- [renderer-browser.js:385-390] 이전 Round 4 Minor — attachment IPC 실패 silent fail: **RESOLVED**. rejection 시 버튼 상태를 복구하고 재시도 가능한 Composer notice를 표시합니다.

- [scripts/test-electron-browser.js:195-200] 이전 Round 6 Minor — 역순 경쟁 상태 회귀 테스트 부족: **RESOLVED**. refresh 요청 뒤 send를 시작하는 시나리오가 검증됩니다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] [renderer-browser.js:240-245] attachment 제거 후 Composer 또는 errors button으로 focus를 복구한다.
- [ ] [scripts/test-electron-browser.js:133-136] ✕ 제거 직후 focus 대상과 키보드 재첨부 가능 여부를 검증한다.
- [ ] 권한 있는 환경에서 `npm run test:browser`, `npm test`, `npm run test:smoke`를 실행해 hostile-page, context-token, pin 및 attachment lifecycle 회귀를 확인한다.