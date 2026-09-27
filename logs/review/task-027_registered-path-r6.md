# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main-winpath.js`, `main.js`, `main-skills.js`, `renderer.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `scripts/test-electron-winpath.js`, `scripts/lib/cdp-app.js`, `backlog/task-027.md`
- 변경 라인 수: +467 / -15
- 리뷰 시점: 2026-09-27T23:41:57Z

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- PATH 병합·PowerShell 상수 실행·cache·UTF-8·Electron IPC 경계는 적절하지만, Quick CLI가 비동기 재확인 중 다른 pane으로 실행될 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:1284-1288] `activeLeafReady()`가 반환한 원래 pane을 버린 뒤 `cliMissing()`을 await하고, 완료 후 `activeLeafOrWarn()`로 현재 활성 pane을 다시 가져옵니다. 시작 시 CLI 상태가 `false`이면 `cliMissing()`은 `cli:status` 재조회(PowerShell/`where.exe` 대기 가능)를 수행합니다. 이 사이 사용자가 pane을 바꾸고, 재조회 결과가 `true`가 되면 처음 클릭한 Quick CLI 명령이 새 활성 pane으로 전송됩니다. → `const leaf = await activeLeafReady()`를 보존하고, `cliMissing()` 및 `ensureJev()` 뒤 `state.activePaneId === leaf.id`, `state.panes.get(leaf.id) === leaf`, `leaf.ptyId`를 재검증하십시오. 실패 시 실행을 취소하고 현재의 pane 변경 안내를 표시하며, `activeLeafOrWarn()`로 재선택하지 말고 검증된 `leaf`에만 쓰십시오.

- [renderer.js:1350-1364] System One Flow는 첫 `activeLeafReady()` 이후 `clmStatus()` 또는 `ensureJev()`를 await한 다음 새 `activeLeafReady()`를 호출합니다. 그 사이 pane을 변경하면 원 클릭 pane이 아닌 새 활성 pane을 기준으로 실행됩니다. → Flow 시작 시 pane identity를 고정하고 모든 비동기 단계 뒤 동일 identity/`ptyId`를 확인하십시오. pane 변경 시 명령을 전송하지 마십시오.

## 5. Minor 이슈

- [scripts/test-electron-winpath.js:113-124] pane 전환 회귀 테스트는 CLAUDE가 spawn 대기 중일 때만 다룹니다. `cliMissing()` 재조회 중 상태가 `false → true`로 바뀌는 Quick CLI 경로와 System One Flow의 `clmStatus()`/Jev 대기 중 pane 전환은 검증하지 않습니다. → 지연된 상태 재조회 fixture에서 pane을 전환한 뒤, 어떤 pane에도 marker가 출력되지 않는 Quick CLI 및 System One Flow E2E를 추가하십시오.

## 6. Optional 제안

- 없음.

## 7. 최종 권고

- [ ] Quick CLI의 모든 await 뒤 최초 pane identity와 `ptyId`를 재검증한다.
- [ ] System One Flow도 클릭 시점 pane을 끝까지 유지하거나, pane 변경 시 명시적으로 취소한다.
- [ ] CLI 상태 재조회 중 및 Flow 비동기 단계 중 pane 전환 E2E를 추가한다.
- [x] PowerShell 명령은 상수이며 `execFile` 인자 배열을 사용한다.
- [x] 테스트 registry override는 `!app.isPackaged`일 때만 활성화된다.
- [x] app PATH 우선 병합, `Path`/`PATH` 중복 제거, non-Windows 비활성화, UTF-8 처리, cache/inflight, 실패 fallback, `cli:status`·`findCommandSync`의 동일 PATH 적용을 확인했다.