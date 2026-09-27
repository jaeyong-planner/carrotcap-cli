# Review Report — task-012-013 (f169fdb, 1035c34, 6fdd7ad)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트
- 변경 라인 수: +1,446 / -319
- 리뷰 시점: 2026-09-26T04:22:37Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 이전 보안·검증 보강은 대체로 반영됐으나, 복원 중 프로젝트 전환 시 이력 삭제와 debounce 직후 종료 시 이력 미저장 문제를 수정해야 합니다.
- 이전 리뷰 Major 상태:
  - [scripts/run-media.ps1:42] [scripts/run-reviewer.ps1:39] `TaskId`·`Slug` Path Traversal — **RESOLVED**
  - [scripts/run-reviewer.ps1:109] [scripts/run-reviewer.ps1:112] stale report·Codex exit-code — **RESOLVED**
  - [renderer.js:497] [renderer.js:831] 프로젝트 전환 중 예약 저장 root binding — **PARTIAL**
  - [main.js:354] [main.js:1264] history disk schema 재검증 — **RESOLVED**
- 이전 리뷰 Minor 상태:
  - [main.js:1117] CLI status cache 무효화 — **RESOLVED**
  - [main.js:158] `settingsVersion` 정수 검증 — **RESOLVED**
  - [scripts/run-media.ps1:113] [scripts/run-reviewer.ps1:132] stdout 로그 삭제 실패 경고 — **RESOLVED**
- [main.js:327] [renderer.js:479] 세션 history에는 layout·CLI·task metadata만 저장하며 terminal output 및 keystroke는 저장하지 않습니다. 단, `-KeepLog` 또는 실패한 media/reviewer 실행의 raw stdout 로그는 의도적으로 남습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:572] [renderer.js:581] 복원 중 프로젝트가 바뀌면 launch loop만 중단하지만, 직후 이전 프로젝트 `root`에 대해 `history:dismiss`를 실행합니다. 따라서 A 프로젝트 복원이 B 전환으로 중단되어도 A의 재개 가능한 layout이 삭제되고, 사용자에게는 복원 성공 상태가 표시됩니다. → root 변경을 감지하면 즉시 return하고 dismiss·성공 상태·저장을 실행하지 않도록 완료 여부를 별도 추적해야 합니다.

- [renderer.js:499] [renderer.js:504] [main.js:1304] layout/CLI 실행 이력은 800ms debounce 뒤에만 main process로 전달됩니다. 사용자가 탭 생성 또는 CLI 실행 직후 800ms 안에 종료하면 `historySessionIds`가 비어 `before-quit`의 finalize 대상도 없어 세션 자체가 저장되지 않습니다. → 세션 생성·CLI 실행·구조 변경 시에는 즉시 최소 snapshot을 저장하고, debounce는 후속 변경 coalescing 용도로만 사용해야 합니다.

- [main.js:598] [renderer.js:900] [renderer.js:983] macOS 빌드에서는 기본 shell이 `/bin/bash`인데 renderer는 모든 플랫폼에서 PowerShell 전용 `&`, `Set-Location -LiteralPath` 문법을 PTY에 전송합니다. macOS의 QUICK CLI 및 AI DEV FLOW 실행이 실패합니다. → `api.platform()` 기반으로 POSIX quoting 및 `cd -- <path> && <command>`를 사용하거나, shell command 조합을 main process의 플랫폼별 spawn 로직으로 이동해야 합니다.

## 5. Minor 이슈

- [main.js:529] [main.js:1264] history 파일의 schema는 parse 후 sanitize되지만, 파일 크기 제한 없이 `readFileSync`·`JSON.parse`를 수행합니다. 손상되었거나 비정상적으로 큰 `%APPDATA%/.../history/*.json` 파일 하나가 main process를 장시간 block하거나 메모리를 과점유할 수 있습니다. → 읽기 전에 `statSync`로 작은 byte cap을 적용하고 초과·parse 실패 파일은 무시 또는 prune 대상으로 처리해야 합니다.

## 6. Optional 제안

- [renderer.js:563] 복원은 저장된 모든 추가 pane을 `right` split으로 재구성하므로 기존 상하 분할과 비율은 복원되지 않습니다. 현재 metadata-only 설계에는 부합합니다. → 향후 정확한 workspace 복원이 요구될 때에만 split tree·ratio 저장 포맷을 별도 버전으로 확장해야 합니다.

## 7. 최종 권고

- 복원 도중 root 변경 시 이전 history를 dismiss하지 않도록 수정한다.
- 800ms 이전 종료에도 최소 history snapshot이 남도록 저장 시점을 보강한다.
- macOS/POSIX shell에서 QUICK CLI와 FLOW command가 동작하도록 플랫폼별 command assembly를 구현한다.
- history file read byte cap을 추가한다.
- 추가 테스트:
  - A 프로젝트 복원 중 B 프로젝트로 전환했을 때 A의 layout이 유지되고 성공 상태가 표시되지 않는지 검증
  - 탭 생성·CLI 실행 직후 800ms 내 정상 종료했을 때 history 및 clean 상태가 남는지 검증
  - POSIX shell에서 command·quote·프로젝트 경로 공백을 포함한 FLOW 실행 검증
  - byte cap 초과 및 JSON parse 실패 history 파일의 startup/prune 동작 검증