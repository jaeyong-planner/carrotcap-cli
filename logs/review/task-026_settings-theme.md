# Review Report — task-026 settings panel · themes

## 1. 리뷰 대상

- 파일/모듈 목록: `index.html`, `main.js`, `renderer.js`, `styles.css`, `main-skills.js`, `scripts/test-electron-smoke.js`, `scripts/test-validate-settings.js`, `scripts/test-electron-skills.js`, `backlog/task-026.md`
- 변경 라인 수: 추적 파일 기준 `+298 / -25`, 신규 backlog 문서 1개
- 리뷰 시점: 2026-09-27T17:59:36Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- IPC whitelist와 Electron isolation은 유지됐고 official marketplace 회귀도 수정됐지만, 저장 실패 처리·font size 상한·라이트 테마 초기 렌더링을 수정해야 합니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main.js:216-217, renderer.js:240-242] main process는 `fontSize`를 최대 64까지 저장하지만 renderer는 32 초과를 무효로 보고 14로 fallback합니다. 허용된 IPC 값 `64`가 디스크에는 저장되고, 다음 실행에서 사용자가 선택하지 않은 14px로 표시됩니다. → `validateSettings()`의 상한을 UI 계약과 동일한 `32`로 제한하고, `33`, `64` 입력이 기존 디스크 값을 보존하는 unit test를 추가하십시오.

- [renderer.js:276-293] `saveUi()`가 IPC 저장 오류를 catch 후 성공 여부를 반환하지 않으며, `setTheme()`과 `setFontSize()`는 저장 실패 뒤에도 변경된 `state.settings`와 UI/terminal 옵션을 유지합니다. 디스크 설정은 이전 값인데 화면은 새 값으로 동작해 재시작 시 되돌아갑니다. → 저장 전 상태를 보존하고 `saveUi()`가 boolean 또는 throw로 실패를 전달하게 하십시오. 성공한 경우에만 테마·글꼴을 적용하거나 실패 시 state와 UI를 rollback하십시오.

- [renderer.js:44-55] 저장된 테마를 읽고 `applyTheme()`하기 전에 폰트 로딩을 최대 1.5초 기다립니다. `styles.css`의 초기 `:root`는 dark이므로 light 사용자는 창 background가 white여도 본문을 dark로 최대 1.5초 볼 수 있습니다. → settings 조회와 `applyTheme()`를 폰트 대기보다 먼저 수행하고, 터미널 생성 전까지는 폰트 대기만 유지하십시오. light 설정으로 cold start 시 첫 paint가 white인지 확인하는 smoke 검증을 추가하십시오.

## 5. Minor 이슈

- [main.js:159-163, renderer.js:257] `system` 테마에서 OS 색상 변경 시 renderer와 terminal은 `matchMedia` 이벤트로 갱신되지만 BrowserWindow의 `backgroundColor`는 시작/`settings:set` 시점에만 설정됩니다. OS 테마 변경 뒤 native window background는 이전 색으로 남습니다. → `nativeTheme`의 `updated` 이벤트에서 현재 설정이 `system`이면 `mainWindow.setBackgroundColor()`를 다시 호출하고, system 변경 시 renderer와 native background 모두 갱신되는 테스트를 추가하십시오.

- [renderer.js:269-305, index.html:26] Esc 종료 때만 ⚙ 버튼으로 focus를 되돌립니다. 테마 버튼 등에 focus가 있는 상태에서 바깥 클릭으로 닫으면 focus가 `display:none` 패널 내부에 남을 수 있습니다. 또한 dialog를 열 때 첫 제어 요소로 focus를 이동하지 않습니다. → 공통 close 함수에서 패널 내부가 activeElement일 때 trigger로 focus를 복구하고, 열 때 첫 theme button에 focus를 주십시오. Esc 및 outside-click 각각의 focus 반환을 smoke test로 검증하십시오.

- [scripts/test-electron-smoke.js:352-353] “system theme follows the OS setting” 검증은 현재 `matchMedia` 값과 현재 렌더 결과만 비교하며, `change` listener 실행은 검증하지 않습니다. → media-query change를 발생시키는 Electron/DevTools 환경 또는 단위로 listener callback을 주입해 dark↔light 전환과 기존 terminal palette 변경을 확인하십시오.

## 6. Optional 제안

- [index.html:17,26] trigger에는 `aria-haspopup="dialog"`가 있으나 `aria-controls="settings-panel"`가 없습니다. → 두 요소의 관계를 명시해 보조기기 탐색성을 높이십시오.

- [scripts/test-electron-skills.js:381-390] catalog API의 `marketReady`만 확인하며 renderer가 official entry에 “마켓 추가” 버튼을 렌더하지 않는지는 확인하지 않습니다. → official marketplace가 없는 fixture에서 SKILLS modal을 열고 official entry에 `.skill-market-btn`가 없음을 E2E로 확인하십시오.

## 7. 최종 권고

- [ ] `fontSize` IPC validation 상한을 32로 통일하고 상한 경계 regression test를 추가한다.
- [ ] settings 저장 실패 시 renderer state, terminal 옵션, 표시값을 rollback한다.
- [ ] light 테마를 폰트 대기 전에 적용해 initial dark flash를 제거한다.
- [ ] system OS 변경 시 BrowserWindow backgroundColor를 갱신한다.
- [ ] 패널 close/open focus 관리를 보완하고 Esc·outside-click·system change·저장 실패를 smoke test에 추가한다.
- [ ] 위 수정 후 `npm test`, `npm run test:smoke`, `npm run test:skills`를 실행한다.