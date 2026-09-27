# Review Report — task-015 browser mode (Round 8)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: 최신 HEAD 기준 검토 대상 코드 67 additions / 1 deletion
- 리뷰 시점: 2026-09-26T16:18:29Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- R7 회귀 테스트 누락은 보완됐지만, 같은 BrowserView 내 페이지 이동 뒤 이전 페이지의 오류가 새 컨텍스트에 섞일 수 있고 guarded paste 후 Enter 경쟁이 남아 있습니다.

## 3. Critical 이슈

- [main.js:1323-1331, renderer-browser.js:245-247] **R5 C3 — RESOLVED.** 페이지 유래 문자열은 C0/C1/ESC·개행을 제거하고 모든 컨텍스트 줄에 `# `를 붙입니다. main process도 bracketed-paste 상태를 실제 write 직전에 확인하므로 페이지가 terminal control sequence 또는 shell command를 주입할 경로는 차단됩니다.

## 4. Major 이슈

- [main-browser.js:221-228, main-browser.js:246-255, main-browser.js:442-446] 같은 BrowserView에서 새 URL로 이동한 뒤 이전 문서의 늦은 network/console error가 `errors`에 남거나 추가되어 새 문서의 agent context에 포함될 수 있습니다. `ours()`는 `webContentsId`만 비교하며 navigation/document generation을 구분하지 않습니다. 오류에 현재 document/loader identity를 연결하고 context에서 현재 문서 것만 선택하도록 수정해야 합니다.

- [renderer.js:737-740, main.js:1316-1331] guarded paste 직후의 지연 구간에서 agent가 종료되어 shell로 복귀해도 Enter는 일반 `pty:write-ack`로 전송됩니다. 이 경우 `okEnter`가 성공해 pin/error가 commit될 수 있지만 agent가 요청을 실제 처리했다는 보장이 없습니다. guarded paste와 Enter를 하나의 delivery transaction으로 만들고, Enter 직전에도 main process에서 PTY의 bracketed-paste 상태와 ticket을 재검증해야 합니다.

- [main-browser.js:417-450, main.js:1323-1331, scripts/test-electron-browser.js:213-231] **R6 context 생성 후 navigation 경쟁 — RESOLVED.** one-time token과 `pageGen`/view 재검증이 적용됐고, context 발급 후 reload 시 redemption 거부 및 replay 거부 회귀 테스트가 추가됐습니다.

- [main-browser.js:221-228, scripts/test-electron-browser.js:247-255] **R6 종료된 BrowserView의 stale network error 유입 — RESOLVED.** 현재 view의 `webContentsId`만 기록하며 close/reopen 뒤 늦은 500 응답을 제외하는 회귀 테스트가 추가됐습니다.

- [main-browser.js:164-169, main-browser.js:442-460, scripts/test-electron-browser.js:233-245] **R5 error cursor — RESOLVED.** monotonic sequence와 `reportedSeq`를 사용하며, ring-buffer overflow 이후 새 오류만 남는 회귀 테스트가 추가됐습니다.

- [main-browser.js:393-412, main-browser.js:417-441, renderer-browser.js:115-151] **R5 navigation/capture stale 처리 — RESOLVED.** pick/capture/clear 작업이 view와 document generation을 기준으로 fail-closed 처리합니다.

- [renderer.js:680-741] **R5 double-send 및 PTY acknowledgement — PARTIAL.** 전송 lock으로 이중 전송은 막혔으나, guarded paste 후 Enter acknowledgement는 위 경쟁으로 agent 처리 완료를 보장하지 못합니다.

- [main-browser.js:208-230, main-browser.js:290-302, main.js:1184-1193] **R5 BrowserView/debugger/session listener leak — RESOLVED.** toggle-off 및 window close에서 view/debugger를 해제하고 partition listener는 한 번만 등록합니다.

- [scripts/test-electron-browser.js:213-255] **R6 회귀 테스트 — RESOLVED.** stale token, replay token, ring-buffer cursor, close/reopen 뒤 늦은 network failure 경로가 추가됐습니다.

## 5. Minor 이슈

- [backlog/task-015.md:27] **R5 screenshot 저장 문서화 — RESOLVED.** 스크린샷 저장 위치가 프로젝트 경로가 아닌 app user-data 경로로 정정됐습니다.

- [main-browser.js:149-155] **R5 timeout timer — RESOLVED.** `finally()`에서 timeout timer를 해제합니다.

- [main-browser.js:295-299] **R5 debugger detach — RESOLVED.** BrowserView 종료 전에 debugger detach를 시도합니다.

## 6. Optional 제안

- [main-browser.js:181-182, main-browser.js:223-227, renderer-browser.js:228-241] URL credentials 및 `token`, `code`, `access_token` 계열 query parameter가 terminal context와 오류 목록에 남을 수 있습니다. URL 출력 전 credentials 제거 및 민감 query key redaction 정책을 적용해야 합니다.

- [renderer-browser.js:228-247] shell command injection은 차단됐지만 title, element text, console message는 LLM prompt-injection 입력입니다. 고정 문구로 “페이지 유래 비신뢰 데이터”임을 context에 표시하는 것이 좋습니다.

## 7. 최종 권고

- [ ] `[main-browser.js:221-228]` 오류를 page/document generation 또는 Chromium loader identity에 귀속하고, 새 문서 context에 이전 문서 오류가 포함되지 않게 한다.
- [ ] `[renderer.js:737-740]` Enter 전송을 guarded transaction으로 변경해 agent 종료 후 pin/error가 소비되지 않게 한다.
- [ ] 이전 페이지의 느린 subresource가 같은 BrowserView의 새 URL context에 포함되지 않는 E2E 테스트를 추가한다.
- [ ] guarded paste 직후 agent 종료 시 Enter/commit이 거절되고 pin/error가 보존되는 E2E 테스트를 추가한다.
- [ ] `npm run test:browser`는 현재 read-only sandbox에서 Temp directory 생성 권한(`EPERM: mkdtemp`) 때문에 실행 결과를 검증하지 못했습니다. 쓰기 권한 환경에서 전체 browser suite를 재실행해야 합니다.