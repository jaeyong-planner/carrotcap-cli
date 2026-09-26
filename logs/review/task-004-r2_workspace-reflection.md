# Review Report — task-004-r2 main.js final-pass

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`
- 변경 라인 수: diff 미제공, `main.js` full-file 기준 검토
- 리뷰 시점: 2026-05-06T02:58:20Z

## 2. 전체 판단
- ⚠️ 조건부 승인
- settings 기반 allowlist 오염은 닫혔지만, `aiops:setup`의 symlink swap TOCTOU 방어는 아직 부분적이다.
- PRIOR Critical 1: RESOLVED — [main.js:76], [main.js:115], [main.js:846], [main.js:956] `settings:set -> validateSettings -> saveSettings -> settings.json -> boot` 경로에서 `recentWorkspaces`가 저장/승격되지 않고, 부팅 allowlist는 `workspace-state.json`만 읽는다.
- PRIOR Critical 2: PARTIAL — [main.js:368] `safeMkdir`는 ancestor symlink와 post-realpath를 검사하지만, [main.js:345], [main.js:356] `writeIfMissing`는 쓰기 직전 ancestor symlink를 검사하지 않아 `safeMkdir` 이후 directory swap TOCTOU가 남는다.
- PRIOR Major 1: RESOLVED — [main.js:204] `persistRecentWorkspace`가 `settings.json`이 아니라 [main.js:199] `workspace-state.json`만 저장한다.
- PRIOR Minor 1: RESOLVED — [main.js:209], [main.js:211] `normalizePath(real)` 기준으로 dedupe한다.
- task-002 Critical #4 (`folder:tree`): RESOLVED — [main.js:864] allowlist 검사를 수행하고, [main.js:956] 부팅 allowlist 오염 경로가 제거됐다.
- task-002 Critical #5 (`folder:search`): RESOLVED — [main.js:868], [main.js:870] allowlist와 query 타입/길이 제한이 적용됐고 persisted allowlist 오염 경로가 제거됐다.
- task-002 Critical #6 (`folder:open-in-os`): RESOLVED — [main.js:873], [main.js:876] allowlist와 존재 검사를 수행하고 persisted allowlist 오염 경로가 제거됐다.
- task-002 Critical #9 (`aiops:setup`): PARTIAL — [main.js:885], [main.js:893] workspace allowlist와 realpath 검사는 추가됐지만 [main.js:345], [main.js:356] 파일 쓰기 경로의 TOCTOU가 남는다.

## 3. Critical 이슈
- [main.js:356] `writeIfMissing()`가 `safeMkdir()` 이후 생성된 parent directory가 symlink/junction으로 교체됐는지 쓰기 직전에 검사하지 않고 `fs.writeFileSync(filePath, ...)`를 먼저 실행한다 → `writeIfMissing()` 내부에서 `filePath`의 모든 ancestor를 `projectRoot`까지 `lstatSync`로 재검사하고 symlink/junction이면 쓰기 전에 거부해야 한다. post-write `realpath` 검사는 보조 방어로만 유지해야 하며, workspace 밖 write가 발생한 뒤 cleanup하는 구조를 보안 경계로 삼으면 안 된다.

## 4. Major 이슈
- [main.js:615] `ensureAiopsProjectStructure()`가 반환하는 `agentsDir`, `logsDir`, `backlogDir`, `claudePath`는 [main.js:407]부터 조립한 lexical path이고, 모든 write 이후 각 반환 경로의 final `realpath`가 `realRoot` 내부인지 재검증하지 않는다 → return 직전에 네 경로 모두 `safeRealpath()` + `isPathInsideRoot(..., realRoot)`로 검증하고, 실패 시 `{ ok: false }`가 되도록 `null`을 반환해야 한다.

## 5. Minor 이슈
- [main.js:887] `aiops:setup` 주석이 “`defaultProjectPath` is also allowed because it is added to allowedWorkspaces at boot”라고 설명하지만 실제 부팅 경로 [main.js:956]는 `workspace-state.json`만 읽는다 → 보안 모델을 오해하지 않도록 해당 주석을 “renderer must call folder:pick; defaultProjectPath is not a permission grant”로 수정해야 한다.
- [main.js:345] 주석은 “file itself or any ancestor directories”를 검사한다고 쓰여 있지만 실제 구현은 [main.js:349] file path 자체만 `lstatSync`한다 → 주석과 구현이 불일치하므로, Critical 이슈 수정 전까지는 주석을 실제 동작에 맞추거나 구현을 주석 수준으로 올려야 한다.

## 6. Optional 제안
- [main.js:187] 기존 `settings.json`의 `recentWorkspaces`는 [main.js:115] whitelist 제거 후 다음 `settings:set` round-trip에서 silently drop된다 → 권한 grant를 settings에서 분리하는 목적상 허용 가능한 migration cost이나, UX 회귀를 줄이려면 최초 부팅 시 main process가 기존 값 중 `folder:pick`으로 검증된 값만 이관하는 별도 migration을 둘지 결정해야 한다.
- [main.js:368] `safeMkdir()`의 ancestor loop는 drive root `C:\`, UNC root `\\server\share`, POSIX `/`에서 [main.js:386], [main.js:387] parent self-loop로 종료되어 무한 루프 위험은 낮다 → Windows drive/UNC/POSIX root 케이스를 helper unit test로 고정하면 회귀를 줄일 수 있다.

## 7. 최종 권고
- 다음 행동 체크리스트: `writeIfMissing()`에 쓰기 직전 ancestor `lstatSync` 검사를 추가하고, parent symlink/junction이면 write 전에 실패시킨다.
- 다음 행동 체크리스트: `ensureAiopsProjectStructure()` return 직전 `agentsDir`, `logsDir`, `backlogDir`, `claudePath`의 final realpath 내부성 검사를 추가한다.
- 다음 행동 체크리스트: `defaultProjectPath` 관련 stale comment와 `writeIfMissing()` ancestor 검사 주석을 실제 보안 모델과 일치시킨다.
- 테스트 추가 필요 지점: `safeMkdir(agentsDir)` 이후 `agents`를 workspace 밖 symlink/junction으로 교체한 상태에서 `writeIfMissing(path.join(agentsDir, 'supervisor.md'))`가 파일을 쓰기 전에 실패하는지 검증.
- 테스트 추가 필요 지점: `settings:set({ recentWorkspaces: ['C:\\Windows'], defaultProjectPath: 'C:\\Windows' })` 후 재시작해도 `folder:tree/search/open-in-os/aiops:setup`이 허용되지 않는지 검증.
- 테스트 추가 필요 지점: `safeMkdir()`에 `C:\`, `\\server\share`, `/` root 경계와 case/separator 변형 경로를 넣어 loop 종료와 내부성 판단을 고정.