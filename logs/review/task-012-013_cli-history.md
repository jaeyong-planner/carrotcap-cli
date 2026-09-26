# Review Report — task-012-013 (f169fdb, 1035c34)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `renderer.js`, `preload.js`, `scripts/run-media.ps1`, `scripts/run-reviewer.ps1`, 관련 테스트·설정
- 변경 라인 수: +1,273 / -324
- 리뷰 시점: 2026-09-26T04:16:11Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- PowerShell quoting·Electron 격리·터미널 내용 미저장은 적절하나, 로그 Path Traversal, reviewer 실패 처리, 프로젝트 전환 중 세션 이력 오염을 수정해야 합니다.
- 이전 리뷰 Major 상태:
  - [renderer.js:1071] 반복 단축키 terminal 전파 — **RESOLVED**
  - [renderer.js:1088] IME `Process` 포커스 복구 — **RESOLVED**
  - [renderer.js:789] 종료 PTY로 composer 전송 — **RESOLVED**
  - [renderer.js:685] stale selection이 `Ctrl+C`를 막음 — **RESOLVED**
- [main.js:324] 이력에는 layout·CLI 이름·task 이름·시점만 저장하며 terminal output 및 keystroke를 저장하지 않습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [scripts/run-media.ps1:62] [scripts/run-reviewer.ps1:56] `TaskId`와 `Slug`를 검증 없이 출력 경로에 결합합니다. `..\`가 포함된 인자로 `logs/media`·`logs/review` 밖의 파일을 덮어쓸 수 있습니다. → `TaskId`와 `Slug`를 허용 문자 정규식으로 제한하고, 최종 경로가 각 로그 디렉터리 내부인지 canonical path 기준으로 검증해야 합니다.

- [scripts/run-reviewer.ps1:105] Codex 실행 후 `$LASTEXITCODE`를 확인하지 않습니다. 기존 `$outputPath`가 남아 있는 상태에서 Codex가 실패하면 이전 보고서를 새 성공 결과처럼 UTF-8 BOM으로 다시 저장하고 exit code 0으로 끝날 수 있습니다. → pipeline 직후 non-zero exit code를 실패 처리하고, 실행 전 기존 output을 제거하거나 임시 파일에 쓴 뒤 성공 시에만 원자적으로 교체해야 합니다.

- [renderer.js:506] [renderer.js:816] [renderer.js:565] 비동기 `checkResume()`와 debounce 저장이 프로젝트 root를 캡처하지 않습니다. A 프로젝트의 이력 조회·복원 중 B 프로젝트를 열면 A의 제안이 B 화면에 표시되고, 복원 완료 시 B 이력을 dismiss하거나 A layout을 B 이력에 저장할 수 있습니다. → 폴더 변경 전 기존 root 이력을 저장하고, 조회·복원·dismiss·save마다 시작 시점의 canonical root/token을 캡처하여 현재 root와 다르면 결과를 무시해야 합니다.

- [main.js:1223] `readHistory()`는 `sessions` 배열 존재 여부만 확인하고 저장 파일의 layout·CLI·문자열 길이를 다시 sanitize하지 않은 채 renderer에 반환합니다. 손상되었거나 구버전 형식의 history 파일은 `prev.layout.tabs.reduce()`에서 renderer 예외를 내거나 상한 없는 데이터를 전달할 수 있습니다. → 읽기 시 `sanitizeHistoryLayout()` 및 session 필드별 타입·길이 검증을 적용하고, 유효하지 않은 record는 삭제 또는 무시해야 합니다.

## 5. Minor 이슈

- [main.js:1081] [main.js:1321] `settings:set` 후 `cliStatusCache`를 무효화하지 않습니다. CLI 설정 변경 직후 최대 30초 동안 이전 명령의 설치 상태가 표시·적용됩니다. → 설정 저장 성공 시 cache를 비우고 renderer의 상태 갱신 경로를 호출해야 합니다.

- [main.js:158] `settingsVersion` 비교가 JavaScript coercion에 의존합니다. 예를 들어 문자열 `"2"`는 migration을 건너뛰므로 오래된 CLI 설정이 그대로 남을 수 있습니다. → version은 양의 정수일 때만 현재 버전과 비교하고, 비정상 값은 migration 대상으로 처리해야 합니다.

- [scripts/run-media.ps1:110] [scripts/run-reviewer.ps1:122] 성공 후 stdout 로그 삭제 실패를 `SilentlyContinue`로 숨깁니다. 개인정보·용량 정리 목적과 달리 로그가 남아도 사용자가 알 수 없습니다. → 삭제 실패 시 경고를 출력하고 `-KeepLog`와 구분해야 합니다.

## 6. Optional 제안

- [renderer.js:548] 현재 복원은 모든 추가 pane을 `right` 방향으로만 split합니다. 현 설계 문서의 저장 범위에는 맞지만, 사용자가 상하 분할을 기대한다면 split tree·비율까지 저장하는 별도 확장이 필요합니다.

## 7. 최종 권고

- 로그 파일명 입력의 Path Traversal 방어를 추가한다.
- `run-reviewer.ps1`에 Codex exit-code 및 stale output 방어를 추가한다.
- 프로젝트 전환·복원 도중의 root binding을 보장한다.
- history 읽기에도 schema validation과 용량 상한을 적용한다.
- 추가 테스트:
  - `TaskId`·`Slug`에 `..\` 및 절대 경로를 넣은 로그 경로 탈출 테스트
  - 기존 output 파일이 있는 상태의 Codex non-zero exit 테스트
  - A→B 빠른 폴더 전환, A 복원 중 B 전환, 늦게 도착한 `history:get` 응답 테스트
  - 비정상 schema·대형 layout의 history 파일을 읽는 테스트
  - CLI 설정 변경 직후 `cli:status` cache 무효화 테스트