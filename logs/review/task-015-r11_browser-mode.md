# Review Report — task-015 browser mode (Round 11)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: task-015 기준 1,399 additions / 60 deletions
- 리뷰 시점: 2026-09-26T16:40:09Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- R10의 navigation-token 경쟁은 해소됐지만, hostile page가 annotation 결과를 무제한 생성해 renderer 메모리·UI·컨텍스트 전송을 고갈시킬 수 있습니다.

## 3. Critical 이슈

- [main-browser.js:248-280, main.js:1197-1207, main.js:1326-1339, renderer-browser.js:228-247] **R5 C3 — RESOLVED.** BrowserView는 preload 없이 `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`로 생성됩니다. `browser:*` IPC는 trusted top-level renderer로 제한되고, 페이지 유래 문자열은 control character·개행을 제거한 `# ` 주석 행으로 bracketed paste에 전달됩니다.

## 4. Major 이슈

- [renderer-browser.js:115-129, renderer-browser.js:227-253, main-browser.js:433-435] 주석 개수에 상한이 없습니다. hostile page는 DOM mutation 관찰 후 overlay에 synthetic click을 반복 dispatch하여 `st.pins`와 페이지 overlay를 무제한 늘릴 수 있습니다. 또한 `browser:clear-pins`는 최대 100개만 제거하지만 `commit()`은 모든 핀을 renderer 상태에서 제거하여 101번째 이후 overlay가 페이지에 남습니다. → picker/renderer 양쪽에 문서당 최대 핀 수를 강제하고, 전송·삭제 대상도 동일 상한으로 제한해야 합니다.

- [main-browser.js:490-496, scripts/test-electron-browser.js:232-238] **R6 context 생성 후 navigation 경쟁 — RESOLVED.** token redemption 시 현재 BrowserView·generation뿐 아니라 `isDestroyed()`와 `isLoadingMainFrame()`을 재확인해 navigation 시작 경계에서 fail-closed 처리합니다.

- [main-browser.js:223-246, scripts/test-electron-browser.js:255-261] **R8 이전 문서 오류 혼입 — RESOLVED.** request ID별 document generation을 저장하고 완료/실패 시 같은 generation으로 오류를 기록합니다.

- [main-browser.js:265-271, main-browser.js:441-475, main-browser.js:490-496] **R5 navigation/capture stale 처리 — RESOLVED.** navigation 시작 시 generation을 무효화하고, context 생성·capture 완료·token redemption 시점 모두 현재 문서와 loading 상태를 확인합니다.

- [main.js:1326-1339, renderer.js:741-748] **R8 guarded paste 후 Enter 경쟁 — RESOLVED.** paste 후 Enter 직전에 동일 PTY와 bracketed-paste 상태를 다시 확인하며, 성공 시에만 context를 commit합니다.

- [main-browser.js:235-246, main-browser.js:313-325, scripts/test-electron-browser.js:263-271] **R6 종료된 BrowserView의 stale network error 유입 — RESOLVED.** 현재 view의 `webContentsId`만 수집하고 close 시 view 참조를 제거합니다.

- [main-browser.js:167-173, main-browser.js:467-485] **R5 error cursor — RESOLVED.** monotonic sequence 기반 cursor로 ring-buffer overflow 뒤의 미전송 오류를 보존합니다.

- [renderer.js:689-748] **R5 double-send 및 PTY acknowledgement — RESOLVED.** `composerSending` lock 및 guarded paste 결과 확인 후에만 commit합니다.

- [main-browser.js:213-247, main-browser.js:313-325, main.js:1184-1193] **R5 BrowserView/debugger/session listener leak — RESOLVED.** toggle-off/window close에서 view와 debugger를 해제하며 shared session listener는 한 번만 등록됩니다.

- [scripts/test-electron-browser.js:204-238] **R6 회귀 테스트 — RESOLVED.** reload 요청 직후 token redemption이 거절되고 agent PTY에 racing context가 전달되지 않음을 검증합니다.

## 5. Minor 이슈

- [backlog/task-015.md:27, main-browser.js:328-379] **R5 screenshot 저장 문서화 — RESOLVED.** screenshot은 app user-data의 `browser-shots`만 사용하며 pruning은 해당 디렉터리의 일반 `shot-*.png` 파일만 대상으로 합니다. 프로젝트에 파일을 쓰지 않으므로 `.gitignore` 변경도 필요 없습니다.

- [main-browser.js:149-155] **R5 timeout timer — RESOLVED.** `finally()`에서 timer를 해제합니다.

- [main-browser.js:313-325] **R5 debugger detach — RESOLVED.** BrowserView close 전에 debugger detach를 시도합니다.

- [main-browser.js:348-363] **R9 screenshot 동일 millisecond 파일명 충돌 — RESOLVED.** random suffix와 `wx` 플래그로 기존 파일 overwrite를 방지합니다.

## 6. Optional 제안

- [main-browser.js:180-186, main-browser.js:239-244, renderer-browser.js:228-241] URL credential 및 `token`·`code`·`access_token` query parameter는 agent terminal 기록에 노출될 수 있습니다. context와 network error 출력 전에 username/password 및 민감 query key를 redact하는 것을 권고합니다.

- [renderer-browser.js:228-247] 페이지 문자열은 shell injection으로 이어지지 않지만 LLM prompt injection 입력입니다. 컨텍스트 첫 행에 페이지 수집 데이터가 비신뢰 입력이며 지시로 해석하면 안 된다는 경고를 추가하는 것을 권고합니다.

## 7. 최종 권고

- [ ] `[renderer-browser.js:115-129, main-browser.js:433-435]` annotation 개수를 100개 이하로 제한하고, 상한 도달 시 picker를 중단하거나 사용자에게 알린다.
- [ ] `[scripts/test-electron-browser.js:204-238]` hostile page가 synthetic click을 반복하는 경우 핀 수·DOM overlay 수·context 크기가 상한을 넘지 않는 회귀 테스트를 추가한다.
- [ ] `[main-browser.js:180-186]` 민감 URL component redaction 및 관련 테스트를 추가한다.
- [ ] 대상 JavaScript `node --check`와 `git diff --check`는 통과했다. read-only 리뷰 환경에서는 Electron browser E2E 전체 실행은 수행하지 않았다.