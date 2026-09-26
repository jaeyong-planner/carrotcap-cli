# Review Report — task-010 / task-011 (395d104, a1a06ef)

## 1. 리뷰 대상

- 파일/모듈 목록: `renderer.js`, `main.js`, `index.html`, `styles.css`, `preload.js`, `scripts/test-electron-smoke.js`, 문서·백로그
- 변경 라인 수: +383 / -25
- 리뷰 시점: 2026-09-26T04:02:56Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- Electron 격리와 경고 렌더링 방식은 안전하지만, IME 포커스 복구·반복 단축키·종료된 PTY 전송·stale selection이 핵심 입력 흐름을 깨뜨릴 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:870] `e.repeat`일 때 즉시 반환하여, 최초 앱 단축키 이벤트만 소비하고 반복 `Ctrl+Shift+W/T`, `Alt+Shift+Arrow` 이벤트는 xterm/TUI로 전달됩니다. 주석의 “key repeat 무시”와 달리 터미널 키 누출이 발생합니다. → 단축키 일치 여부를 먼저 판별하고, 반복 이벤트도 `preventDefault()`·`stopPropagation()`으로 소비하되 작업 실행만 생략해야 합니다.

- [renderer.js:884] 포커스 복구가 `e.key.length !== 1`을 제외하므로 Windows IME의 `Process`, dead key 등으로 시작하는 조합 입력에서는 composer에 포커스가 이동하지 않습니다. 버튼/트리 선택 뒤 한글 입력이 다시 유실될 수 있으며, 현재 smoke test는 composer가 이미 포커스를 가진 경우만 검사합니다. → `compositionstart`/`beforeinput`을 포함해 텍스트 입력 의도를 감지하고, IME 조합 시작 전에 composer로 포커스를 옮기는 경로를 추가해야 합니다.

- [renderer.js:499] [renderer.js:513] [renderer.js:655] 종료 이벤트 후에도 `leaf.ptyId`가 유지됩니다. 따라서 PTY가 `term.paste()` 이후 60ms CR 전송 전 종료되거나, 이미 종료된 pane이 활성 상태이면 composer는 입력을 비우고 history에는 저장하지만 `main.js`가 해당 쓰기를 조용히 버립니다. → PTY 종료 시 해당 leaf를 전송 불가 상태로 전환하고, delayed CR 전에 session/leaf 생존성을 확인해야 합니다. 실패 시 composer 내용을 보존하거나 사용자에게 전송 실패를 표시해야 합니다.

- [renderer.js:569] [renderer.js:594] 자동 복사 후 selection을 유지하므로, TUI redraw 뒤에도 남은 stale selection이 `term.hasSelection()`을 참으로 만들면 다음 `Ctrl+C`가 SIGINT 대신 복사로 처리됩니다. 이는 자동 복사의 의도와 달리 중단 키를 막습니다. → 자동 복사 완료 후 selection을 해제하거나, selection 변경 시점·마우스 drag 여부를 추적하여 현재 drag에서 만든 유효 선택에만 복사 동작을 적용해야 합니다.

## 5. Minor 이슈

- [renderer.js:625] 1MB 제한을 맞추는 동안 전체 문자열을 반복 UTF-8 인코딩하고, 임의의 UTF-16 code-unit 위치에서 `slice()`합니다. 큰 다국어 버퍼에서는 renderer UI가 멈출 수 있고 surrogate pair 경계가 잘리면 복사 텍스트가 손상됩니다. → 줄 단위로 byte budget을 누적해 뒤쪽부터 구성하거나, code point 경계를 보장하는 단일 절단 방식을 사용해야 합니다.

- [renderer.js:592] [renderer.js:596] 모든 선택이 전역 clipboard를 즉시 덮어쓰며, 현재 mouse interaction에서 selection이 실제로 변경되지 않아도 기존 선택을 재복사할 수 있습니다. → mouse-down 이후 selection 변경 여부를 추적해 새 선택에서만 자동 복사하고, 자동 복사 정책을 사용자 설정으로 제공하는 것을 검토해야 합니다.

## 6. Optional 제안

- [renderer.js:876] `Alt+Shift`는 Windows 입력 언어 전환에 사용될 수 있고, 해당 조합은 PowerShell/Claude Code 등 TUI에도 전달되지 않습니다. → 실제 Windows 입력 언어 단축키 활성 환경 및 PowerShell/Claude Code에서 수동 회귀 테스트를 추가하고, 충돌 시 재설정 가능한 단축키를 제공해야 합니다.

- [main.js:1077] `term-menu:show`는 전달받은 `id`가 현재 session인지 검증하지 않습니다. 새 명령은 renderer에서 일치하는 pane만 처리하고 command도 고정값이어서 즉시 보안 문제는 없지만 IPC 경계 검증은 불완전합니다. → `sessions.has(id)` 및 sender 검증 후 메뉴를 생성해야 합니다.

## 7. 최종 권고

- 반복 단축키도 터미널로 전파되지 않도록 수정한다.
- 버튼/트리 포커스 상태에서 IME 조합 시작 입력을 재현·수정한다.
- PTY 종료 및 pane 전환 중 composer 전송의 보존/실패 표시를 구현한다.
- copy-on-select 후 stale selection이 SIGINT를 막지 않도록 상태를 분리한다.
- 추가 테스트: Korean IME를 버튼/트리 포커스에서 시작하는 경우, shortcut key repeat, paste 후 60ms 이내 PTY 종료, TUI redraw 후 `Ctrl+C`, 1MB 초과 이모지 포함 버퍼 복사, Windows 입력 언어 단축키 활성 환경.