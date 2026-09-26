# Review Report — task-016-r2 AOR engine / Claude compression hook

## 1. 리뷰 대상

- 파일/모듈 목록: `AOR/carrotcap/compress-hook.js`, AOR Windows engine scripts, `AOR/support/_internal/*`, `main.js`, `renderer.js`, `settings.json`, 관련 테스트
- 변경 라인 수: 2,897 additions / 14 deletions
- 리뷰 시점: 2026-09-26T17:41:15Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r1의 Major/Minor는 모두 해결됐지만, engine 응답에 raw log 참조가 없을 때 원본 출력을 잃을 수 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [AOR/carrotcap/compress-hook.js:84-96] `summarize()`는 `[Layer 1]` 문자열만 있으면 유효한 요약으로 판단합니다. engine이 raw log를 기록/반환하지 못한 부분 응답을 성공으로 반환하면, hook은 원본을 `updatedToolOutput`으로 교체하면서 존재하지 않는 `"raw:" line above`를 안내합니다. 이 경우 최대 32MB의 실행 정보가 모델에서 사라져 “fail-open” 및 정보 보존 요구를 위반합니다. → `[Layer 1]` 외에 유효한 `raw:` 경로를 필수로 검증하고, raw log가 없거나 일반 파일로 확인되지 않으면 반드시 `null`을 반환해 원본 출력을 유지해야 합니다.

- [main.js:715-718] **r1 Major — RESOLVED.** Windows 이외 플랫폼에서 AOR PowerShell engine을 선택하지 않고 plain shell fallback으로 처리합니다.

- [AOR/support/_internal/import-claude-usage.js:75-80] [AOR/engine/windows/_internal/import-claude-usage.ps1:82-87] **r1 Major — RESOLVED.** `cache_read_input_tokens`를 AOR 절감으로 계산하지 않으며, dashboard/report도 importer 행을 절감 집계에서 제외합니다.

- [main.js:660-705] **r1 Major — RESOLVED.** hook settings 파일을 매 호출 시 일반 파일·디렉터리·root 내부 경로로 재검증하고, 예측 불가능한 `wx` temp file을 사용합니다.

- [main.js:711-713] [renderer.js:1018-1020] [AOR/engine/windows/_internal/claude-integration.ps1:495-501] **r1 Major — RESOLVED.** `--settings=<path>`와 argument 어디에 위치한 관리 subcommand도 hook 주입 대상에서 제외합니다.

## 5. Minor 이슈

- [AOR/carrotcap/compress-hook.js:78] 임시 입력 파일이 기본 파일 권한(`0o666 & umask`)으로 생성됩니다. macOS/Linux에서 완화된 umask 또는 공유 temp directory 환경이면 명령 출력의 비밀값이 실행 중 다른 로컬 사용자에게 노출될 수 있습니다. → `writeFileSync`에 `mode: 0o600`을 명시하고 권한 회귀 테스트를 추가해야 합니다.

- [scripts/test-compress-hook.js:27-42] **r1 Minor — RESOLVED.** fake engine runner를 사용해 unit test가 실제 engine binary에 의존하지 않습니다.

- [scripts/test-electron-aor.js:86-102] **r1 Minor — RESOLVED.** `--settings=<path>`, option 뒤의 subcommand, settings 파일 삭제·비파일 교체·복구를 E2E에서 검증합니다.

## 6. Optional 제안

- 없음

## 7. 최종 권고

- [ ] [AOR/carrotcap/compress-hook.js:84-96] raw log 참조가 없는 engine 응답은 원본 출력 유지로 fail-open 처리한다.
- [ ] [AOR/carrotcap/compress-hook.js:78] temp input file 권한을 owner-only로 제한한다.
- [ ] `[Layer 1]`만 있고 `raw:`가 없는 fake engine 응답, raw log 생성 실패, 32MB 입력과 30초 hook timeout 경계 테스트를 추가한다.
- [ ] 수정 후 `npm test` 및 `npm run test:aor`를 실행한다.