# Review Report — task-008-009 Round 2

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `preload.js`, `renderer.js`, `package.json`, `scripts/test-electron-smoke.js`, `scripts/test-validate-settings.js`, `templates/aiops/*`
- 변경 라인 수: 1,077 additions, 213 deletions
- 리뷰 시점: 2026-09-26T03:47:49Z

## 2. 전체 판단

- ✅ 승인
- userData 초기화·손상 설정 보존·템플릿 사전검증·UTF-8 용량 제한이 이전 지적대로 반영됐고, Electron 격리와 IPC 검증도 유지된다.

| 이전 리뷰 항목 | 상태 | 근거 |
|---|---|---|
| fresh userData에서 `app.setPath()` 크래시 | RESOLVED | [main.js:34-39], [scripts/test-electron-smoke.js:30-36] |
| 손상 `settings.json` 무경고 덮어쓰기 | RESOLVED | [main.js:422-430], [scripts/test-electron-smoke.js:168-171] |
| 누락 템플릿으로 성공·부분 상태 반환 | RESOLVED | [main.js:585-598], [main.js:1026-1031], [scripts/test-validate-settings.js:440-458] |
| clipboard/PTY 1MB UTF-8 byte 상한 | RESOLVED | [main.js:300-303], [main.js:1036-1039], [main.js:1064-1076] |
| legacy migration 성공 전 로그 | RESOLVED | [main.js:436-439] |
| packaged `CLAUDE.md`가 `app.asar`에 기록됨 | RESOLVED | [main.js:43-44], [main.js:432-434], [main.js:971-981] |
| resize 실패 로그 | RESOLVED | [main.js:1045-1051] |
| kill 실패 후 session 삭제 | RESOLVED | [main.js:1053-1059] |
| CLAUDE 저장 오류 사유 미표시 | RESOLVED | [renderer.js:710-716] |
| Electron/CDP smoke 부재 | RESOLVED | [scripts/test-electron-smoke.js:137-171] |

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- 없음.

## 5. Minor 이슈

- [scripts/test-electron-smoke.js:103-110] clipboard smoke는 IPC read/write 왕복과 API 노출만 검사하며, `attachClipboard()`의 실제 키 경로(`Ctrl+C` 선택 유무, `Ctrl+Shift+V`, `Shift+Insert`) 및 paste 중복 방지는 검증하지 않는다 → CDP `Input.dispatchKeyEvent`와 PTY 입력 관측을 추가해 선택 없는 `Ctrl+C`가 SIGINT로 전달되고 paste가 한 번만 수행되는지 검증해야 한다.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [x] `userData` 경로는 renderer가 제어하지 않으며, legacy workspace 상태도 main process에서 allowlist 검증을 거쳐 복원한다. [main.js:34-50], [main.js:1100-1109]
- [x] clipboard IPC와 `term-menu:show`는 trusted-sender 및 PTY ID wrapper를 통과하며, 메뉴 command는 해당 PTY를 가진 열린 pane에만 적용된다. [main.js:943-959], [main.js:1078-1089], [renderer.js:489-499]
- [x] pane 종료 시 terminal을 dispose하고 state에서 제거하므로 clipboard host listener가 누적되지 않는다. [renderer.js:142-146], [renderer.js:295-303], [renderer.js:467-487]
- [x] `templates/**/*`와 별도 참조되는 agents/scripts가 packaged build 포함 목록에 존재한다. [package.json:37-50]
- [ ] 다음 변경 시 실제 키 입력 기반 clipboard lifecycle smoke를 추가한다.