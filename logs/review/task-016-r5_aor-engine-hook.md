# Review Report — task-016-r5 AOR engine / Claude compression hook

## 1. 리뷰 대상

- 파일/모듈 목록: `AOR/carrotcap/compress-hook.js`, AOR Windows engine scripts, `AOR/support/_internal/build-dashboard.js`, `main.js`, `renderer.js`, `settings.json`, 관련 테스트
- 변경 라인 수: 3,095 additions / 14 deletions
- 리뷰 시점: 2026-09-26T17:52:54Z

## 2. 전체 판단

- ✅ 승인
- r4의 watch 명령 회귀와 dashboard 집계 불일치가 수정됐으며, hook fail-open·인용·경로 검증·runtime prune 안전성에서 신규 Critical/Major/Minor 이슈를 발견하지 못했습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [AOR/carrotcap/compress-hook.js:37-62] **r4 Major — RESOLVED.** `LONG_RUNNING` denylist가 `--watch`, `--watchAll`, `-w`, `--looponfail`, `-f`, `--follow`, `dev`/`serve`/`start` 등을 fail-open 처리하며, [scripts/test-compress-hook.js:57-62]에 회귀 테스트가 추가됐습니다.
- [AOR/carrotcap/compress-hook.js:78-97] **r3 Major — RESOLVED.** `raw:` 로그는 engine raw directory의 직접 하위 일반 파일이고 원문 hash가 일치할 때만 교체됩니다.
- [AOR/carrotcap/compress-hook.js:78-97] **r2 Major — RESOLVED.** 누락·디렉터리·runtime 외부·하위 디렉터리 raw 경로는 원문 유지로 fail-open 됩니다.
- [main.js:715-742] **r1 Major — RESOLVED.** Windows 외 플랫폼은 PowerShell AOR engine을 실행하지 않고 plain shell로 fallback합니다.
- [AOR/engine/windows/_internal/import-claude-usage.ps1:81-110] [AOR/support/_internal/import-claude-usage.js:71-100] [AOR/engine/windows/_internal/write-session-report.ps1:23-32] **r1 Major — RESOLVED.** `cache_read_input_tokens`는 usage로만 기록되고 AOR 절감으로 합산되지 않습니다.
- [main.js:653-705] **r1 Major — RESOLVED.** hook settings는 `userData/aor-hook` 내부의 일반 파일인지 매 실행 시 재검증하며, 예측 불가능한 `wx` temporary file과 rename을 사용합니다.
- [main.js:711-713] [renderer.js:1018-1024] [AOR/engine/windows/_internal/claude-integration.ps1:492-507] **r1 Major — RESOLVED.** 사용자 `--settings`, 관리 subcommand를 제외하고 PowerShell/POSIX 인용으로 인자 경계를 보존합니다.

## 5. Minor 이슈

- [AOR/support/_internal/build-dashboard.js:50-58,130-133] **r4 Minor — RESOLVED.** importer usage 행은 compression KPI의 `Before`/`After` 및 `Saved` 합계에서 제외됩니다.
- [AOR/carrotcap/compress-hook.js:99-114] **r2 Minor — RESOLVED.** hook temporary input은 `wx`·`0600`으로 생성되고 성공·예외 경로에서 제거됩니다.
- [scripts/test-compress-hook.js:27-49] **r1 Minor — RESOLVED.** fake engine runner로 hook unit test가 실제 engine binary에 의존하지 않습니다.
- [scripts/test-electron-aor.js:92-103] **r1 Minor — RESOLVED.** hook settings 삭제·비일반 파일 대체·복구 및 temporary file 잔존 여부를 E2E로 확인합니다.

## 6. Optional 제안

- [AOR/support/_internal/build-dashboard.js:50-58] dashboard 집계용 fixture test를 추가해, 구버전 importer 행의 `tokensSaved`/`cacheReadTokens`가 `Saved by output compression`과 `Before`/`After compression`에 포함되지 않음을 직접 검증하는 것이 좋습니다.

## 7. 최종 권고

- [x] watch/long-running 명령은 압축하지 않는다.
- [x] raw 로그 검증, hook settings 경로 검증, 인용 및 runtime prune의 링크 미추적을 유지한다.
- [ ] `build-dashboard.js`에 importer 행과 engine 행을 혼합한 집계 회귀 테스트를 추가한다.
- [ ] 쓰기 가능한 Windows 환경에서 `npm test`, `npm run test:aor`, 실제 Claude Code PostToolUse 경로를 재실행한다.