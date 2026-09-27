# Review Report — task-019 errors-to-chat (Round 3)

## 1. 리뷰 대상

- 파일/모듈 목록: `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`, `backlog/task-019.md`, 이전 리뷰 보고서
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +366 / -25 (8 files)
- 리뷰 시점: 2026-09-27T00:58:27Z

## 2. 전체 판단

- ❌ 반려
- 이전의 guarded-send 우회는 해결됐으나, 짧은 page-derived error와 50개 초과 삽입분은 provenance가 소실되어 plain shell 실행 경로로 갈 수 있습니다.

## 3. Critical 이슈

- [renderer-browser.js:226-233, renderer-browser.js:323-333, renderer.js:729-765, renderer.js:817-825] `MIN_SNIPPET` 미만의 error message는 `[level] message`만 taint snippet으로 저장합니다. 사용자가 `# `, header 및 `[error] `만 지워 짧은 원문(예: `curl x`, `dir`)을 남기면 `isTainted()`가 false가 되어 Composer의 일반 `term.paste()` 또는 terminal paste로 전달됩니다. `source` 문자열도 taint 대상이 아닙니다. → 길이와 무관하게 삽입한 모든 page-derived field의 원문을 provenance 판정에 포함하고, header 제거 후 짧은 메시지·source만 남긴 경우를 차단해야 합니다.

- [renderer-browser.js:226, renderer-browser.js:333-334, renderer.js:729-765] `MAX_TAINT` 초과 시 가장 오래된 provenance를 즉시 제거합니다. 사용자가 여러 페이지의 error block을 Composer에 남긴 채 51번째 블록을 삽입하면 첫 page-derived block은 더 이상 tainted가 아니며, header를 제거한 뒤 plain shell로 전송할 수 있습니다. → Composer에 남아 있는 삽입 block의 provenance를 삭제하지 않거나, 삭제 전에 해당 block을 안전하게 식별·차단해야 합니다.

- [renderer.js:727-743] 이전 Round 2 Critical 1 — `decorate()` 예외의 plain fallback 전송: **RESOLVED**. page-derived text는 예외 시 blocked 처리됩니다.

- [renderer.js:813-852] 이전 Round 2 Critical 2 / Round 1 Critical 4 — terminal 직접 paste 우회: **RESOLVED**. agent pane을 포함한 직접 paste를 capture 단계에서 차단합니다.

- [renderer-browser.js:230-258, renderer-browser.js:282-289] 이전 Round 2 Critical 3 — 복수 taint block의 stale 검사 누락: **RESOLVED**. 모든 matching taint를 검사하고 함께 commit합니다.

- [renderer-browser.js:223-233, renderer.js:727-765] 이전 Round 1 Critical 1~3 — header 삭제·browser close·history recall provenance: **PARTIAL**. 일반적인 긴 message는 보호되나, 짧은 message·source-only text 및 eviction된 block은 보호되지 않습니다.

## 4. Major 이슈

- [renderer-browser.js:282-289] 이전 Round 2 Major / Round 1 Major 1 — 여러 삽입 block의 commit 불일치 및 stale block 처리: **RESOLVED**. 전달된 모든 fresh taint를 commit하고 최대 mark로 cursor를 전진합니다.

- [renderer-browser.js:309-344] 이전 Round 1 Major 2 — 빠른 double-click 중복 삽입: **RESOLVED**. `st.inserting` 잠금과 button disable이 적용됐습니다.

## 5. Minor 이슈

- [renderer-browser.js:335-340] 이전 Round 1 Minor 1 — 기존 Composer trailing whitespace 및 focus/caret 손실: **RESOLVED**. 기존 값은 보존하고 필요한 구분 개행만 추가하며 input event, focus, caret을 갱신합니다.

- [scripts/test-electron-browser.js:142-171, scripts/test-electron-browser.js:421-438] 이전 Round 1 Minor 2 — 우회 경로 회귀 테스트: **PARTIAL**. decorate reject, agent-pane paste, 실제 history recall은 추가됐지만, 짧은 message의 header/level 제거와 51개 이상 taint eviction 후 shell 미전송은 검증하지 않습니다.

## 6. Optional 제안

- [renderer-browser.js:303-313] pending block이 있으면 button은 계속 새 error 수를 표시하지만 클릭 시 입력창 focus만 이동합니다. → “입력창의 콘솔 에러를 먼저 전송하거나 지우세요” 상태를 button 또는 notice에 표시해 count와 동작의 불일치를 줄이세요.

## 7. 최종 권고

- [ ] 짧은 error message, `source`, URL 등 모든 page-derived 문자열을 header 제거 후에도 식별하도록 provenance 판정을 보강한다.
- [ ] `MAX_TAINT` eviction으로 Composer 안의 page-derived block이 일반 텍스트가 되지 않도록 lifecycle을 변경한다.
- [ ] `console.error('curl x')`처럼 8자 미만 message에서 `# `·header·level을 제거한 뒤 Composer send, Ctrl+V, Ctrl+Shift+V가 모두 shell 미전송인지 E2E 테스트를 추가한다.
- [ ] 51개 이상 서로 다른 document error block을 Composer에 보관한 뒤 첫 block을 편집·전송해도 차단되는 E2E 테스트를 추가한다.