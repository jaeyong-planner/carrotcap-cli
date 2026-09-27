# Review Report — task-016-r1 AOR engine / Claude compression hook

## 1. 리뷰 대상

- 파일/모듈 목록: `AOR/carrotcap/compress-hook.js`, AOR Windows engine scripts, `AOR/support/_internal/*`, `main.js`, `renderer.js`, `settings.json`, 관련 테스트 및 backlog 문서
- 변경 라인 수: `git diff 2231d66^..HEAD` 기준 2,748 additions / 12 deletions
- 리뷰 시점: 2026-09-26T17:31:53Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- Windows 기본 흐름의 quoting·IPC 격리·hook fail-open은 대체로 적절하지만, macOS 회귀와 cache-read 절감 지표 잔존, `--settings=` 처리 및 hook 설정 파일 신뢰 경계 문제를 수정해야 합니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [main.js:710-713] Windows 전용 `shell-init.ps1` 존재 여부만으로 모든 플랫폼에서 AOR engine을 발견한 것으로 판단합니다. 이후 [main.js:1049-1062]가 macOS에서도 `C:\Windows\System32\...\powershell.exe`와 `.ps1`을 실행하려 하므로, 기본 AOR ON인 macOS 패키지에서 새 pane spawn이 실패합니다. → `resolveAorEngineRoot()` 또는 AOR 분기 자체를 `win32`로 제한하여 macOS는 명시적으로 plain fallback 처리하고, macOS 회귀 테스트를 추가해야 합니다.

- [AOR/support/_internal/import-claude-usage.js:75-101] Node importer는 여전히 `cache_read_input_tokens`를 `tokensSaved` 및 `reductionPercent`로 기록하고 `savedTokens`로 출력합니다. Windows PowerShell importer와 dashboard/report의 보정에도, 이 포함된 importer를 사용하는 경로는 backlog의 “cache read는 AOR 절감 아님” 결정을 위반합니다. → `after = before`, `tokensSaved = 0`, `reductionPercent = 0`으로 PowerShell 구현과 일치시키고 cache-read는 별도 usage 필드만 유지해야 합니다.

- [main.js:664] [main.js:675-682] `compressHookCache`는 enabled boolean만 key로 사용하고, 반환 전 `aor-hook` 및 `claude-settings.json`의 존재·일반 파일 여부·realpath를 재검증하지 않습니다. 파일 삭제/교체 후에도 stale `--settings` 경로를 계속 주입하며, 예측 가능한 `${pid}.tmp`는 userData 쓰기 권한자가 symlink로 만들 경우 `writeFileSync()`가 외부 target을 덮어쓸 수 있습니다. → cache hit에서도 parent/leaf `lstat`·realpath를 검증하고 실패 시 cache를 폐기해야 합니다. temp는 예측 불가능한 이름과 `wx` 생성으로 만들고, 최종 파일도 symlink가 아닌 일반 파일인지 확인해야 합니다.

- [main.js:1085-1088] [renderer.js:1016-1017] [AOR/engine/windows/_internal/claude-integration.ps1:493-496] 사용자 지정 `--settings=path` 형식은 `includes('--settings')`/`-contains '--settings'` 검사에서 누락됩니다. hook 설정이 추가되어 설정 옵션이 중복되고, Claude의 옵션 우선순위 또는 실행 자체가 달라질 수 있습니다. 또한 wrapper의 subcommand 제외는 첫 인자만 보므로 global option 앞의 subcommand도 잘못 hook을 받습니다. → `--settings`, `--settings=<path>` 및 옵션 뒤 subcommand를 공통 argument parser로 식별하고, 사용자 설정 또는 모든 subcommand에서는 hook을 절대 추가하지 않아야 합니다.

## 5. Minor 이슈

- [scripts/test-compress-hook.js:39-64] 성공 경로 테스트가 실제 engine binary 존재를 전제합니다. README상 binary는 Git에 포함되지 않으므로 clean checkout에서 `npm test`가 실패할 수 있습니다. → 임시 placeholder engine과 fake successful runner를 사용해 unit test를 binary 독립적으로 만들고, 실제 engine 검증은 별도 integration test로 분리해야 합니다.

- [scripts/test-electron-aor.js:66-79] `--settings <path>`와 첫 인자 `mcp`만 검증합니다. → `--settings=x.json`, `claude --verbose mcp list`, hook 설정 파일 삭제/교체 후 재생성, stale cache 거부를 E2E 회귀 케이스로 추가해야 합니다.

## 6. Optional 제안

- [AOR/carrotcap/compress-hook.js:115-122] 보존 alert가 최대 30개와 각 300자로 제한되어 성공 종료라도 진단 문자열 일부가 summary와 raw log에만 남습니다. → 모델이 즉시 판단해야 하는 signal의 명확한 범위를 문서화하고, raw 경로가 엔진이 항상 생성한 일반 파일인지 integration test에서 검증하는 것을 권고합니다.

## 7. 최종 권고

- [ ] [main.js:710-713] macOS에서 Windows AOR engine을 선택하지 않도록 수정하고 plain fallback을 검증한다.
- [ ] [AOR/support/_internal/import-claude-usage.js:75-101] cache-read를 절감으로 기록하는 잔여 경로를 제거한다.
- [ ] [main.js:664-682] hook 설정 파일 cache·symlink·temp-file 안전성을 보강한다.
- [ ] [main.js:1085-1088] [renderer.js:1016-1017] [claude-integration.ps1:493-496] `--settings=` 및 option-prefixed subcommand 회귀를 수정한다.
- [ ] `npm test`, `npm run test:aor` 및 macOS plain-fallback 회귀 테스트를 추가·실행한다.