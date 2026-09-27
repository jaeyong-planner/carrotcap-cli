# Review Report — task-022-r3 (feature/task-022-terminal-copy)

## 1. 리뷰 대상
- 파일/모듈 목록
  - `main.js`
  - `renderer.js`
  - `scripts/test-validate-settings.js`
  - `scripts/test-electron-aor.js`
  - `scripts/test-electron-copy.js`
  - `package.json`
- 변경 라인 수: 374 additions, 14 deletions
- 리뷰 시점: 2026-09-27T06:50:54Z

## 2. 전체 판단
- ⚠️ 조건부 승인
- 설정의 CLI trust boundary·atomic write·절대 경로 quoting은 적절히 보완됐으나, Windows에서 Shift+클릭이 프로그램으로 전달된다는 안내가 xterm.js 실제 동작과 다르고 이에 대한 회귀 검증이 없습니다.

## 3. Critical 이슈
- 없음.

## 4. Major 이슈
- [main.js:1457] R1 Major #1 — **RESOLVED**. 삭제·손상된 설정 파일은 `settingsBaseForWrite()`에서 기본 설정·migration·built-in CLI로 재구성되며, 손상 파일은 백업 후 저장합니다.
- [scripts/test-electron-aor.js:154] R1 Major #2 — **RESOLVED**. 재구성된 설정에 full-path CLI를 둔 뒤 앱 저장을 수행하고, 실제 `pty:spawn`으로 해당 CLI와 인자를 실행하는 E2E가 추가됐습니다.

## 5. Minor 이슈
- [renderer.js:914] R1 Minor #1 — **RESOLVED**. 헤더 문구가 일반 드래그 선택·자동 복사 동작을 안내합니다.
- [scripts/test-validate-settings.js:842] R1 Minor #2 — **RESOLVED**. Git Bash에서 공백·apostrophe·`$(...)`를 포함한 POSIX quoting을 실제 실행해 단일 인자 전달과 command injection 부재를 확인합니다.
- [scripts/test-electron-copy.js:91] R1 Minor #3 — **PARTIAL**. triple-click·Ctrl+click·wheel·right-click은 검증했지만 Alt+click은 검증하지 않았고, Shift+drag는 프로그램 전달이 아니라 선택만 검증합니다.
- [renderer.js:877] R2 Minor(일반 클릭 제한 안내) — **PARTIAL**. 일반 왼쪽 클릭 제한은 명시됐지만, [renderer.js:915]의 “Shift/Alt/Ctrl+클릭은 프로그램으로”는 Windows xterm.js의 Shift force-selection 동작과 충돌합니다. Shift는 xterm의 선택 강제 modifier이므로 프로그램에 mouse report가 전달되지 않습니다. → 안내를 실제 동작에 맞게 수정하고, Shift/Alt/Ctrl 각각의 SGR 전달 또는 선택 동작을 E2E로 명시 검증해야 합니다.
- [scripts/test-validate-settings.js:854] R2 Minor(atomic save 실패 경로) — **RESOLVED**. write/rename 실패 주입에서 기존 파일 보존·temp 제거를 검증하고, 기존 파일 교체도 확인합니다.

## 6. Optional 제안
- [main.js:1448] `settings:get`은 실행 중 파일이 삭제·손상된 경우 여전히 `null`을 반환합니다. `settings:set`과 같은 재구성 경로를 사용하면 IPC 응답 일관성이 높아집니다.

## 7. 최종 권고
- [ ] [renderer.js:915]의 Shift+클릭 안내를 Windows xterm.js 실제 동작에 맞게 수정한다.
- [ ] [scripts/test-electron-copy.js:107]에 Alt+click SGR 전달 검증을 추가하고, Shift+click은 선택 우선인지 프로그램 전달인지 기대값을 명시한다.
- [ ] 수정 후 `test:copy`, `test:aor`, `test`를 실행한다.