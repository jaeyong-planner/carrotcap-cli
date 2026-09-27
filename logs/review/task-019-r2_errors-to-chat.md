# Review Report — task-019 errors-to-chat (Round 2)

## 1. 리뷰 대상

- 파일/모듈 목록: `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `backlog/task-019.md`
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +268 / -24
- 리뷰 시점: 2026-09-27T00:51:59Z

## 2. 전체 판단

- ❌ 반려
- Composer 전송 중 예외 처리와 terminal 직접 paste가 page-derived 문자열의 main guarded paste 경로를 우회합니다.

## 3. Critical 이슈

- [renderer.js:727-736, renderer.js:757-761] `decorate()`가 `browserContext()` 요청 중 reject되면 catch가 `prepared`를 기본 `plain` 값으로 유지합니다. 이후 페이지 오류가 포함된 `typed`가 일반 `term.paste()` 및 Enter 경로로 전송됩니다. 특히 브라우저 close/navigation과 IPC 실패가 겹치거나, 대상 agent가 shell로 전환된 경우 `# `를 사용자가 제거한 문자열이 plain shell에서 실행될 수 있습니다. → `typed`가 tainted이면 decorate 실패를 반드시 fail-closed 처리하여 입력을 복원하고 전송을 차단해야 합니다.

- [renderer.js:811-823, renderer.js:837-849, renderer.js:483] tainted clipboard text는 현재 agent pane으로 판정되면 `term.paste()`를 허용하며, 이는 `api.pasteGuarded()`와 one-time context token을 거치지 않고 `pty:write`로 전달됩니다. agent 종료와 shell 복귀의 경계에서 보호 검증이 main process에 없고, 편집되어 `# `가 사라진 page-derived 문자열이 plain shell로 갈 수 있습니다. → tainted 문자열의 terminal 직접 paste는 agent pane에서도 차단하고 Composer의 guarded send만 허용하거나, main-side guarded API로 일원화해야 합니다.

- [renderer-browser.js:228-233, renderer-browser.js:244-258] 서로 다른 문서에서 삽입한 오류 블록이 Composer에 함께 남으면 `taintOf()`는 마지막으로 매칭된 하나만 반환합니다. 현재 문서의 오류가 뒤에 있으면 이전 문서 오류의 `gen` 검증이 생략되어, stale 오류까지 현재 문서 token으로 agent에 전달됩니다. → 텍스트에 포함된 모든 taint entry를 수집하고, 하나라도 현재 `pageGen`과 다르면 전체 전송을 차단해야 합니다.

- [renderer-browser.js:223-258, renderer.js:717-754] Round 1 Critical 1 — header/`# ` 제거 뒤 Composer send 우회: **RESOLVED**. 오류 message snippet 기반 taint 판정으로 header 삭제·history recall 후에도 Composer 보호 경로가 유지됩니다.

- [renderer-browser.js:65-71, renderer-browser.js:244-248] Round 1 Critical 2 — browser close 뒤 plain 경로 전송: **RESOLVED**. browser mode/view가 닫힌 상태에서 tainted Composer text를 차단합니다.

- [renderer-browser.js:223-233, renderer.js:721-733] Round 1 Critical 3 — Composer history recall provenance 소실: **RESOLVED**. history에는 원문이 저장되어도 전송 시 text 기반 taint 판정이 다시 적용됩니다.

- [renderer.js:811-849] Round 1 Critical 4 — 일반 terminal clipboard paste 우회: **PARTIAL**. plain shell 판정 시 Ctrl+Shift+V와 DOM paste는 차단하지만, agent 판정 direct paste가 main guarded 경로를 우회합니다.

## 4. Major 이슈

- [renderer-browser.js:282-287, renderer-browser.js:310-331] 여러 삽입 블록을 편집해 pending header 검출을 피한 경우, 전달 성공 후 가장 최근 taint만 `committed`가 됩니다. main의 `browserCommit(mark)`는 더 큰 mark까지 소비하지만 이전 taint entry는 미완료 상태로 남아 이후 중복 방지·상태 판단과 실제 오류 cursor가 불일치합니다. → 하나의 send에 포함된 모든 taint entry를 함께 commit 처리하고, commit mark와 entry lifecycle을 일관되게 갱신해야 합니다.

- [renderer-browser.js:255-265] Round 1 Major 1 — 단일 삽입 오류의 stale `pageGen` 검증: **PARTIAL**. 단일 블록은 차단되지만, 여러 문서 오류가 함께 있을 때 앞선 stale block을 놓칩니다.

- [renderer-browser.js:304-313, renderer-browser.js:339-341] Round 1 Major 2 — 빠른 double-click 중복 삽입: **RESOLVED**. `st.inserting`과 즉시 disabled 렌더링으로 context 요청 중 재진입을 막습니다.

## 5. Minor 이슈

- [renderer-browser.js:333-338] Round 1 Minor 1 — 기존 Composer trailing whitespace 삭제: **RESOLVED**. 기존 값을 정규화하지 않고 필요한 구분 개행만 추가하며, input event·focus·caret도 갱신합니다.

- [scripts/test-electron-browser.js:142-165, scripts/test-electron-browser.js:209-221, scripts/test-electron-browser.js:400-406] Round 1 Minor 2 — 우회 경로 회귀 테스트: **PARTIAL**. header 제거, browser close, navigation, Ctrl+Shift+V, DOM paste, double-click은 검증하지만 실제 ArrowUp history recall, `browserContext()` reject/close race, agent pane direct paste의 guarded-path 보장은 검증하지 않습니다.

## 6. Optional 제안

- [renderer-browser.js:301-305, renderer-browser.js:309-311] 전송 전 삽입 블록이 있는 동안 새 오류 count는 계속 표시되지만 버튼 클릭은 focus만 이동합니다. → `pending`일 때 버튼 문구 또는 notice에 “입력창의 기존 오류를 먼저 전송하거나 제거”를 명시해 현재 새 오류가 삽입되지 않는 이유를 표시하는 편이 적절합니다.

## 7. 최종 권고

- [ ] [renderer.js:727-761] tainted Composer text에 대한 decorate 예외를 plain fallback으로 전송하지 않도록 fail-closed 처리한다.
- [ ] [renderer.js:811-849] page-derived text의 terminal 직접 paste를 제거하거나 main `pasteGuarded` 검증으로 일원화한다.
- [ ] [renderer-browser.js:228-287] 복수 taint entry를 전체 검사·전체 commit하여 stale 문서 오류와 bookkeeping 불일치를 막는다.
- [ ] [scripts/test-electron-browser.js:142-221] `browserContext()` 실패/close race에서 shell 미전송, 실제 history recall, agent pane paste 후 shell 전환 경계, 복수 문서 오류 혼합 전송 차단을 E2E로 추가한다.