# Review Report — feature/v0.2.0 `c5aa9b9`

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `logs/review/task-014-r2_ready-gate.md`
- 변경 라인 수: `main.js` 44 additions / 13 deletions
- 리뷰 시점: 2026-09-26T14:57:02Z

## 2. 전체 판단

- ❌ 반려
- 한 줄 요약: ready gate의 메모리·timer 정리는 개선됐으나, `child_process` fallback의 spawn 실패가 Electron main process crash로 이어지고 kill 실패 시 세션이 영구적으로 ready 상태에 도달하지 않습니다.

## 3. Critical 이슈

- [main.js:1004-1021] `child_process.spawn()`의 반환 `child`에 `error` listener가 없다. fallback 모드에서 실행 파일을 시작하지 못하거나 `EAGAIN` 등이 발생하면 EventEmitter의 unhandled `error`로 main process가 crash한다 → `child.on('error', ...)`를 즉시 등록하고, 세션 정리 및 renderer에 제어된 종료/오류를 전달해야 한다.

## 4. Major 이슈

- [main.js:1284-1287] `pty:kill`이 throw하면 session은 Map에 남지만 `disposeReadyGate()`가 이미 max/quiet timer와 pending 상태를 제거한다. 이후 해당 pane의 `pty:write`는 `ready === false`라 다시 pending에 쌓이지만 이를 flush할 timer가 없어 입력이 영구히 유실되고, session slot도 점유한다 → kill 성공 뒤에만 gate를 dispose하거나, 실패 시 세션을 terminal state로 제거하고 renderer에 종료를 알리도록 상태 전이를 명확히 해야 한다.
- [main.js:1032-1044] 이전 Major — **RESOLVED**. array queue를 단일 `pending` string으로 바꾸고 [main.js:974-987]에서 session 수를 32개로 제한해 tiny-write array-entry 메모리 DoS 경로를 해소했다.
- [main.js:787-795] [main.js:891-908] [renderer.js:465-473] 이전 Major — **RESOLVED**. template copy 예외를 제어된 실패로 반환하고, auto-setup 실패 뒤에도 pane header 및 flow status에 실제 setup 실패 경고를 표시한다.
- [main.js:174-180] 이전 Major — **RESOLVED**. v2의 명시적 boolean `aor.autoStart`는 유지하고 v1은 `true`로 migration하며, [scripts/test-validate-settings.js:607-624] 회귀 테스트가 이를 검증한다.

## 5. Minor 이슈

- [main.js:977-984] [main.js:1056-1062] [main.js:1151-1157] 이전 Minor — **RESOLVED**. exit, window close, kill 경로에서 공통 `disposeReadyGate()`를 호출해 ready-gate timer와 held input을 정리한다. 단, kill throw 시의 상태 불일치는 Major 이슈로 별도 처리해야 한다.
- [settings.json:12] 이전 Minor — **RESOLVED**. fallback 표기와 AOR badge 동작이 현재 구현과 일치한다.

## 6. Optional 제안

- [scripts/test-electron-smoke.js:217-224] native PTY의 early-input happy path만 검증한다 → stubbed PTY/child 테스트로 silent shell의 10초 fallback, FIFO flush, pre-ready resize, kill 성공·실패 시 timer 정리, 1MB cap 및 fallback `child.error` 처리를 추가해야 한다.
- [scripts/test-validate-settings.js:607-624] migration의 v1/v2 boolean 경계는 검증하지만, v2의 비boolean `autoStart`가 `true`로 정규화되는 경우도 명시적으로 테스트해야 한다.

## 7. 최종 권고

- fallback `child`의 `error`를 처리해 main-process crash를 차단한다.
- kill throw 시 세션을 재시도 가능 상태로 복구하거나 즉시 제거해 pending 입력 무한 대기를 막는다.
- PTY ready-gate의 fallback·silent shell·kill 실패 경로에 결정적 단위 테스트를 추가한다.
- `node scripts/test-validate-settings.js`는 현재 read-only sandbox에서 임시 디렉터리 생성 권한(`EPERM`) 때문에 완료 검증하지 못했다. 쓰기 가능한 환경에서 재실행해야 한다.