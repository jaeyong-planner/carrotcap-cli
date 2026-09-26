# Review Report — task-012-013 (f169fdb, 1035c34, dfa447c)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트
- 변경 라인 수: +1,697 / -319
- 리뷰 시점: 2026-09-26T04:31:29Z

## 2. 전체 판단

- ❌ 반려
- resume 과정이 사용자가 이미 사용 중인 기본 터미널을 자동 종료해 실행 중 작업·미저장 데이터를 잃을 수 있습니다.

- 이전 Major/Minor 반영 상태:
  - [scripts/run-media.ps1:42] [scripts/run-reviewer.ps1:39] `TaskId`·`Slug` Path Traversal 방지 — **RESOLVED**
  - [scripts/run-reviewer.ps1:108] [scripts/run-reviewer.ps1:113] stale review report 및 Codex exit-code 검증 — **RESOLVED**
  - [renderer.js:491] 프로젝트 전환 시 예약 history root binding — **PARTIAL**; root는 묶지만 새 프로젝트에 기존/복원 중 layout이 저장됩니다.
  - [main.js:351] history disk schema 재검증 — **RESOLVED**
  - [renderer.js:582] 복원 중 프로젝트 전환 시 기존 history dismiss 방지 — **PARTIAL**; A history는 유지되지만 B history가 오염됩니다.
  - [renderer.js:507] [main.js:1335] 즉시 종료 시 history 저장·clean 유지 — **RESOLVED**
  - [renderer.js:913] POSIX shell quoting — **RESOLVED**
  - [main.js:1266] history read byte cap — **RESOLVED**
  - [main.js:1117] `cli:status` cache 무효화 — **RESOLVED**
  - [main.js:159] `settingsVersion` 정수 검증 — **RESOLVED**
  - [scripts/run-media.ps1:128] [scripts/run-reviewer.ps1:132] stdout log 삭제 실패 경고 — **RESOLVED**
  - [scripts/run-media.ps1:116] Media Log 생성·갱신 검증 — **RESOLVED**

## 3. Critical 이슈

- [renderer.js:565] [renderer.js:577] 기본 탭을 “`cli`가 없고 root leaf”라는 조건만으로 pristine으로 판단해 자동 닫습니다. 사용자가 resume 제안을 보기 전에 plain shell에서 명령, 편집기, 장시간 작업을 시작해도 `leaf.cli`는 설정되지 않으므로 해당 PTY가 `closeTab()`에서 kill됩니다. 실행 중 `vim` 등의 미저장 데이터와 사용자 작업을 잃을 수 있습니다. → resume 시 기존 탭을 자동 종료하지 말고 유지하거나, 사용자가 명시적으로 “현재 빈 탭 닫기”를 선택한 경우에만 종료해야 합니다.

## 4. Major 이슈

- [renderer.js:578] [renderer.js:841] [renderer.js:850] 복원용 탭·pane 생성이 끝나는 즉시 `restoring = false`가 됩니다. 이후 CLI PTY를 기다리는 중 A 프로젝트에서 B 프로젝트로 전환하면 `loadFolder(B)`가 현재의 A 복원 layout을 `history:save(B)`로 저장합니다. 일반적인 프로젝트 전환에서도 기존 터미널 layout이 새 프로젝트 이력으로 기록됩니다. → tab/pane에 생성 당시 project root를 귀속하거나, 프로젝트 전환 시 새 root의 snapshot 저장을 현재 pane들이 새 root에서 재생성될 때까지 막아야 합니다. 복원 전체 완료·취소 시점까지도 root-bound 상태를 유지해야 합니다.

- [renderer.js:555] [renderer.js:598] resume 버튼에 진행 중 guard가 없습니다. 첫 `resumeSession()`이 `whenPtyReady()`에서 await 중일 때 다시 클릭하면 동일 layout이 한 번 더 생성되고, 같은 CLI continue 명령이 중복 실행됩니다. → `resumeInProgress` flag와 버튼 disabled 처리를 추가하고, 성공·취소·실패 경로에서만 해제해야 합니다.

- [main.js:1271] [main.js:1304] history를 대상 파일에 직접 `writeFileSync`하므로 프로세스가 truncate와 write 사이에 강제 종료되면 JSON이 손상됩니다. 다음 부팅의 prune이 그 파일을 삭제해, 비정상 종료 뒤 이어하기라는 핵심 기능이 사라집니다. → 동일 directory의 임시 파일에 기록·close 후 atomic rename하고, 실패 시 기존 history를 보존해야 합니다.

- [main.js:1255] [main.js:1273] [main.js:1302] `HISTORY_DIR` 자체가 symlink/junction인지 확인하지 않습니다. 사용자 data directory의 `history`가 외부 경로를 가리키면 `pruneHistory()`의 `fs.rmSync()`가 `<userData>/history` 밖의 파일을 삭제할 수 있습니다. → `HISTORY_DIR` 생성·읽기·삭제 전에 `lstat` 및 `realpath`로 symlink/junction이 아니며 `USER_DATA_ROOT` 내부인지 검증하고, entry도 regular file인지 확인해야 합니다.

## 5. Minor 이슈

- [scripts/run-media.ps1:103] [scripts/run-media.ps1:118] Media Log 갱신 판정이 `LastWriteTimeUtc`만 비교합니다. timestamp granularity가 낮은 filesystem에서는 기존 파일을 이번 실행에서 갱신했어도 동일 timestamp로 남아 false failure가 발생합니다. → 실행 전 기존 log를 안전한 backup 이름으로 이동한 뒤 새 파일의 존재를 확인하거나, timestamp와 함께 content hash/length를 비교해야 합니다.

## 6. Optional 제안

- [renderer.js:573] resume layout은 모든 추가 pane을 `right` split으로만 재구성합니다. 현재 metadata-only 설계에는 부합합니다. → 상하 분할과 비율 보존이 제품 요구가 될 때에만 versioned split-tree schema를 추가해야 합니다.

## 7. 최종 권고

- resume가 기존 기본 탭의 PTY를 자동 종료하지 않도록 수정한다.
- 프로젝트 전환 중에는 이전 프로젝트 layout이 새 프로젝트 history에 저장되지 않도록 root ownership을 유지한다.
- resume 중복 실행을 차단한다.
- history write를 atomic rename 방식으로 변경하고 history directory symlink/junction을 거부한다.
- 추가 테스트 필요 지점:
  - resume 제안 전에 plain shell에서 실행 중인 프로세스가 있을 때 해당 탭이 종료되지 않는지
  - A 프로젝트 resume 중 B로 전환했을 때 B history에 A의 partial layout이 저장되지 않는지
  - resume 버튼 연속 클릭 시 탭·pane·continue 명령이 한 번만 생성되는지
  - history write 도중 강제 종료 후 이전 record가 유지되는지
  - `history` junction이 외부 directory를 가리킬 때 prune이 외부 파일을 삭제하지 않는지
  - 기존 Media Log를 동일 timestamp로 갱신하는 filesystem에서도 정상 성공하는지