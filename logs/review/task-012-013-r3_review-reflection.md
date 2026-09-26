# Review Report — task-012-013 (f169fdb, 1035c34, 8bc17f4)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트
- 변경 라인 수: +1,555 / -319
- 리뷰 시점: 2026-09-26T04:27:51Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 이전 리뷰 이슈는 반영됐으나, `run-media.ps1`가 Media Agent 산출물 검증 없이 성공 로그를 삭제해 실패·stale 결과를 성공으로 보일 수 있습니다.
- 이전 Major 상태:
  - [scripts/run-media.ps1:39] [scripts/run-reviewer.ps1:39] `TaskId`·`Slug` Path Traversal 방지 — **RESOLVED**
  - [scripts/run-reviewer.ps1:108] [scripts/run-reviewer.ps1:113] stale review report 및 Codex exit-code 검증 — **RESOLVED**
  - [renderer.js:491] [renderer.js:504] [renderer.js:841] 프로젝트 전환 중 예약 history root binding — **RESOLVED**
  - [main.js:354] [main.js:1264] history disk schema 재검증 — **RESOLVED**
  - [renderer.js:582] [renderer.js:592] 복원 중 프로젝트 변경 시 기존 history dismiss 방지 — **RESOLVED**
  - [renderer.js:507] [renderer.js:515] [main.js:1335] 800ms 내 종료 시 history 저장 및 clean 상태 유지 — **RESOLVED**
  - [renderer.js:913] [renderer.js:923] POSIX shell command assembly — **RESOLVED**
- 이전 Minor 상태:
  - [main.js:1265] history read byte cap — **RESOLVED**
  - [main.js:1117] `cli:status` cache 무효화 — **RESOLVED**
  - [main.js:158] `settingsVersion` 정수 검증 — **RESOLVED**
  - [scripts/run-media.ps1:113] [scripts/run-reviewer.ps1:132] stdout 로그 삭제 실패 경고 — **RESOLVED**
- [main.js:327] [renderer.js:472] history에는 layout·CLI·task metadata만 저장하며 terminal output 및 keystroke는 저장하지 않습니다. 단, `-KeepLog` 또는 CLI 실패 시 raw stdout 로그는 의도적으로 남습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [scripts/run-media.ps1:101] [scripts/run-media.ps1:109] Grok이 exit code 0을 반환해도 필수 산출물인 `logs/media/<TaskId>_<Slug>.md`의 생성·이번 실행 갱신 여부를 검증하지 않습니다. 이어서 기본 동작이 raw stdout 로그를 삭제하므로, Media Agent가 기록 작성을 누락하거나 기존 stale `.md`만 남긴 경우에도 성공처럼 끝나며 복구 근거가 사라집니다. → reviewer runner와 동일하게 예상 `.md` 경로를 실행 전 상태와 비교해 이번 실행에서 생성 또는 갱신됐는지 검증하고, 검증 실패 시 실패 처리하여 stdout 로그를 보존해야 합니다.

## 5. Minor 이슈

- 없음.

## 6. Optional 제안

- [renderer.js:569] [renderer.js:573] resume는 저장된 pane 순서만 복원하고 모든 추가 pane을 `right` split으로 구성합니다. 현재 metadata-only 설계에는 부합합니다. → 상하 분할과 비율까지 복원이 요구될 때에만 split tree와 ratio를 별도 versioned schema로 저장해야 합니다.

## 7. 최종 권고

- `run-media.ps1`에서 성공 전 Media Log의 생성·갱신을 검증하고, 실패 시 raw stdout 로그를 유지한다.
- 테스트 추가 필요 지점:
  - Grok mock이 exit code 0이지만 Media Log를 만들지 않을 때 runner가 실패하고 stdout 로그를 보존하는지 검증
  - 기존 Media Log가 있는 상태에서 새 실행이 기록을 갱신하지 않을 때 stale 결과를 성공으로 처리하지 않는지 검증
  - A 프로젝트 복원 중 B 프로젝트로 전환했을 때 A history가 유지되고 B에 불완전한 복원 layout이 저장되지 않는지 검증
- `npm test`는 read-only sandbox가 임시 디렉터리 생성을 차단해 중도 종료됐으며, 코드 테스트 실패는 확인되지 않았습니다.