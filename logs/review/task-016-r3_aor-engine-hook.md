# Review Report — task-016-r3 AOR engine / Claude compression hook

## 1. 리뷰 대상

- 파일/모듈 목록: `AOR/carrotcap/compress-hook.js`, AOR Windows engine scripts, `AOR/support/_internal/build-dashboard.js`, `main.js`, `renderer.js`, `settings.json`, 관련 테스트
- 변경 라인 수: 2,962 additions / 14 deletions
- 리뷰 시점: 2026-09-26T17:45:00Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r2 지적은 해결됐지만, 존재만 하는 임의 `raw:` 파일을 원본 출력 보관본으로 신뢰해 원본 정보가 대체될 여지가 남아 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [AOR/carrotcap/compress-hook.js:78-98] `rawLogOf()`는 요약의 첫 `raw:` 경로가 존재하는 일반 파일인지 만 확인하고, 해당 파일이 이번 `text`의 실제 원본 로그인지 또는 AOR runtime의 raw 로그인지 검증하지 않습니다. engine 요약이 입력 출력에 포함된 임의의 `raw:` 행을 보존하거나, stale한 기존 파일을 가리키면 hook은 원본 Bash 출력을 교체합니다. 이는 “정보 보존 실패 시 fail-open” 요구를 충족하지 못합니다. → raw 경로를 신뢰된 runtime `raw` 디렉터리 내부의 일반 파일로 제한하고, 줄바꿈 정규화 후 원본 내용 또는 hash가 `text`와 일치할 때만 교체해야 합니다. [scripts/test-compress-hook.js:80-82]에는 “존재하지만 내용이 다른 일반 파일” 및 runtime 밖 일반 파일을 거부하는 회귀 테스트도 추가해야 합니다.

- [AOR/carrotcap/compress-hook.js:78-98] **r2 Major — RESOLVED.** `raw:` 행 누락, 존재하지 않는 경로, 디렉터리 경로는 `null`을 반환하여 원본 출력을 유지합니다.

- [main.js:715-718] **r1 Major — RESOLVED.** Windows 외 플랫폼은 AOR PowerShell engine 대신 plain shell fallback을 사용합니다.

- [AOR/support/_internal/import-claude-usage.js:75-80] [AOR/engine/windows/_internal/import-claude-usage.ps1:85-90] [AOR/support/_internal/build-dashboard.js:47-53] [AOR/engine/windows/_internal/write-session-report.ps1:23-26] **r1 Major — RESOLVED.** `cache_read_input_tokens`는 AOR 절감으로 집계되지 않습니다.

- [main.js:653-705] **r1 Major — RESOLVED.** hook settings 파일은 userData 내부의 일반 파일·디렉터리인지 재검증하며, 예측 불가능한 `wx` temp 파일과 rename을 사용합니다.

- [main.js:711-713] [renderer.js:1018-1020] [AOR/engine/windows/_internal/claude-integration.ps1:492-501] **r1 Major — RESOLVED.** 사용자 `--settings` 및 관리 subcommand에는 hook을 주입하지 않습니다.

## 5. Minor 이슈

- [AOR/carrotcap/compress-hook.js:89] **r2 Minor — RESOLVED.** temp 입력 파일을 `0o600`으로 생성합니다.

- [scripts/test-compress-hook.js:18-42] **r1 Minor — RESOLVED.** fake engine runner로 unit test가 실제 engine binary에 의존하지 않습니다.

- [scripts/test-electron-aor.js:92-103] **r1 Minor — RESOLVED.** settings 파일 삭제·비파일 교체·복구를 E2E에서 검증합니다.

## 6. Optional 제안

- 없음

## 7. 최종 권고

- [ ] [AOR/carrotcap/compress-hook.js:78-98] raw 로그의 경로 경계와 원본 내용 일치 여부를 검증한 뒤에만 `updatedToolOutput`을 반환한다.
- [ ] [scripts/test-compress-hook.js:80-82] runtime 밖의 기존 일반 파일 및 내용 불일치 raw 파일이 fail-open 되는 테스트를 추가한다.
- [ ] 정적 구문 검사는 통과했다. `npm test`와 `npm run test:aor`는 현재 read-only sandbox가 Temp 디렉터리 생성을 차단하여 완료하지 못했으므로, 쓰기 가능한 Windows 환경에서 재실행한다.