# Review Report — task-016-r4 AOR engine / Claude compression hook

## 1. 리뷰 대상

- 파일/모듈 목록: `AOR/carrotcap/compress-hook.js`, AOR Windows engine scripts, `AOR/support/_internal/build-dashboard.js`, `main.js`, `renderer.js`, `settings.json`, 관련 테스트
- 변경 라인 수: 3,034 additions / 14 deletions
- 리뷰 시점: 2026-09-26T17:49:19Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- 훅의 raw 로그 신뢰 검증과 인용/경로 escaping은 보완됐으나, watch 계열 장기 실행 명령도 압축 대상이 되는 회귀가 남아 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [AOR/carrotcap/compress-hook.js:38-52] `NOISY` 정규식은 `npm test -- --watch`, `npm run test:unit -- --watch`, `jest --watch`, `pytest --looponfail` 같은 장기 실행/감시 명령을 허용합니다. `run_in_background`만 제외하므로 foreground watcher의 종료 출력도 요약되어, 모델이 진행 이력과 감시 결과를 원문으로 받아야 하는 흐름이 훼손될 수 있습니다. → `--watch`, `--watchAll`, `-w`, `--looponfail` 등 장기 실행 옵션을 별도 denylist로 검사해 fail-open 처리하고, 회귀 테스트를 추가해야 합니다.

- [AOR/carrotcap/compress-hook.js:82-92] **r3 Major — RESOLVED.** `raw:` 대상은 engine runtime의 직접 하위 일반 파일이어야 하며, BOM/CRLF 정규화 후 원본 출력 hash와 일치할 때만 교체됩니다.

- [AOR/carrotcap/compress-hook.js:83-92] **r2 Major — RESOLVED.** `raw:` 행 누락, 존재하지 않는 파일, 디렉터리, runtime 밖 파일, 하위 디렉터리 파일은 모두 원본 출력을 유지합니다.

- [main.js:715-718] **r1 Major — RESOLVED.** Windows 외 플랫폼에서는 PowerShell 기반 AOR engine을 실행하지 않고 plain shell로 fallback합니다.

- [AOR/engine/windows/_internal/import-claude-usage.ps1:85-104] [AOR/support/_internal/import-claude-usage.js:75-99] [AOR/engine/windows/_internal/write-session-report.ps1:23-32] **r1 Major — RESOLVED.** `cache_read_input_tokens`가 `tokensSaved`로 기록·집계되지 않습니다.

- [main.js:653-705] **r1 Major — RESOLVED.** hook settings는 `userData/aor-hook` 내부의 일반 파일인지 재검증하며, 예측 불가능한 `wx` temporary file과 rename을 사용합니다.

- [main.js:711-713] [renderer.js:1018-1020] [AOR/engine/windows/_internal/claude-integration.ps1:492-501] **r1 Major — RESOLVED.** 사용자 `--settings` 및 관리 subcommand에는 hook을 주입하지 않으며, PowerShell/posix quoting도 인자 경계를 보존합니다.

## 5. Minor 이슈

- [AOR/support/_internal/build-dashboard.js:54-55,127-130] `totalSaved`는 importer 행을 제외하지만, “Before compression” 및 “After compression”에는 importer의 prompt-cache usage 행도 합산됩니다. 따라서 AOR 압축 전후 수치라는 UI 라벨과 실제 집계 범위가 다릅니다. → 해당 두 합계도 `!isUsageRow(r)`로 제한하거나 “전체 Claude usage 포함”으로 명시해야 합니다.

- [AOR/carrotcap/compress-hook.js:99-113] **r2 Minor — RESOLVED.** temp 입력 파일은 `wx`와 `0o600`으로 생성되고, 성공·실패 경로 모두에서 삭제를 시도합니다.

- [scripts/test-compress-hook.js:27-49] **r1 Minor — RESOLVED.** fake engine runner를 사용해 hook unit test가 실제 engine binary에 의존하지 않습니다.

- [scripts/test-electron-aor.js:92-103] **r1 Minor — RESOLVED.** hook settings 삭제·비파일 대체·복구와 temporary file 잔존 여부를 E2E에서 확인합니다.

## 6. Optional 제안

- [scripts/test-compress-hook.js:57-60] watch/loop 옵션을 제외하는 명령 선별 테스트와 dashboard importer 행의 전후 토큰 분리 테스트를 추가하면 이번 회귀와 수치 라벨 불일치를 방지할 수 있습니다.

## 7. 최종 권고

- [ ] [AOR/carrotcap/compress-hook.js:56-63] 장기 실행/감시 옵션 denylist를 추가해 해당 명령은 압축하지 않는다.
- [ ] [scripts/test-compress-hook.js:57-60] `npm test -- --watch`, `jest --watch`, `pytest --looponfail`가 fail-open 되는 테스트를 추가한다.
- [ ] [AOR/support/_internal/build-dashboard.js:54-55] 압축 전후 KPI에서 importer usage 행을 제외하거나 UI 라벨을 실제 집계와 일치시킨다.
- [ ] 쓰기 가능한 Windows 환경에서 `npm test`, `npm run test:aor` 및 실제 Claude Code PostToolUse hook 경로를 재실행한다. 정적 JavaScript 구문 검사는 통과했습니다.