# Review Report — feature/v0.2.0 `c3dbbeb`

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `settings.json`, `scripts/test-validate-settings.js`, `scripts/test-electron-smoke.js`, `scripts/test-electron-resume.js`
- 변경 라인 수: 소스·테스트 79 additions / 19 deletions (전체 커밋: 117 additions / 19 deletions)
- 리뷰 시점: 2026-09-26T14:52:53Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 한 줄 요약: migration과 template-copy 예외 처리는 이전 지적을 해결했으나, ready gate의 큐 항목 수가 제한되지 않아 pre-ready 입력 flood 시 main process 메모리 DoS 가능성이 남아 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [main.js:1013] [main.js:1244-1248] `queuedBytes`는 UTF-8 바이트만 1MB로 제한하고 `queue` 항목 수는 제한하지 않는다. 1-byte 입력을 반복 전송하면 최대 약 100만 개의 JavaScript string/array entry가 쌓여 페이로드 바이트 제한보다 훨씬 큰 heap을 점유할 수 있으며, shell이 출력하지 않는 최대 10초 동안 renderer 입력으로 main process DoS가 가능하다 → `MAX_QUEUE_ITEMS`를 별도로 제한하거나 문자열 버퍼 하나로 누적하고, 전체 PTY session 수 또는 전체 pre-ready queue의 전역 상한도 둬야 한다.
- [main.js:787-795] [renderer.js:427-431] [main.js:891] template copy는 순차 실행되어 중간 실패 시 이미 생성된 파일이 남지만, auto-setup 호출자는 실패 후에도 AIOps PTY spawn을 계속 진행한다. 결과적으로 일부 contract만 배치된 상태에서 AIOps pane이 열리고, [main.js:933-935]의 “프로젝트 폴더를 선택하면” tooltip은 이미 선택된 쓰기 불가 프로젝트의 실제 원인을 숨긴다 → 실패 결과에 partial deployment 여부와 원인을 포함하고, auto-setup 실패 시 AIOps mode를 중단하거나 pane header/flow status에 정확한 쓰기 실패 사유를 유지해야 한다.
- [main.js:174-180] 이전 Major — **RESOLVED**. v2의 명시적 boolean `aor.autoStart`는 유지하고 v1만 `true`로 migration하며, [scripts/test-validate-settings.js:607-619]에 회귀 테스트가 추가되었다.
- [main.js:787-795] 이전 Major — **RESOLVED**. template copy 예외가 `ensureAiopsProjectStructure()` 밖으로 전파되지 않고 `null`로 변환되며, [main.js:1235-1237]과 [renderer.js:1012-1019]가 제어된 실패를 사용자에게 반환·표시한다.

## 5. Minor 이슈

- [main.js:1135-1140] [main.js:1264-1269] `pty:kill`과 window close는 session을 제거하지만 `quietTimer`/`maxTimer`를 명시적으로 해제하지 않는다. `onExit`가 정상 발생하면 해제되지만, kill 실패 또는 exit event 미발생 시 timer closure가 최대 10초 동안 `proc`와 큐를 유지하고 이후 종료된 프로세스에 write를 시도한다 → 공통 `disposeReadyGate(session)`에서 두 timer와 queue를 정리하고 kill/window-close/onExit에서 모두 호출해야 한다.
- [settings.json:12] 이전 Minor — **RESOLVED**. fallback 표기와 AOR badge 동작이 현재 `plain`/`aiops` header 및 tooltip 구현과 일치하도록 수정되었다.

## 6. Optional 제안

- [scripts/test-electron-smoke.js:217-224] native PTY에서 100ms 후 입력이 보존되는 경로는 검증하지만 fallback `child_process` mode, shell이 전혀 출력하지 않는 10초 fallback, pre-ready resize/kill, queue 상한과 FIFO flush는 검증하지 않는다. ready gate는 timer·큐 상태를 가지므로 stubbed PTY 단위 테스트로 해당 경계를 결정적으로 검증하는 것이 적절하다.

## 7. 최종 권고

- pre-ready queue에 항목 수 및 전역 메모리 상한을 추가한다.
- kill/window close/onExit 공통 정리 경로에서 ready-gate timer와 queue를 즉시 해제한다.
- template deployment 중간 실패 시 partial state와 실제 쓰기 실패를 AIOps pane 사용자에게 정확히 표시한다.
- 다음 테스트를 추가한다:
  - 1-byte write 반복 시 queue 항목·메모리 상한 검증
  - 출력 없는 shell의 10초 fallback 후 FIFO flush 검증
  - ready 전 resize/kill 및 kill 후 timer 해제 검증
  - template의 두 번째 이상 copy 실패 시 `aiops:setup` 및 auto-spawn UI 상태 검증