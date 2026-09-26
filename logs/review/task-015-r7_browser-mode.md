# Review Report — task-015 browser mode (Round 7)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: 최신 HEAD(`0851da1`) 기준 75 additions / 7 deletions
- 리뷰 시점: 2026-09-26T16:11:42Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- R6의 context-navigation 경쟁 및 종료된 BrowserView의 stale network error 유입은 해결됐으며, 남은 조건은 해당 회귀 경로의 자동 테스트 추가입니다.

## 3. Critical 이슈

- [main.js:1323-1331, renderer-browser.js:244-256] **R5 C3 — RESOLVED.** page-controlled 문자열은 C0/C1/ESC 제거 및 `# ` 주석 접두사 처리되고, main process가 bracketed-paste 상태를 쓰기 직전에 재확인하므로 shell Command Injection 경로가 차단됩니다.

## 4. Major 이슈

- [main-browser.js:417-450, main-browser.js:463-469, main.js:1323-1331] **R6 context 생성 후 navigation 경쟁 — RESOLVED.** `browser:context`가 one-time token을 발급하고 `pty:paste-guarded`의 실제 PTY write 직전에 `view`와 `pageGen`을 재검증합니다. navigation/close 뒤의 stale context는 paste되지 않습니다.

- [main-browser.js:221-228] **R6 종료된 BrowserView의 stale network error 유입 — RESOLVED.** 공유 partition listener가 현재 `view.webContents.id`와 일치하는 요청만 기록합니다.

- [main-browser.js:164-169, main-browser.js:442-460] **R5 error cursor — RESOLVED.** monotonic `seq`/`reportedSeq`로 ring-buffer trim 또는 close/reopen 뒤에도 새 오류의 소비 범위가 보존됩니다.

- [main-browser.js:393-412, main-browser.js:417-441, renderer-browser.js:115-151] **R5 navigation/capture stale 처리 — RESOLVED.** pick, screenshot, pin clear는 view/document generation을 확인하며 navigation·close 중 결과를 fail-closed 처리합니다.

- [renderer.js:681-741] **R5 double-send 및 PTY acknowledgement — RESOLVED.** 전송 lock과 paste/Enter acknowledgement가 모두 성공한 경우에만 pin/error를 commit합니다.

- [main-browser.js:208-230, main-browser.js:290-302, main.js:1184-1193] **R5 BrowserView/debugger/session listener leak — RESOLVED.** view 종료 시 detach/close가 수행되고 session listener는 최초 한 번만 등록됩니다.

- [scripts/test-electron-browser.js:141-225] **R6 회귀 테스트 — PARTIAL.** shell injection, reload, close는 검증하지만 “context 발급 후 navigation되어 token redemption이 거절되는 경우”, “close/reopen 후 늦은 network error가 제외되는 경우”, “ring-buffer overflow 후 error cursor”는 자동 검증하지 않습니다. 각 경로를 E2E 회귀 테스트로 추가해야 합니다.

## 5. Minor 이슈

- [backlog/task-015.md:27] **R5 screenshot 저장 문서화 — RESOLVED.** obsolete `.gitignore` 설명이 제거되고 앱 user-data 저장 구조로 정정됐습니다.

- [main-browser.js:149-155] **R5 timeout timer — RESOLVED.** `finally()`에서 timer를 해제합니다.

- [main-browser.js:295-299] **R5 debugger detach — RESOLVED.** BrowserView close 전 debugger detach를 시도합니다.

## 6. Optional 제안

- [main-browser.js:181-182, main-browser.js:223-227, renderer-browser.js:228-241] URL의 credentials 및 `token`, `code`, `access_token` 계열 query parameter가 terminal/history에 남을 수 있습니다. agent context와 network-error 문자열에 넣기 전 URL credentials 제거 및 민감 query key redaction을 적용하는 것이 좋습니다.

- [renderer-browser.js:228-247] shell 실행은 방어됐지만 페이지 title/text/console message는 LLM prompt injection 입력입니다. context 첫 줄에 페이지 유래 데이터가 비신뢰 입력임을 명시하는 고정 경고를 추가하면 agent의 오해 가능성을 낮출 수 있습니다.

## 7. 최종 권고

- [ ] `browser:context` 발급 후 navigation 시 `pty:paste-guarded`가 false를 반환하고 pin/error가 commit되지 않는 E2E 테스트를 추가한다.
- [ ] BrowserView close/reopen 뒤 이전 view의 network failure가 새 context에 포함되지 않는 E2E 테스트를 추가한다.
- [ ] 100건 초과 error ring-buffer에서 cursor가 새 오류만 commit하는 테스트를 추가한다.
- [ ] 민감 URL query parameter redaction 정책을 결정하고 적용 여부를 문서화한다.