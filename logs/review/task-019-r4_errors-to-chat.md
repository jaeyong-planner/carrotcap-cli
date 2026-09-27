# Review Report — task-019 errors-to-chat (Round 4)

## 1. 리뷰 대상

- 파일/모듈 목록: `renderer-browser.js`, `renderer.js`, `index.html`, `styles.css`, `scripts/test-electron-browser.js`
- 변경 라인 수: `feature/v0.2.0..HEAD` 기준 +204 / -25 (대상 파일)
- 리뷰 시점: 2026-09-27T01:06:07Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 편집 가능한 Composer·history로의 page-derived text 유입은 제거됐고 guarded paste도 유지됐지만, 첨부 갱신/닫기 중 IPC 경쟁 상태에서 task-015 context token과 첨부 lifecycle이 깨질 수 있습니다.

## 3. Critical 이슈

- [renderer-browser.js:245-337, renderer.js:729-765] 이전 Round 3 Critical — 짧은 error/source, 50개 초과 provenance eviction, header 삭제·history recall에 따른 plain-shell 유입: **RESOLVED**. page-derived error는 읽기 전용 chip에만 보관되고 Composer value/history에 삽입되지 않으며, 첨부가 있으면 guarded context 결과가 아닌 전송을 fail-closed 처리합니다.

- [renderer.js:731-744] 이전 Round 2 Critical — `decorate()` 예외 시 plain fallback 전송: **RESOLVED**. 첨부 존재 시 예외와 예상 밖 반환값 모두 `blocked`로 바꾸고 입력을 복원합니다.

- [renderer-browser.js:290-336, main-browser.js:463-515, renderer.js:755-763] 이전 Round 2 Critical — 복수 provenance block의 stale 검사 및 token 재사용: **RESOLVED**. 첨부는 문서 generation을 보유하고, main의 one-time context token이 navigation/loading 상태에서 재검증됩니다.

- [styles.css:141-146, renderer-browser.js:245-275] 이전 Round 2 Critical — terminal paste/clipboard 경유 우회: **RESOLVED**. 첨부 문자열은 Composer 입력값에 존재하지 않고 chip은 `user-select: none`이며, 실제 전달은 guarded paste 경로만 사용합니다.

## 4. Major 이슈

- [renderer-browser.js:294, renderer-browser.js:347-356, main-browser.js:491-492, renderer.js:755-762] 첨부 조회용 `browserContext()`도 one-time `contextTicket`을 발급·교체합니다. 기존 첨부를 전송하는 동안 사용자가 “첨부 새로고침”을 누르면, send가 확보한 token이 첨부 조회 IPC에 의해 덮여 `pasteGuarded()`가 실패합니다. → 오류 첨부 조회에는 token을 발급하지 않는 IPC 옵션을 두거나, Composer 전송 중에는 첨부 버튼을 비활성화해야 합니다.

- [renderer-browser.js:66-73, renderer-browser.js:193-194, renderer-browser.js:347-356] 브라우저 닫기와 `attachErrors()` 응답이 경합하면 닫기에서 `dropAttachment()`한 뒤에도 await 중이던 호출이 옛 context를 다시 `st.attach`에 기록할 수 있습니다. `open:false` 상태 이벤트는 즉시 반환하여 state를 정리하지 않습니다. → await 뒤에 `st.active`, `st.open`, 호출 시점의 lifecycle token 및 view generation을 모두 재검증하고, 닫힘 state에서도 attachment를 제거해야 합니다.

- [renderer-browser.js:282, renderer-browser.js:323-328, renderer-browser.js:254-260] 전송 준비 중 사용자가 ✕를 눌러 첨부를 제거해도, `decorate()`가 캡처한 `attach` 객체를 계속 사용해 guarded paste 및 `browserCommit()`을 수행합니다. → 전달 직전 및 `commit()` 전에 `st.attach === attach`를 재검증해 제거된 첨부는 전송·commit하지 않아야 합니다.

## 5. Minor 이슈

- [renderer-browser.js:367] `attachErrors()`의 IPC 예외는 버튼 상태만 복구하고 사용자 알림 없이 무시됩니다. 첨부가 생성되지 않은 이유를 알 수 없습니다. → catch에서 `notify('콘솔 에러 첨부를 만들지 못했습니다 — 다시 시도하세요')`를 표시해야 합니다.

- [scripts/test-electron-browser.js:125-168, scripts/test-electron-browser.js:377-398] 정상적인 double-click·닫기·history만 검증하며, 전송 중 첨부 갱신, 닫기 중 `browserContext()` 지연 응답, ✕ 클릭 후 guarded delivery 차단은 검증하지 않습니다. → 위 경쟁 상태를 controllable IPC delay로 재현하는 E2E 테스트를 추가해야 합니다.

- [renderer-browser.js:193-218, renderer-browser.js:347-356] 이전 Round 3 Minor — 우회 경로 회귀 테스트: **PARTIAL**. hostile text, 일반 셸 거부, navigation/close 후 일반 history는 확인하지만 async lifecycle 경쟁 상태는 확인하지 않습니다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] 오류 첨부 조회가 guarded-send의 one-time context token을 무효화하지 않도록 IPC 계약을 분리한다.
- [ ] 브라우저 close/navigation 및 ✕ 제거 후 늦게 완료되는 `attachErrors()`/`decorate()` 결과를 폐기한다.
- [ ] 첨부 생성 실패 시 사용자에게 재시도 가능한 notice를 표시한다.
- [ ] 전송 중 첨부 새로고침, 닫기 중 첨부 생성, ✕ 클릭 직후 전송의 E2E 테스트를 추가한다.
- [ ] 수정 후 `test:browser`에서 task-015 pin/context-token/hostile-page 회귀 테스트를 함께 실행한다.