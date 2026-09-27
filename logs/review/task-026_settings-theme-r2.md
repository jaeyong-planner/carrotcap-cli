# Review Report — task-026 settings panel · themes

## 1. 리뷰 대상

- 파일/모듈 목록: `index.html`, `main.js`, `renderer.js`, `styles.css`, `main-skills.js`, `scripts/test-electron-smoke.js`, `scripts/test-validate-settings.js`, `scripts/test-electron-skills.js`, `backlog/task-026.md`
- 변경 라인 수: 추적 파일 기준 `+336 / -27`, 신규 backlog 문서 1개
- 리뷰 시점: 2026-09-27T18:04:16Z

## 2. 전체 판단

- ✅ 승인
- r1의 IPC fontSize 상한, 저장 실패 rollback, 초기 테마 적용, system native background, 패널 focus/Esc 이슈가 모두 해결됐으며 Electron isolation·IPC whitelist도 유지됩니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- 없음.

## 5. Minor 이슈

- [scripts/test-electron-smoke.js:342-344] 글꼴 크기 변경 검증이 활성 탭의 terminal만 확인하며, 비활성 탭과 설정 변경 뒤 새로 생성되는 terminal은 검증하지 않습니다. 구현은 [renderer.js:245-246, 307]과 [renderer.js:575-583]에서 이를 지원하지만 회귀 시 탐지되지 않습니다. → 비활성 탭을 활성화해 font size를 확인하고, light theme·변경된 font size 상태에서 새 탭 또는 split을 만든 뒤 새 terminal의 palette와 font size를 검증하십시오.

## 6. Optional 제안

- [scripts/test-electron-smoke.js:353-361] CDP `Emulation.setEmulatedMedia`는 renderer의 `matchMedia` 경로를 검증하지만 [main.js:2018-2021]의 Electron `nativeTheme.updated` 및 `BrowserWindow.setBackgroundColor()` 경로는 직접 검증하지 않습니다. → main-process test harness에서 `nativeTheme` 변경을 유발하거나 `setBackgroundColor` 호출을 spy하여 system theme의 native background 갱신을 검증하십시오.

- [scripts/test-electron-skills.js:381-387] 공식 marketplace가 없어도 `marketReady: true`가 되는 main IPC 응답은 검증하지만, [renderer-skills.js:63]이 실제로 “마켓 추가” 버튼을 숨기는 UI 경로는 검증하지 않습니다. → marketplace fixture를 제거한 상태에서 SKILLS modal을 열고 official entry에 `.skill-market-btn`가 없음을 E2E로 확인하십시오.

## 7. 최종 권고

- [x] `settings:set`은 `ui.theme`·`ui.fontSize`만 디스크 설정에 반영하며 `fontFamily`, CLI, 경로 설정은 renderer가 변경할 수 없습니다.
- [x] `validateSettings()`와 panel 계약은 font size `8–32`, theme `dark/light/system`으로 일치합니다.
- [x] `contextIsolation: true`, `nodeIntegration: false`, sandbox 및 trusted IPC sender 검증이 유지됩니다.
- [x] 공식 marketplace 항목은 marketplace 부재 시에도 설치 흐름에서 정상 처리됩니다.
- [ ] 비활성·신규 terminal과 nativeTheme update에 대한 회귀 테스트를 보강하십시오.