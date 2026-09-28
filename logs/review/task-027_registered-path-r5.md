# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main-winpath.js`, `main.js`, `main-skills.js`, `renderer.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `scripts/test-electron-winpath.js`, `scripts/lib/cdp-app.js`, `backlog/task-027.md`
- 변경 라인 수: +467 / -15
- 리뷰 시점: 2026-09-27T23:31:54Z

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- PATH 조회·병합과 r4의 spawn-ready 처리 자체는 적절하나, 대기 중 활성 pane이 바뀌면 명령이 다른 pane에 실행될 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:1232] `activeLeafReady()`는 대기 전의 `leaf`를 기억하지만, 완료 후 `activeLeafOrWarn()`로 현재 활성 pane을 새로 반환합니다. registry PATH 조회 동안 사용자가 다른 pane을 선택하면, 처음 클릭한 Quick CLI 또는 Flow 명령이 새 활성 pane에 기록됩니다. `ptyId` 재검증은 하지만 pane identity를 보장하지 않습니다. → 대기 전 `leaf.id`를 보관하고, await 후 `state.activePaneId === leaf.id`, `state.panes.get(leaf.id) === leaf`, `leaf.ptyId`를 모두 확인하십시오. 하나라도 다르면 실행을 취소하고 “활성 pane이 변경되었습니다” 상태를 표시하십시오.

## 5. Minor 이슈

- [scripts/test-electron-winpath.js:90] 지연된 `pty:spawn` 중 Quick CLI가 정확히 한 번 실행되는 경우만 검증합니다. `runAiopsFlow()`의 두 ready checkpoint와 pane 전환 중 잘못된 대상 실행은 검증하지 않습니다. → delayed registry fixture에서 Flow 버튼 실행과 대기 중 pane 전환을 추가하여, 원 pane에서 한 번 실행되거나 pane 변경 시 명시적으로 취소되는지 E2E로 확인하십시오.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] `activeLeafReady()`가 대기 전 선택한 pane identity를 유지하도록 수정한다.
- [ ] PATH 조회 대기 중 pane 전환에 대한 Quick CLI·Flow E2E를 추가한다.
- [ ] PowerShell 실행문은 상수이며 `execFile` 인자 배열을 사용하고, test registry override는 `!app.isPackaged`에서만 활성화됨을 확인했다.
- [ ] app PATH 우선 병합, case·trailing slash 중복 제거, UTF-8 처리, cache/inflight·실패 시 기존 PATH 유지, `Path`/`PATH` 정리, non-Windows 비활성화, `cli:status`·`findCommandSync`의 동일 PATH 적용을 확인했다.