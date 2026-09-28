# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main.js`, `main-winpath.js`, `main-skills.js`, `renderer.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `scripts/test-electron-winpath.js`, `scripts/lib/cdp-app.js`, `backlog/task-027.md`
- 변경 라인 수: +419 / -13
- 리뷰 시점: 2026-09-27T23:24:41Z

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- PATH 병합·cache·확장 변수·IPC 안전성은 적절하지만, PATH 조회 대기 중 Quick CLI/Flow 실행이 입력을 유실할 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [renderer.js:1271] `runCli()`는 `pty:spawn`이 registry PATH 조회로 최대 4.5초 대기 중인 pane에서도 `leaf.ptyId` 존재 여부를 확인하지 않고 `writePty()`를 호출합니다. 이 시점의 `ptyId`는 아직 `undefined`이므로 Quick CLI 클릭이 silent fail하고, UI는 `leaf.cli` 및 성공 상태만 갱신할 수 있습니다. 동일한 문제가 Flow 실행에도 있습니다. → pane별 spawn Promise/ready 상태를 보관해 Quick CLI·Flow 실행 전에 완료를 await한 뒤 pane 존재와 `ptyId`를 재검증하거나, spawn 완료 전 해당 실행 UI를 비활성화하십시오.

- [renderer.js:1349] `runAiopsFlow()`도 대기 중인 활성 pane에 명령을 기록하려 하므로, 새 탭을 열자마자 START/REVIEW/MEDIA를 누르면 명령이 전달되지 않습니다. 이번 변경으로 정상 환경에서도 새 pane 생성이 수백 ms~4.5초 비동기가 되었으므로 기존보다 재현 가능성이 높습니다. → [renderer.js:1271]과 동일한 ready gate를 공유하고, PTY 준비 전에는 명확한 대기 상태를 표시하십시오.

## 5. Minor 이슈

- [scripts/test-electron-winpath.js:62] pane/tab 닫힘 race는 검증하지만, 같은 지연 중 Quick CLI 또는 Flow를 실행해 명령이 PTY 생성 후 정확히 한 번 전달되는지는 검증하지 않습니다. → delayed registry fixture에서 fake CLI를 설정하고, pane 생성 대기 중 버튼/Flow를 실행한 뒤 PTY 준비 후 출력과 단일 실행을 E2E로 확인하십시오.

- [scripts/test-electron-smoke.js:403] late-install smoke는 `cli:status`, focus 재조회, bare command 실행을 확인하지만 실제 GROK Quick CLI 클릭 경로는 검증하지 않습니다. 따라서 `cliMissing()` 재조회 뒤 renderer가 명령을 쓰는 전체 흐름은 미검증입니다. → 실제 grok 실행을 피해야 한다면 probe command를 유지한 상태에서 Quick CLI 클릭이 probe 출력을 만드는 별도 fixture를 사용하십시오.

## 6. Optional 제안

- [main.js:38] cache 만료 뒤 최초 pane 생성은 PowerShell 조회 완료 또는 4.5초 cap까지 기다립니다. `execFile`이므로 main thread를 block하지는 않지만 UI 반응이 지연될 수 있습니다. → UX 문제가 확인되면 마지막 성공 cache로 즉시 spawn하고 registry refresh는 background로 수행하는 방식을 검토하십시오.

## 7. 최종 권고

- [ ] `pty:spawn` 완료 전 Quick CLI와 Flow 명령이 유실되지 않도록 pane ready gate를 추가한다.
- [ ] delayed registry read 중 Quick CLI/Flow 실행 E2E를 추가한다.
- [ ] late-install Quick CLI 클릭을 probe 기반 E2E로 검증한다.
- [ ] PowerShell 명령은 상수이고 `execFile` 인자 배열로 실행되며, test registry override는 `!app.isPackaged`에서만 활성화됨을 확인했다.
- [ ] app PATH 우선 병합, `Path`/`PATH` 중복 제거, non-Windows 비활성화, UTF-8 read, `%VAR%` 확장, 실패 throttle 및 pane-close PTY 정리는 확인했다.