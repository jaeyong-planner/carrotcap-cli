# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main.js`, `main-winpath.js`, `main-skills.js`, `renderer.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `backlog/task-027.md`
- 변경 라인 수: +300 / -12
- 리뷰 시점: 2026-09-27T23:11:02Z

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- 캐시·IPC·PATH 순서·CLI 상태 갱신은 이전 지적을 해소했으나, 확장형 registry PATH와 비동기 pane 생성 race를 수정해야 합니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main-winpath.js:70] `EnvironmentVariableTarget.Machine/User`에서 읽은 PATH를 그대로 child environment에 넣습니다. registry의 `REG_EXPAND_SZ` PATH 항목(예: `%USERPROFILE%\bin`, `%ProgramFiles%\...`)은 확장되지 않아 새 터미널과 `where.exe`가 해당 도구를 찾지 못합니다. 코드 주석의 “expanded” 보장도 충족하지 않습니다. → PowerShell에서 Machine/User 값을 출력하기 전에 `[Environment]::ExpandEnvironmentVariables(...)`로 확장하고, `%USERPROFILE%` 기반 경로가 terminal·`cli:status`에서 발견되는 unit/E2E를 추가하십시오. Windows의 `REG_EXPAND_SZ`는 별도 확장 API가 필요합니다. [Microsoft registry value documentation](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-value-types)

- [renderer.js:597] `pty:spawn`이 registry read를 최대 4.5초 기다리게 되었지만, `spawnIntoPane()`은 await 중 tab/pane이 닫혔는지 확인하지 않습니다. 사용자가 대기 중 tab을 닫으면 `leaf.ptyId`가 없어서 정리되지 않고, 응답 뒤 보이지 않는 leaf에 PTY가 생성되어 session 누수 및 `MAX_SESSIONS` 고갈이 발생합니다. → `await api.spawnPty()` 직후 `state.panes.has(leaf.id)`와 DOM 연결 상태를 검증하고, 이미 닫혔으면 생성된 PTY를 즉시 `killPty`한 뒤 terminal을 dispose하십시오. “spawn 대기 중 pane 닫기” E2E도 추가하십시오.

- [scripts/test-electron-smoke.js:388] late-install smoke는 `!packagedExe`만 조건으로 삼아 macOS/Linux dev smoke에서도 실행됩니다. non-Windows에서는 `main.js`가 registry PATH feature를 활성화하지 않으므로 line 402의 `cli:status === true`가 실패하고, `.cmd` probe도 실행할 수 없습니다. → 조건을 `process.platform === 'win32' && !packagedExe`로 제한하거나 OS별 probe를 구현하십시오. 현재 상태는 cross-platform `npm run test:smoke` 회귀입니다.

## 5. Minor 이슈

- [scripts/test-winpath.js:38-48] 병합·UTF-8·cache 실패는 검증하지만 `%VAR%` 형식의 `REG_EXPAND_SZ` PATH 항목과 확장 결과의 dedupe는 검증하지 않습니다. → `%USERPROFILE%\tools` 같은 fixture를 추가하고, expanded path가 하나만 포함되는지 확인하십시오.

- [scripts/test-electron-smoke.js:400-415] smoke는 `cli:status` 및 focus 후 missing mark 해제, 새 pane의 bare command 실행까지 확인하지만, 실제 Quick CLI 클릭이 stale `false`를 재조회한 뒤 command를 terminal에 쓰는 흐름은 확인하지 않습니다. → late registration 뒤 GROK 버튼을 클릭해 probe 출력까지 확인하십시오.

## 6. Optional 제안

- [main.js:1640] PowerShell 실행은 `execFile` 기반이라 main process를 동기적으로 막지 않지만, 5초 cache 만료 직후 첫 pane은 정상 환경에서도 registry read 동안 지연됩니다. → UX가 문제되면 stale cache를 즉시 사용하고 refresh를 background로 수행하는 방식을 검토하십시오.

## 7. 최종 권고

- [ ] Machine/User PATH의 `REG_EXPAND_SZ` 값을 확장한 뒤 merge한다.
- [ ] async `pty:spawn` 완료 전에 닫힌 pane/tab의 PTY를 정리한다.
- [ ] Windows 전용 smoke를 명시해 non-Windows smoke 회귀를 제거한다.
- [ ] expanded PATH, spawn 중 pane 닫기, late-installed Quick CLI 실행 test를 추가한다.
- [ ] 이전 r2 지적의 `pathSig` cache 무효화, renderer 재조회, `\` root 보존, async test-file read, SKILLS refresh 경로는 확인됨.