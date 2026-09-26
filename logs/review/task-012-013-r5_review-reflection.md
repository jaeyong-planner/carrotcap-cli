# Review Report — task-012-013 (f169fdb, 1035c34, 910470f)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `index.html`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트
- 변경 라인 수: +1,176 / -74 (검토 범위 파일 기준)
- 리뷰 시점: 2026-09-26T04:37:00Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r4의 보안·resume 안정성 이슈는 반영됐으나, 프로젝트 전환 후 이전 프로젝트 pane을 닫으면 stale layout이 다시 복원될 수 있습니다.

- 이전 r4 이슈 반영 상태:
  - Critical — 기본 탭 자동 종료: **RESOLVED** (`renderer.js:579`)
  - Major — 복원 중 프로젝트 전환 시 새 root history 오염: **RESOLVED** (`renderer.js:483`, `renderer.js:857`)
  - Major — resume 중복 클릭: **RESOLVED** (`renderer.js:560`)
  - Major — history atomic write: **RESOLVED** (`main.js:1286`)
  - Major — history symlink/junction traversal: **RESOLVED** (`main.js:1275`, `main.js:1318`)
  - Minor — Media Log timestamp-only 판정: **RESOLVED** (`scripts/run-media.ps1:103`)

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:141] [renderer.js:304] [renderer.js:483] [renderer.js:507] 프로젝트 A에서 B로 전환한 뒤 A 소유 pane/tab을 닫으면 저장 대상은 항상 현재 선택된 B입니다. `buildLayout(B)`는 A pane을 제외하고, A pane을 모두 닫은 경우 빈 layout은 저장하지 않아 A의 기존 history layout이 그대로 남습니다. 이후 A를 다시 열면 이미 닫은 pane이 resume 대상으로 다시 제안됩니다. → pane/tab close 시 삭제 전 해당 pane들의 `projectRoot`를 수집해 각 root의 history를 갱신하고, 해당 root에 pane이 남지 않으면 기존 resumable layout을 명시적으로 제거하는 IPC를 추가해야 합니다.

## 5. Minor 이슈

- [scripts/run-media.ps1:105] [scripts/run-media.ps1:107] 기존 Media Log를 `.prev`로 이동한 뒤 `GetTempFileName()`을 `try` 밖에서 호출합니다. 임시 파일 생성이 실패하면 복구 `catch`가 실행되지 않아 기존 log가 `.prev`에만 남고 표준 경로에서 사라집니다. → 기존 log 이동부터 temp-file 생성·Grok 실행·복구까지 하나의 `try/catch/finally`로 감싸야 합니다.

## 6. Optional 제안

- [main.js:1379] POSIX 환경에서 `/usr/bin/which`가 없는 시스템은 설치된 CLI도 미설치로 표시됩니다. → 향후 Linux/macOS 지원 범위를 넓힐 때 `command -v`를 사용하는 shell-free 대안 또는 platform별 탐색 경로를 추가하는 것을 검토해야 합니다.

## 7. 최종 권고

- 프로젝트 전환 후 이전 프로젝트 pane/tab을 닫는 경우에도 해당 프로젝트 history가 갱신 또는 삭제되도록 수정한다.
- `run-media.ps1`의 기존 log backup과 temp-file 생성 범위를 예외 복구 범위에 포함한다.
- 테스트 추가 필요 지점:
  - A 프로젝트 pane을 연 뒤 B로 전환하고 A pane을 모두 닫은 후, A 재진입 시 닫힌 pane의 resume 제안이 없는지
  - A/B pane이 혼재한 상태에서 A tab만 닫아도 B history가 변경되지 않는지
  - `GetTempFileName()` 실패 시 기존 `logs/media/<task>_<slug>.md`가 원래 경로에 복구되는지
