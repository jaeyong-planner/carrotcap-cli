# Review Report — task-022-r2 (feature/task-022-terminal-copy)

## 1. 리뷰 대상
- 파일/모듈 목록
  - `main.js`
  - `renderer.js`
  - `scripts/test-validate-settings.js`
  - `scripts/test-electron-aor.js`
  - `scripts/test-electron-copy.js`
  - `package.json`
- 변경 라인 수: 364 additions, 14 deletions
- 리뷰 시점: 2026-09-27T06:44:56Z

## 2. 전체 판단
- ⚠️ 조건부 승인
- 렌더러의 CLI·엔진 경로 변경 차단, 손상 설정 복구, Windows quoting 및 실제 마우스 추적 복사 E2E는 적절히 보완되었으나, 복구 뒤 CLI spawn 검증과 POSIX quoting·마우스 modifier 회귀 검증이 남아 있습니다.

## 3. Critical 이슈
- 없음.

## 4. Major 이슈
- [main.js:1453] R1 Major #1 — **RESOLVED**. `settingsBaseForWrite()`가 실행 중 삭제·손상된 설정을 번들 기본값, migration, built-in CLI로 재구성하고, 손상 파일은 백업한 뒤 저장합니다.
- [scripts/test-electron-aor.js:140] R1 Major #2 — **PARTIAL**. 삭제·손상 후 재구성, 백업, `cli:status`는 E2E로 검증하지만, 재구성 직후 `pty:spawn` 또는 CLI 버튼으로 실제 CLI가 실행되는지는 검증하지 않습니다. → 복구 후 fake CLI를 실행해 PTY 생성 및 인자 전달까지 확인해야 합니다.

## 5. Minor 이슈
- [renderer.js:914] R1 Minor #1 — **RESOLVED**. 안내 문구가 실제 동작과 일치하도록 “드래그로 선택·복사”로 변경됐습니다.
- [scripts/test-validate-settings.js:825] R1 Minor #2 — **PARTIAL**. 공백·apostrophe·shell metacharacter가 포함된 Windows PowerShell 실행은 실제 검증합니다. POSIX `resolvePtyArgs()` 경로의 공백·apostrophe·metacharacter 실행 회귀 검증은 없습니다. → POSIX 임시 실행 파일을 이용해 단일 argv 유지와 command injection 부재를 검증해야 합니다.
- [scripts/test-electron-copy.js:76] R1 Minor #3 — **PARTIAL**. double-click 단어 선택과 포커스는 검증하지만 triple-click 줄 선택, Alt/Ctrl 클릭의 앱 전달, right-click 메뉴 회귀는 검증하지 않습니다. → 마우스 추적 TUI에서 해당 입력이 의도대로 전달·선택되는 E2E를 추가해야 합니다.
- [renderer.js:876] 일반 왼쪽 `mousedown` 전체를 차단하므로, 마우스 추적 앱의 일반 왼쪽 클릭도 앱에 전달되지 않습니다. 현재 tooltip은 드래그만 선택으로 설명해 클릭 동작 상실을 충분히 알리지 않습니다. → [renderer.js:915]에 “일반 왼쪽 클릭·드래그는 선택에 사용되며 Shift/Alt/Ctrl 클릭만 앱에 전달”을 명시해야 합니다.
- [main.js:611] `saveSettings()`의 temp-file 정리 및 기존 파일 대상 Windows rename은 성공 경로만 [scripts/test-electron-aor.js:139]에서 간접 확인합니다. write/rename 실패 시 기존 설정 보존과 temp 제거를 검증하지 않습니다. → `fs.writeFileSync`·`fs.renameSync` 실패 주입 단위 테스트와 Windows 기존 대상 replace 회귀 테스트를 추가해야 합니다.

## 6. Optional 제안
- [main.js:1444] 실행 중 설정 파일이 삭제·손상된 뒤 `settings:get`을 호출하면 `null`을 반환합니다. 현재 일반 UI 흐름에는 재조회가 없지만, `settings:set`과 동일하게 안전한 기본 설정을 반환·복구하면 IPC 동작의 일관성이 높아집니다.

## 7. 최종 권고
- [ ] 손상·삭제 설정 재구성 뒤 실제 CLI PTY spawn을 E2E로 검증한다.
- [ ] POSIX 절대 경로의 공백·apostrophe·metacharacter quoting E2E를 추가한다.
- [ ] triple-click, Alt/Ctrl 클릭, right-click 메뉴의 마우스 추적 회귀 테스트를 추가한다.
- [ ] 일반 왼쪽 클릭도 앱에 전달되지 않는 제한을 tooltip에 명시한다.
- [ ] atomic save의 write/rename 실패 및 Windows 기존 파일 replace 테스트를 추가한다.