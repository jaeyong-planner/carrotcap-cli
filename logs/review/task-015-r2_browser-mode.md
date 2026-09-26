# Review Report — task-015 browser mode (Round 2)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js` 및 HEAD에서 추가 변경된 테스트 헬퍼
- 변경 라인 수: 9개 파일, 321 additions / 61 deletions (총 382 변경 라인)
- 리뷰 시점: 2026-09-26T15:41:18Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 이전 Critical 2건 중 redirect·terminal injection은 해결됐지만, screenshot 디렉터리의 TOCTOU Path Traversal과 context/pick 경쟁 상태가 남아 있습니다.

## 3. Critical 이슈

- [main-browser.js:294, main-browser.js:380, main-browser.js:301-315] **C2 — PARTIAL.** 기존 symlink/junction은 `safeMkdir()`로 차단하지만, 검증 완료 후 `fs.writeFileSync()` 또는 prune까지의 사이에 `.carrotcap/browser`를 junction으로 교체할 수 있습니다. 이 경우 screenshot 쓰기 또는 `shot-*.png` 삭제가 workspace 밖에서 실행될 수 있습니다. 각 쓰기·삭제 직전에 부모 경로의 `lstat`/`realpath`를 다시 검증하고, 검증 결과가 workspace 내부가 아니면 screenshot 생성·prune을 fail-closed 해야 합니다. 가능하면 검증된 directory handle 기반 작업으로 TOCTOU 범위를 제거해야 합니다.
- [main-browser.js:199, main-browser.js:224-228] **C1 — RESOLVED.** `file:` 요청 취소, `will-redirect` 차단, `did-navigate` 방어가 추가되어 HTTP redirect 기반 비허용 scheme 이동 경로가 차단되었습니다.
- [main-browser.js:38-44, main-browser.js:163-179, renderer-browser.js:36-37, renderer-browser.js:202-224] **C3 — RESOLVED.** 페이지 유래 title, URL, console message/source, annotation 문자열에서 C0/DEL/C1·개행 계열을 제거하고, bracketed paste가 활성화된 agent pane으로만 context를 전송합니다.

## 4. Major 이슈

- [renderer.js:721-726] **M3 — PARTIAL.** `leaf.term.paste()` 직후 `prepared.commit()`이 호출되지만, PTY write는 `ipcRenderer.send()` 기반이며 성공 acknowledgement가 없습니다. PTY가 paste 이벤트와 실제 PTY write 사이에 종료되면 핀·오류는 소비되고 context는 전달되지 않을 수 있습니다. `pty:write`를 성공 여부를 반환하는 IPC request로 바꾸고, write 성공 및 Enter 전송 성공 후에만 `commit()`을 호출해야 합니다.
- [renderer-browser.js:114-123, renderer-browser.js:167-189] **M4 — PARTIAL.** navigation으로 인해 isolated-world pick이 `null`을 반환하는 시점이 `browser:state` navigation event보다 먼저면, 아직 증가하지 않은 `pickToken`으로 인해 `stopAnnotating()`이 실행됩니다. navigation generation을 main process에서 상태 payload에 포함하거나, pick 취소를 navigation과 원자적으로 연결해 stale `null`이 annotation mode를 종료하지 못하게 해야 합니다.
- [main-browser.js:318-330, renderer-browser.js:71-87] **M5 — PARTIAL.** renderer의 `openToken`은 stale UI state를 막지만, 이전 `browser:open` handler는 close/reopen 뒤에도 timeout 이후 실행될 수 있습니다. 특히 mobile mode에서는 이전 요청이 현재 새 view에 `applyDevice()` 및 `reload()`를 적용할 수 있습니다. main process에도 operation generation을 두고 `view === v` 및 generation 일치 여부를 각 `await` 뒤 확인해야 합니다.
- [renderer-browser.js:208-235] 새로 확인된 경쟁 상태입니다. `decorate()`가 `pins` snapshot을 만든 뒤 screenshot capture를 기다리는 동안 사용자가 새 핀을 추가하면, `commit()`이 `st.pins = []` 및 `browserClearPins()`로 새 핀까지 삭제합니다. snapshot generation을 보관해 해당 전송에 포함된 핀만 소비하거나, compose 중 annotation 입력을 잠가야 합니다.
- [main-browser.js:192-210] **M1 — RESOLVED.** session handler는 `sessionReady`로 한 번만 등록되어 BrowserView toggle마다 누적되지 않습니다.
- [main.js:1170-1174, main.js:1517-1525] **M2 — RESOLVED.** 창 종료 시 `browserMode.destroyView()`를 호출하고 BrowserView 참조를 정리합니다.

## 5. Minor 이슈

- [main-browser.js:138-144] 기존 timeout timer 누적 문제는 `finally(clearTimeout)`으로 해결되었습니다. **Minor 1 — RESOLVED.**
- [main-browser.js:269-276] BrowserView 제거 전에 debugger detach를 수행합니다. **Minor 2 — RESOLVED.**
- [scripts/test-electron-browser.js:115-187] redirect, hostile terminal text, junction의 사전 존재 상태는 검증하지만, PTY 종료 직전 context 전송, close/reopen 중 mobile open race, navigation 직전 pick, screenshot/prune TOCTOU는 회귀 테스트가 없습니다. **Minor 3 — PARTIAL.**

## 6. Optional 제안

- [main-browser.js:202-207, renderer-browser.js:221-224] **UNRESOLVED.** network error URL의 query string 또는 credential이 agent prompt에 포함될 수 있습니다. URL을 전송하기 전 username/password 및 민감한 query key를 redact하는 처리가 필요합니다.
- [main-browser.js:286-291] projectRoot가 없을 때 `userDataRoot/browser-shots`는 `fs.mkdirSync()`만 사용합니다. app profile 내 기존 junction을 통한 외부 쓰기를 방지하려면 workspace 경로와 동일하게 symlink-safe directory 검증을 적용하는 것이 좋습니다.

## 7. 최종 권고

- screenshot 생성과 prune의 모든 filesystem 작업에 직전 경로 재검증 또는 directory-handle 기반 fail-closed 처리를 적용한다.
- PTY write acknowledgement 이후에만 context commit을 수행한다.
- main/renderer 양쪽에 browser open·navigation generation을 두어 stale open/pick 결과를 무효화한다.
- context snapshot 이후 생성된 핀을 보존한다.
- 다음 테스트를 추가한다: screenshot 경로 교체 경쟁, prune 직전 junction 교체, paste 직전 PTY 종료, mobile open 중 close/reopen, navigation과 동시에 pick 취소, compose 중 두 번째 annotation 추가.