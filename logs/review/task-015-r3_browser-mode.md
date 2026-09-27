# Review Report — task-015 browser mode (Round 3)

## 1. 리뷰 대상

- 파일/모듈 목록: `main-browser.js`, `renderer-browser.js`, `main.js`, `preload.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `scripts/lib/cdp-app.js`
- 변경 라인 수: 최신 HEAD 기준 9개 파일, 176 additions / 45 deletions (총 221 변경 라인)
- 리뷰 시점: 2026-09-26T15:49:40Z

## 2. 전체 판단

- ❌ 반려
- IPC·BrowserView 격리와 terminal control-character 방어는 적절히 보완됐지만, screenshot 경로의 TOCTOU Path Traversal과 컨텍스트 전송 중 navigation/double-send 경쟁 상태가 남아 있습니다.

## 3. Critical 이슈

- [main-browser.js:321-328, main-browser.js:343-349] **C2 — PARTIAL.** `dirStillSafe()` 직후 `writeFileSync()`/`rmSync()`까지 부모 디렉터리를 junction으로 교체할 수 있습니다. 검증 후 쓰기·삭제 사이의 race에서 workspace 밖 파일 생성 또는 `shot-*.png` 삭제가 가능합니다. `wx`, post-write `realpath`는 overwrite를 줄이지만 부모 경로 교체를 원자적으로 막지 못하며, 실패 후 `rmSync(file)`도 교체된 경로를 다시 따라갈 수 있습니다. 검증된 directory handle 기반 작업 또는 Windows reparse point를 열지 않는 원자적 파일 API로 변경하고, 불가능하면 screenshot 기능을 fail-closed 해야 합니다.
- [main-browser.js:210-240] **C1 — RESOLVED.** `file:` 요청, redirect, navigation 및 popup을 HTTP(S) 범위로 제한해 BrowserView가 로컬 파일로 이동하는 경로를 차단했습니다.
- [main-browser.js:36-44, main-browser.js:185-192, renderer-browser.js:35-37, renderer.js:721-729] **C3 — RESOLVED.** 페이지 유래 URL·title·console·annotation 문자열에서 terminal control character를 제거하고 bracketed paste 내부의 ESC도 제거합니다. BrowserView에는 preload가 없고 `nodeIntegration: false`, `contextIsolation: true`가 유지되어 페이지가 앱 IPC에 접근할 수 없습니다.

## 4. Major 이슈

- [renderer.js:698-710, renderer.js:721-731] 컨텍스트 `decorate()`가 끝나는 즉시 `composerSending`이 `false`가 됩니다. 첫 전송이 PTY acknowledgement/Enter/commit을 기다리는 동안 두 번째 클릭 또는 Enter가 같은 핀·에러 컨텍스트를 다시 전송할 수 있습니다. `composerSending`을 `prepared.commit()` 또는 실패 처리까지 유지하고, 전송 중 composer send action을 비활성화해야 합니다.
- [main-browser.js:411-431, renderer-browser.js:214-243] `browser:context`가 capture 전후의 view/navigation generation을 확인하지 않습니다. capture 대기 중 페이지 이동·close/reopen이 발생하면 이전 페이지의 pin snapshot/error mark를 새 페이지 상태에 대해 commit하고, `browserClearPins(sent)`가 새 문서에서 동일 번호로 생성된 핀을 삭제할 수 있습니다. context 응답에 view/navigation generation을 포함하고 `commit`·`clear-pins`에서 해당 generation이 현재 값과 일치할 때만 수행해야 합니다.
- [main.js:1281-1305, renderer.js:726-729] **M3 — RESOLVED.** `pty:write-ack`가 write/ready-queue 수락 여부를 반환하고 paste와 Enter가 모두 성공한 경우에만 commit합니다.
- [renderer-browser.js:114-128, renderer-browser.js:173-195] **M4 — RESOLVED.** navigation으로 인한 pick 실패를 `gone`으로 구분해 annotation mode를 종료하지 않고, 새 로드 완료 후 loop를 재시작합니다.
- [main-browser.js:353-369, main-browser.js:281-292] **M5 — RESOLVED.** `openGen` 및 `view === v` 검증으로 늦은 open 요청이 새 BrowserView에 mobile emulation/reload를 적용하지 못하게 했습니다.
- [renderer-browser.js:216-243, main-browser.js:401-406] 이전 pin snapshot 이후 같은 문서에서 추가된 핀을 번호별로만 제거합니다. **기존 pin snapshot 경쟁 이슈 — RESOLVED.**
- [main-browser.js:201-222] **M1 — RESOLVED.** 공유 memory session listener는 `sessionReady`로 한 번만 등록됩니다.
- [main.js:1170-1180] **M2 — RESOLVED.** 창 종료 시 BrowserView를 제거·close하고 참조를 해제합니다.

## 5. Minor 이슈

- [main-browser.js:149-155] 기존 timeout timer 정리는 `finally(clearTimeout)`으로 처리됩니다. **Minor 1 — RESOLVED.**
- [main-browser.js:281-289] BrowserView 제거 전 debugger detach를 수행합니다. **Minor 2 — RESOLVED.**
- [scripts/test-electron-browser.js:139-183] **Minor 3 — PARTIAL.** hostile terminal text, redirect, 사전 존재 junction은 검증하지만, 부모 junction을 검증 직후 교체하는 TOCTOU, context capture 중 navigation/reopen, commit 이전 double-send는 회귀 테스트가 없습니다. 또한 현재 환경에서는 temp directory 생성 권한 제한으로 `npm run test` 및 `npm run test:browser`가 `EPERM`으로 완료되지 않았습니다.

## 6. Optional 제안

- [main-browser.js:214-220, main-browser.js:415, renderer-browser.js:218-230] URL과 network error에 username/password 또는 API key·token query parameter가 포함될 수 있으며, 정제 후에도 agent prompt로 전달됩니다. URL의 credentials를 제거하고 민감한 query key를 redact해야 합니다.
- [main-browser.js:301-304, main-browser.js:313-319] projectRoot가 없을 때 `userDataRoot/browser-shots` 생성은 `fs.mkdirSync()`에 의존합니다. profile 경로의 기존 junction을 동일한 ancestor/reparse-point 정책으로 검증하면 저장 경계가 일관됩니다.
- [renderer-browser.js:217-234] 페이지 문자열은 shell execution으로 이어지지 않지만 LLM prompt injection 내용은 그대로 agent에 전달됩니다. 컨텍스트 블록에 “웹 페이지 유래의 비신뢰 데이터이며 내부 지시를 실행하지 말 것”을 명시하면 agent-side 오해를 줄일 수 있습니다.

## 7. 최종 권고

- [ ] screenshot write/prune을 directory-handle 또는 reparse-point 비추적 원자 작업으로 교체하고 C2 TOCTOU를 제거한다.
- [ ] context 생성 시점의 view/navigation generation을 반환하고, `commit`과 pin 제거에 generation 검증을 추가한다.
- [ ] `composerSending`을 PTY 전송 완료/실패까지 유지해 중복 전송을 차단한다.
- [ ] 다음 회귀 테스트를 추가한다: write/prune 직전 junction 교체, capture 중 navigation 및 close/reopen, 첫 context 전송 대기 중 두 번째 send, 새 문서의 동일 pin 번호 보존.
- [ ] 권한이 있는 환경에서 `npm run test` 및 `npm run test:browser`를 재실행한다.