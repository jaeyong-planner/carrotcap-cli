# Review Report — feature/v0.2.0 `e96db39`

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `logs/review/task-014-r3_ready-gate.md`
- 변경 라인 수: `main.js` 22 additions / 3 deletions, 이전 리뷰 보고서 40 additions
- 리뷰 시점: 2026-09-26T15:00:06Z

## 2. 전체 판단

- ❌ 반려
- 한 줄 요약: fallback `child_process`의 spawn error crash는 해결됐지만, fallback kill 실패를 성공으로 처리해 live child와 ready gate 상태가 분리될 수 있습니다.

## 3. Critical 이슈

- [main.js:1004-1037] 이전 Critical — **RESOLVED**. `child.on('error')`를 즉시 등록하고 `onExit` 인터페이스로 종료를 전달하므로 fallback spawn 실패의 unhandled `error`에 의한 main-process crash 경로가 제거되었습니다.

## 4. Major 이슈

- [main.js:1026-1028] [main.js:1297-1303] 이전 Major — **PARTIAL**. native PTY의 `kill()` throw는 session과 ready gate를 유지하도록 수정됐지만, fallback wrapper는 `child.kill()`의 throw와 `false` 반환을 모두 무시합니다. 따라서 실제 kill 실패에도 wrapper는 정상 반환하고, IPC handler가 `disposeReadyGate()` 및 `sessions.delete(id)`를 실행합니다. 살아 있는 fallback child는 이후 관리·종료할 session entry가 없고, 기존 pending 입력도 폐기됩니다. `proc.kill()`이 실제 signal 전달 성공 여부를 boolean으로 반환하거나 실패를 rethrow하게 하고, `pty:kill`은 성공 확인 후에만 gate dispose 및 Map 삭제를 수행해야 합니다.
- [main.js:1048-1060] [main.js:1277-1281] 이전 Major — **RESOLVED**. array queue가 단일 문자열 buffer로 대체됐고, 1MB byte cap 및 최대 32개 session 제한으로 tiny-write 기반의 비례 이상 heap 증가 경로가 제거되었습니다.
- [main.js:787-795] [main.js:891-908] 이전 Major — **RESOLVED**. template copy 예외가 `null`로 정규화되고 AIOps pane 생성자는 이를 warning으로 변환합니다. 부분 생성 상태는 다음 idempotent setup에서 복구 가능하며 성공으로 오인되지 않습니다.
- [main.js:174-180] 이전 Major — **RESOLVED**. v2의 실제 boolean `aor.autoStart`는 보존하고, v1 및 v2의 누락·비boolean 값만 `true`로 migration합니다.

## 5. Minor 이슈

- [main.js:977-984] [main.js:1072-1078] [main.js:1167-1173] [main.js:1297-1303] 이전 Minor — **PARTIAL**. exit와 window close, native PTY의 성공 kill에서는 timer 및 pending buffer가 정리됩니다. 단, fallback kill 실패가 성공 처리되는 경우에는 live child가 남은 채 gate와 session만 정리되므로 해당 경로의 정리 보장은 성립하지 않습니다.
- [settings.json:12] 이전 Minor — **RESOLVED**. 기본 `aor.autoStart: true` 표기와 v3 migration 동작이 일치합니다.

## 6. Optional 제안

- [scripts/test-electron-smoke.js:217-224] fallback mode를 강제한 stub에서 `child.kill()`이 `false`를 반환하거나 throw하는 경우 session 유지, timer 유지, 이후 exit 정리가 보장되는 회귀 테스트가 없습니다 → 해당 두 경우와 silent shell의 10초 max timer, FIFO flush를 결정적으로 검증해야 합니다.
- [scripts/test-validate-settings.js:608-624] v1/v2 boolean 경계는 검증하지만 v2의 `autoStart: null`, 문자열, 숫자 값이 `true`로 정규화되는 경우는 없습니다 → migration 계약을 고정하는 경계 테스트를 추가해야 합니다.
- [scripts/test-validate-settings.js:418-474] template 누락 사전 검증은 있으나, 복사 도중 `EACCES`가 발생한 뒤 `ensureAiopsProjectStructure()`가 `null`을 반환하고 caller가 warning을 전달하는 경로는 검증하지 않습니다 → `copyTemplateIfMissing` 실패 stub을 사용한 caller-level 테스트가 필요합니다.

## 7. 최종 권고

- fallback `proc.kill()`이 `child.kill()`의 실패를 호출자에게 전달하도록 수정한다.
- [main.js:1302]에서 실제 kill 성공을 확인한 뒤에만 `disposeReadyGate()`와 `sessions.delete(id)`를 실행한다.
- fallback kill 실패·silent shell·pre-ready resize/kill·1MB cap/FIFO flush에 대한 결정적 테스트를 추가한다.
- `node --check main.js`와 `git diff --check c5aa9b9..HEAD`는 통과했습니다.