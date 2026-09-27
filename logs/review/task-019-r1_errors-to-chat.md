# Review Report — task-019 errors-to-chat (Round 1)

## 1. 리뷰 대상

- 파일/모듈 목록: `backlog/task-019.md`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`
- 변경 라인 수: 94 additions / 16 deletions
- 리뷰 시점: 2026-09-27T00:44:28Z

## 2. 전체 판단

- ❌ 반려
- 페이지 유래 콘솔 오류의 provenance를 `header` 문자열 존재 여부로만 판단해, 편집·브라우저 종료·history recall 시 일반 셸 전송 경로로 우회됩니다.

## 3. Critical 이슈

- [renderer-browser.js:227-231, renderer-browser.js:288-302, renderer.js:757-761] `st.inserted.header`를 사용자가 삭제·수정하면 `decorate()`가 `plain`을 반환하고, 오류 본문은 일반 `term.paste()`와 Enter 경로로 전송됩니다. `# ` prefix와 control-character 정리는 사용자가 prefix를 수정한 뒤에는 Command Injection 방어가 될 수 없습니다. → 삽입된 오류 블록의 provenance를 header 문자열에 의존하지 말고, 블록이 수정·삭제되었어도 일반 셸 전송을 fail-closed 하도록 별도 상태/범위를 관리해야 합니다.

- [renderer-browser.js:64-70, renderer-browser.js:227, renderer.js:757-761] 브라우저 모드를 닫아도 입력창과 `st.inserted`는 유지되지만 `decorate()`는 `!st.active || !st.open`에서 즉시 plain 경로로 반환합니다. 따라서 오류 블록을 넣은 뒤 브라우저를 닫고 일반 셸로 보내면 guarded paste를 거치지 않습니다. → browser close 시 해당 페이지 유래 블록을 제거하거나, 블록이 존재하는 동안에는 browser mode 상태와 무관하게 guarded agent-only 전송 또는 명시적 차단을 적용해야 합니다.

- [renderer.js:721-723, renderer-browser.js:263-266, renderer.js:781-791, renderer.js:757-761] 성공 전송 뒤 `commit()`이 `st.inserted`를 `null`로 만들지만, 같은 오류 포함 메시지는 composer history에 남습니다. History recall 후에는 provenance가 소실되어 일반 셸로 raw 전송됩니다. → history 항목에도 page-derived 여부를 보존하고, recall된 항목은 agent-only guarded path로 유지하거나 일반 셸 전송 전에 차단해야 합니다.

- [renderer-browser.js:300-305, renderer.js:805-825, renderer.js:892-899] 오류가 일반 textarea에 들어가므로 사용자가 복사한 뒤 terminal paste 기능으로 일반 셸에 직접 붙여넣을 수 있습니다. 현재는 `# `가 남아 있을 때만 우연히 안전하며, 수정된 오류 문자열은 보호되지 않습니다. → “페이지-derived 문자열은 agent pane만”이 보안 요구사항이면 editable 원문을 OS clipboard/terminal paste로 반출 가능한 설계를 재검토하고, 최소한 수정된 블록의 일반 셸 전송을 차단하는 회귀 테스트를 추가해야 합니다.

## 4. Major 이슈

- [renderer-browser.js:204-213, renderer-browser.js:230, renderer-browser.js:238-274, renderer-browser.js:302] `inserted`는 `header`와 `mark`만 저장하고 오류를 수집한 `pageGen`을 보존하지 않습니다. 페이지 이동 후에도 이전 문서의 오류 블록은 남고, 전송 시에는 새 문서의 `browserContext()` token으로 guarded paste가 성공합니다. 결과적으로 “현재 문서만”이라는 stale-context 보장이 pins 없이 삽입된 오류에는 적용되지 않습니다. → 삽입 시 generation을 저장하고 generation 변경 시 블록을 제거하거나 전송을 차단해야 합니다.

- [renderer-browser.js:286-310] 버튼 click handler에 in-flight lock 또는 즉시 disable 처리가 없습니다. 빠른 double-click은 두 호출이 모두 `await browserContext()` 이전의 `st.inserted === null`을 관찰해 동일 오류 블록을 두 번 삽입할 수 있습니다. → context 요청부터 삽입 완료까지 단일 pending 상태로 직렬화하고, 완료 전 버튼을 비활성화해야 합니다.

## 5. Minor 이슈

- [renderer-browser.js:300-301] 기존 composer 값에 `replace(/\s+$/, '')`를 적용해 사용자가 입력한 trailing space 및 빈 줄을 오류 삽입 시 삭제합니다. → 사용자 입력을 정규화하지 말고, 필요할 경우 오류 블록 앞의 구분 개행만 조건부로 추가해야 합니다.

- [scripts/test-electron-browser.js:122-158, scripts/test-electron-browser.js:167-174] 현재 테스트는 정상 header·브라우저 유지·순차 click만 검증합니다. header 삭제/수정, browser close, history recall, navigation 후 전송, 빠른 double-click을 검증하지 않아 위 회귀를 탐지하지 못합니다. → 각 우회 경로에서 일반 셸 PTY가 page-derived 문자열을 받지 않고 입력 내용이 보존되는 E2E 테스트를 추가해야 합니다.

## 6. Optional 제안

- [index.html:114, renderer-browser.js:282-284] 버튼은 삽입 후에도 동일한 “새 콘솔 에러 N건” 상태를 표시합니다. 이는 실제 delivery 전 new 상태를 유지하는 요구사항에는 맞지만, 사용자가 이미 삽입한 블록이 있다는 사실은 표시하지 않습니다. → 삽입 상태일 때 “입력창에 추가됨—전송 전 수정 가능”을 표시해 재클릭 동작을 예측 가능하게 해야 합니다.

## 7. 최종 권고

- [ ] [renderer-browser.js:227-231] header 문자열 검출 기반의 보호 결정을 제거하고, 편집·삭제·history recall·browser close 뒤에도 page-derived content가 plain PTY 경로에 도달하지 않도록 fail-closed 처리한다.
- [ ] [renderer-browser.js:204-213, renderer-browser.js:302] 삽입 오류와 `pageGen`을 연결하고 navigation/close 시 stale block을 안전하게 처리한다.
- [ ] [renderer-browser.js:286-310] 오류 삽입 작업을 직렬화해 빠른 double-click 중복 삽입을 막는다.
- [ ] [scripts/test-electron-browser.js:122-174] header 삭제·`# ` 제거, browser close, history recall, terminal clipboard paste, navigation 후 send, concurrent double-click의 plain-shell 미전송 회귀 테스트를 추가한다.
