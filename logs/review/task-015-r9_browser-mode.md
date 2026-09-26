# Review Report — task-015 browser mode (Round 9)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: 최신 HEAD 기준 135 additions / 42 deletions
- 리뷰 시점: 2026-09-26T16:25:18Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- R8의 guarded paste/Enter transaction은 보완됐으나, navigation 전환 경계와 늦게 완료된 이전 문서 요청이 새 문서 오류로 귀속되는 문제가 남아 있습니다.

## 3. Critical 이슈

- [main.js:1326-1339, renderer-browser.js:228-247] **R5 C3 — RESOLVED.** 페이지 유래 문자열의 control character·개행은 제거되고 모든 컨텍스트 줄이 `# ` 주석으로 전송됩니다. BrowserView는 preload 없이 sandbox/contextIsolation/nodeIntegration 비활성으로 생성되어 페이지가 앱 IPC·파일 시스템에 접근할 수 없습니다.

## 4. Major 이슈

- [main-browser.js:224-230, main-browser.js:194-203, main-browser.js:249-251, main-browser.js:445-449] **R8 이전 문서 오류 혼입 — UNRESOLVED.** 오류에 `pageGen`을 기록하지만 `webRequest` 콜백은 요청의 document/loader identity를 확인하지 않고 콜백 실행 시점의 전역 `pageGen`을 사용합니다. 이전 문서의 느린 subresource가 새 문서 `did-navigate` 뒤 완료되면 새 문서 오류로 태깅되어 agent context에 포함됩니다. 요청 시작 시점의 main-frame document generation 또는 Chromium loader ID를 저장하고, 완료 이벤트가 해당 generation과 일치할 때만 기록해야 합니다.

- [main-browser.js:249-251, main-browser.js:420-453, renderer-browser.js:208-219] navigation이 시작됐지만 아직 `did-navigate`가 발생하지 않은 구간에는 `pageGen`과 context token이 이전 문서 값으로 유효합니다. 이때 사용자가 전송하면 이전 문서의 pins/screenshot/context가 navigation 중인 페이지에 대해 전송될 수 있습니다. main-frame `did-start-navigation`에서 즉시 generation/token을 무효화하고, `browser:context`가 loading/navigation-pending 상태면 fail-closed 처리해야 합니다.

- [main.js:1323-1339, renderer.js:741-748] **R8 guarded paste 후 Enter 경쟁 — RESOLVED.** paste와 Enter가 main process의 한 IPC transaction으로 처리되고 Enter 직전에 동일 PTY 및 bracketed-paste 상태를 재검증합니다. 다만 해당 경쟁을 재현하는 E2E 회귀 테스트는 아직 없습니다.

- [main-browser.js:417-453, main.js:1331-1339, scripts/test-electron-browser.js:204-231] **R6 context 생성 후 navigation 경쟁 — PARTIAL.** context 발급 뒤 navigation이 완료된 경우 one-time token redemption은 거부됩니다. 그러나 navigation 시작부터 document commit 전까지의 경계는 위 이슈로 보호되지 않습니다.

- [main-browser.js:224-230, scripts/test-electron-browser.js:247-255] **R6 종료된 BrowserView의 stale network error 유입 — RESOLVED.** 현재 view의 `webContentsId`만 수집해 close/reopen 뒤 늦은 요청을 배제합니다.

- [main-browser.js:164-171, main-browser.js:445-463, scripts/test-electron-browser.js:233-245] **R5 error cursor — RESOLVED.** monotonic sequence와 `reportedSeq`를 사용해 ring-buffer overflow 후에도 미전송 오류를 추적합니다.

- [main-browser.js:396-415, main-browser.js:420-444, renderer-browser.js:115-151] **R5 navigation/capture stale 처리 — PARTIAL.** capture 완료 후 view/generation 검증은 있으나, navigation 시작 직후 commit 전 context 생성 및 annotation 결과의 경계가 남아 있습니다.

- [renderer.js:689-702, renderer.js:741-748] **R5 double-send 및 PTY acknowledgement — RESOLVED.** renderer 전송 lock과 main-process transaction으로 동일 context의 이중 전송·조기 commit을 막습니다.

- [main-browser.js:211-233, main-browser.js:293-305, main.js:1184-1193] **R5 BrowserView/debugger/session listener leak — RESOLVED.** toggle-off/window close에서 view와 debugger를 해제하고 shared partition listener는 한 번만 등록합니다.

- [scripts/test-electron-browser.js:204-255] **R6 회귀 테스트 — PARTIAL.** stale/replay token, error cursor, close/reopen 늦은 오류를 검증하지만, 동일 BrowserView의 이전 문서 subresource 완료 및 navigation-start 경계를 검증하지 않습니다.

## 5. Minor 이슈

- [backlog/task-015.md:27, main-browser.js:308-357] **R5 screenshot 저장 문서화 — RESOLVED.** 스크린샷은 프로젝트가 아닌 app user-data 경로에 저장되며, pruning은 해당 디렉터리의 일반 `shot-*.png` 파일만 대상으로 합니다.

- [main-browser.js:149-155] **R5 timeout timer — RESOLVED.** `finally()`에서 timeout timer를 해제합니다.

- [main-browser.js:293-302] **R5 debugger detach — RESOLVED.** BrowserView 종료 전 debugger detach를 시도합니다.

- [main-browser.js:330-336] 같은 millisecond 내 두 capture가 발생하면 동일 파일명이 충돌해 `wx` 쓰기가 실패하고 screenshot이 누락될 수 있습니다 → random suffix 또는 retry로 고유 파일명을 보장해야 합니다.

## 6. Optional 제안

- [main-browser.js:181-184, main-browser.js:226-230, renderer-browser.js:228-241] URL credential 및 `token`, `code`, `access_token` 계열 query parameter가 terminal context와 오류 목록에 남을 수 있습니다. URL 출력 전 credentials 제거와 민감 query key redaction이 필요합니다.

- [renderer-browser.js:228-247] 페이지 문자열은 shell injection에서 보호되지만 LLM prompt injection에는 여전히 비신뢰 입력입니다. context 첫 줄에 페이지 유래 데이터가 비신뢰 입력이며 지시로 실행하지 말아야 함을 명시하는 것이 좋습니다.

## 7. 최종 권고

- [ ] `[main-browser.js:224-230]` network request를 시작 document generation/loader ID에 귀속하고, 이전 문서 요청의 늦은 완료를 새 문서 오류에서 제외한다.
- [ ] `[main-browser.js:249-251, main-browser.js:420-453]` main-frame navigation 시작 즉시 context token과 generation을 무효화하고 loading 중 context 생성을 거절한다.
- [ ] 동일 BrowserView에서 `/slowpage`를 연 뒤 다른 URL로 이동하고, 늦은 `500`이 새 페이지 context에 포함되지 않는 E2E 테스트를 추가한다.
- [ ] navigation 시작 직후 context/pick/send를 시도했을 때 stale로 거절되고 pins/errors가 소비되지 않는 E2E 테스트를 추가한다.
- [ ] `[main.js:1326-1339]` guarded paste 직후 agent 종료 시 Enter/commit이 거절되는 E2E 테스트를 추가한다.
- [ ] `node --check`로 대상 JavaScript의 syntax 검증은 통과했습니다. `npm run test:browser` 전체 실행은 read-only sandbox의 Temp directory 생성 제한으로 검증하지 못했습니다.