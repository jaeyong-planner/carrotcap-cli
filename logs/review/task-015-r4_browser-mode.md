# Review Report — task-015 browser mode (Round 4)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: task-015 전체 기준 1,146 additions / 34 deletions; 최신 HEAD 기준 대상 파일 67 additions / 37 deletions
- 리뷰 시점: 2026-09-26T15:55:51Z

## 2. 전체 판단

- ❌ 반려
- BrowserView/IPC 격리 및 project-junction screenshot 경로는 개선됐지만, 동일 URL reload 시 이전 페이지의 pin을 새 문서 컨텍스트로 전송하는 경쟁 상태와 capture 중 close/navigation의 stale 처리 누락이 남아 있습니다.

## 3. Critical 이슈

- [main-browser.js:303-310, main-browser.js:322-350] **R3 C2 — RESOLVED.** screenshot 저장 대상이 사용자 project가 아닌 app user-data 경로로 이동하여 hostile repository의 junction 교체로 workspace 밖에 쓰기·prune하는 기존 경로가 제거됐습니다.
- [main-browser.js:205-243] **R3 C1 — RESOLVED.** 비영구 partition, `file:` request 차단, navigation/redirect/popup의 HTTP(S) 제한으로 BrowserView의 로컬 파일 이동 경로를 차단했습니다.
- [main-browser.js:38-43, main-browser.js:187-193, renderer-browser.js:37-38, renderer.js:731-739] **R3 C3 — RESOLVED.** 페이지 유래 문자열의 control character를 제거하고, bracketed paste 내부의 ESC도 제거합니다. BrowserView는 preload 없이 `sandbox`, `contextIsolation`, `nodeIntegration: false`를 유지합니다.

## 4. Major 이슈

- [renderer-browser.js:174-197, renderer-browser.js:216-249, main-browser.js:418-439] **R3 navigation/context generation — PARTIAL.** `pageGen`은 도입됐지만 renderer는 URL이 바뀔 때만 pin 목록을 비웁니다. 같은 URL의 `reload`, history navigation, 서버 측 재응답은 새 document를 만들고 `pageGen`을 증가시키지만 기존 `st.pins`가 남습니다. 이후 `browserContext()`는 새 `st.pageGen`을 보내므로 검증을 통과하고, 이전 document의 selector/text를 새 페이지 screenshot·URL과 함께 전송합니다. `pageGen` 변경 자체를 기준으로 pin을 비우거나 각 pin에 생성 세대를 기록해 context 생성 시 모두 일치하는지 검증해야 합니다.

- [main-browser.js:423-432, renderer-browser.js:216-223] capture 중 BrowserView를 닫거나 navigation하면 `capturePage()`가 reject할 수 있으나, catch가 `{ stale: true }`를 반환하지 않고 이전 URL과 pin으로 context를 계속 반환합니다. 따라서 이미 browser mode를 종료했거나 문서가 바뀐 뒤에도 이전 페이지 컨텍스트가 agent terminal에 전송될 수 있습니다. capture 전후 및 catch에서 `view === capturedView && pageGen === gen`을 확인하고, 불일치 시 반드시 stale로 fail-closed 해야 합니다.

- [main-browser.js:441-446, renderer-browser.js:243-249] `browser:commit`은 `errorMark`만 받아 page generation을 검증하지 않습니다. 전송 대기 중 navigation 뒤에도 이전 context의 commit이 적용됩니다. `browser:commit`에 `gen` 또는 opaque context token을 포함하고, 현재 document와 불일치하면 error 소비를 거절해야 합니다.

- [renderer.js:681-741] **R3 double-send — RESOLVED.** send lock과 버튼 비활성화가 `decorate()`부터 PTY Enter/commit 완료까지 유지되어 중복 전송을 차단합니다.

- [main.js:1281-1305, renderer.js:735-740] **R3 M3 — RESOLVED.** paste와 Enter가 모두 IPC write acknowledgement를 받아야 commit합니다.

- [renderer-browser.js:115-151, renderer-browser.js:186-197] **R3 M4 — RESOLVED.** `gone` 상태에서는 annotation mode를 유지하고, load 완료 후 loop를 재시작합니다.

- [main-browser.js:284-296, main-browser.js:354-370] **R3 M5 — RESOLVED.** `openGen` 및 view 동일성 검증으로 늦은 open 결과가 새 view를 변경하지 못하게 합니다.

- [renderer-browser.js:243-249, main-browser.js:402-409] **R3 기존 pin snapshot 경쟁 — PARTIAL.** 특정 pin 번호만 제거하고 generation을 전달한 점은 적절합니다. 다만 동일 URL 새 document에서 이전 pin이 남는 문제로 generation 보장이 완전하지 않습니다.

- [main-browser.js:205-224] **R3 M1 — RESOLVED.** shared partition session handler는 `sessionReady`로 한 번만 등록됩니다.

- [main.js:1170-1180, main-browser.js:284-296] **R3 M2 — RESOLVED.** 창 종료 및 toggle-off에서 BrowserView를 remove/close하고 참조를 해제합니다.

## 5. Minor 이슈

- [main-browser.js:149-155] **R3 Minor 1 — RESOLVED.** timeout timer는 `finally()`에서 해제됩니다.

- [main-browser.js:289-291] **R3 Minor 2 — RESOLVED.** BrowserView 제거 전에 debugger detach를 시도합니다.

- [scripts/test-electron-browser.js:141-189] **R3 Minor 3 — PARTIAL.** hostile terminal control text, file redirect, project junction, double-click은 회귀 검증하지만, 동일 URL reload 뒤 이전 pin이 전송되지 않는지, capture 중 navigation/close/reopen이 stale 처리되는지, generation 불일치 commit이 error 상태를 보존하는지는 검증하지 않습니다. 또한 이번 환경의 `npm run test:browser`는 `mkdtemp` 권한 오류(`EPERM`)로 실행 완료하지 못했습니다.

- [main-browser.js:299-306] 주석은 여전히 project 저장 구조를 설명하지만 실제 구현은 user-data 저장소를 사용합니다. backlog 설계 및 코드 주석을 현재 보안 결정과 일치시켜야 합니다.

## 6. Optional 제안

- [main-browser.js:216-222, main-browser.js:422, renderer-browser.js:225-238] **R3 Optional — UNRESOLVED.** URL 및 network error에는 credentials, token 등 민감한 query 값이 포함될 수 있습니다. agent context에 넣기 전 URL credentials 제거와 민감 query key redaction을 적용하는 것이 좋습니다.

- [renderer-browser.js:225-242] 페이지 유래 문자열이 비신뢰 데이터이며 내부 지시를 따르지 말아야 한다는 고정 안내문을 context 블록에 추가하면 LLM prompt-injection 오해를 줄일 수 있습니다.

## 7. 최종 권고

- [ ] `pageGen` 변경 시 URL 비교와 무관하게 pin을 무효화하고, pin의 생성 세대와 context 세대를 일치 검증한다.
- [ ] capture 성공·실패 경로 모두에서 view/page generation을 재검증하고, close/navigation이면 `{ stale: true }`로 반환한다.
- [ ] `browser:commit`에 generation 또는 context token을 추가해 stale context가 error 상태를 소비하지 못하게 한다.
- [ ] 동일 URL reload, capture 중 navigation, capture 중 close/reopen, stale commit 거절 회귀 테스트를 추가한다.
- [ ] 권한이 있는 환경에서 `npm run test:browser`를 재실행한다.