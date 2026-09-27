# Review Report — task-022-r1 (feature/task-022-terminal-copy)

## 1. 리뷰 대상
- 파일/모듈 목록
  - `main.js`
  - `renderer.js`
  - `scripts/test-validate-settings.js`
  - `scripts/test-electron-aor.js`
  - `scripts/test-electron-copy.js`
  - `package.json`
  - `backlog/task-022.md`
- 변경 라인 수: 258 additions, 11 deletions
- 리뷰 시점: 2026-09-27T06:40:28Z

## 2. 전체 판단
- ⚠️ 조건부 승인
- 렌더러의 CLI/엔진 경로 변경 차단과 xterm 강제 선택 방식은 적절하나, 실행 중 settings 파일이 사라지거나 손상된 경우 `settings:set`이 복구 가능한 원본을 덮어쓰고 built-in CLI 없는 부분 설정을 저장합니다.

## 3. Critical 이슈
- 없음.

## 4. Major 이슈
- [main.js:1451] `loadSettings()`가 `null`(실행 중 settings 파일 삭제·손상·읽기 실패)일 때 `applyRendererSettings(null, next)` 결과만 저장합니다. 이 결과에는 renderer 허용 필드만 남고 `cli`, `settingsVersion`, `defaultShell`, `ui` 등이 없어지며, `ensureBuiltinCli`도 적용되지 않습니다. 다음 CLI 실행은 파일에서 CLI를 읽으므로 “not configured”가 될 수 있고, 손상 파일 원본도 `initUserState`의 백업 절차 없이 덮어써 복구 기회를 잃습니다. → `settings:set`에서 읽기 실패를 별도 처리해 기존 손상 파일을 백업한 뒤 기본값/마이그레이션/built-in CLI 복구를 수행하고, 정상 파일 경로에서도 저장 직전 `ensureBuiltinCli`를 적용해야 합니다.
- [scripts/test-validate-settings.js:812] `applyRendererSettings(null, ...)`의 기대값이 renderer 필드만 가진 부분 객체입니다. 이는 [main.js:1451]의 잘못된 저장 결과를 정상으로 고정하며, 실제 IPC 저장 이후 CLI 상태·CLI 실행 가능 여부를 검증하지 않습니다. → 파일 누락/손상 상태에서 `settings:set` 호출 후 `claude`·`codex`·`grok` 유지 또는 복구, 백업 생성, 이후 `cli:status` 및 `pty:spawn` 동작을 E2E로 검증해야 합니다.

## 5. Minor 이슈
- [renderer.js:910] 및 [renderer.js:914] 실제 동작은 마우스 추적 중 일반 왼쪽 드래그를 강제 선택으로 바꿨지만, 주석과 헤더 안내는 여전히 `Shift+드래그로 선택`이라고 표시합니다. 사용자가 필요 이상으로 Shift를 사용하게 되고 변경 목적과 UI가 불일치합니다. → 안내 문구를 “드래그로 선택”으로 바꾸고, modifier 클릭은 앱에 전달된다는 제한을 필요 시 함께 안내해야 합니다.
- [scripts/test-validate-settings.js:823] 새 절대 경로 허용은 `isAllowedCliCommand` 단위 수준만 검증합니다. [main.js:1182]와 [main.js:1191]의 실제 명령 조립에는 공백·apostrophe가 있는 절대 CLI 경로를 넣어 검증하지 않습니다. → Windows PowerShell 및 POSIX 경로 각각에서 공백/apostrophe 포함 경로가 단일 실행 파일 인자로 유지되고 shell metacharacter가 실행되지 않음을 `resolvePtyArgs` 수준에서 테스트해야 합니다.
- [scripts/test-electron-copy.js:64] 일반 드래그 복사 회귀는 실제로 검증하므로 수정 전 실패했을 가능성이 높지만, double/triple-click 선택, 포커스, Alt/Ctrl 클릭의 앱 전달은 검증하지 않습니다. → xterm 마우스 추적 상태에서 단어/줄 선택과 modifier 클릭 비가로채기 회귀 테스트를 추가해야 합니다.

## 6. Optional 제안
- [main.js:1785] 절대 경로 CLI는 “존재하는 일반 파일”만으로 상태를 `true`로 반환합니다. POSIX에서는 실행 권한이 없는 파일도 true가 될 수 있습니다. → 지원 범위가 POSIX까지라면 실행 권한 또는 실제 실행 가능성을 상태 확인 기준에 포함할지 결정하고 테스트로 고정하는 것이 좋습니다.

## 7. 최종 권고
- [ ] `settings:set`의 `loadSettings() === null` 경로에서 손상 파일 백업과 기본 설정 재구성을 수행한다.
- [ ] 저장 직전 built-in CLI 복구를 적용해 부분 settings 저장을 방지한다.
- [ ] 누락/손상 settings 파일 상태에서 저장 후 CLI 상태와 실행을 검증하는 E2E를 추가한다.
- [ ] 공백/apostrophe 절대 경로의 Windows/POSIX shell quoting 테스트를 추가한다.
- [ ] 복사 안내 문구를 현재 일반 드래그 동작과 일치시킨다.
