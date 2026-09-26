# Review Report — task-004 main.js follow-up

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`, `preload.js`, `renderer.js`
- 변경 라인 수: diff 미제공, `main.js` full-file 기준 검토
- 리뷰 시점: 2026-05-06T02:52:02Z

## 2. 전체 판단
- ❌ 반려
- allowlist는 도입됐지만 renderer가 저장 가능한 settings를 부팅 시 신뢰하고, `aiops:setup` 하위 경로 symlink 쓰기 우회가 남아 임의 디렉터리 노출/쓰기 방어가 완료되지 않았다.
- Critical #4 (`folder:tree` rootPath): PARTIAL — [main.js:773] runtime `realpath` allowlist 검사는 추가됐지만 [main.js:110], [main.js:755], [main.js:869] renderer가 settings로 다음 부팅 allowlist를 오염시킬 수 있다.
- Critical #5 (`folder:search` rootPath/query): PARTIAL — [main.js:777] root allowlist와 [main.js:780] query clip은 추가됐고 empty-after-clip은 [main.js:704]에서 `[]` 처리되지만, persisted allowlist 오염 문제가 동일하게 남아 있다.
- Critical #6 (`folder:open-in-os` path): PARTIAL — [main.js:782] allowlist와 존재 검사는 추가됐고 [renderer.js:466], [renderer.js:484] 소비부는 반환값을 무시하므로 boolean 변경은 즉시 계약 파괴가 아니지만, persisted allowlist 오염 문제가 동일하게 남아 있다.
- Critical #9 (`aiops:setup` projectRoot): UNRESOLVED — [main.js:794] allowlist 검사는 추가됐지만 [main.js:345], [main.js:350]에서 하위 symlink/junction을 따라 workspace 밖에 파일을 쓸 수 있고, persisted allowlist 오염도 쓰기 경로에 영향을 준다.

## 3. Critical 이슈
- [main.js:110] `defaultProjectPath`와 [main.js:112] `recentWorkspaces`가 `settings:set` whitelist에 포함되고, [main.js:755] renderer가 이를 저장할 수 있으며, [main.js:869]와 [main.js:871]에서 다음 부팅 시 그대로 `allowedWorkspaces`에 승격된다 → renderer 입력으로 온 workspace 목록은 권한 grant로 사용하지 말고, `folder:pick` 성공 경로만 main process 전용 저장소에 기록하거나 settings 저장 시 해당 필드를 무시해야 한다.
- [main.js:345] `fs.mkdirSync(agentsDir, { recursive: true })`와 [main.js:350] `writeIfMissing(path.join(agentsDir, ...))`가 `agents`가 symlink/junction인 경우 외부 디렉터리를 따라간다 → `agents`, `logs`, `backlog` 및 중간 경로를 `lstatSync`/`realpathSync.native`로 검사해 symlink/junction이면 거부하고, 생성 후에도 realpath가 `projectRoot` 내부인지 재검증해야 한다.

## 4. Major 이슈
- [main.js:188] `persistRecentWorkspace`가 `loadSettings()`로 읽은 raw settings 객체를 [main.js:198]에 `recentWorkspaces`만 추가한 뒤 [main.js:199]에서 그대로 저장한다 → 이전 버전 또는 외부 편집으로 settings에 금지 필드가 남아 있으면 `folder:pick` 때 sanitize 없이 보존되므로 `saveSettings(validateSettings(settings))` 또는 main 전용 recent 저장 로직으로 분리해야 한다.

## 5. Minor 이슈
- [main.js:196] `persistRecentWorkspace`의 dedupe가 문자열 완전 일치만 사용한다 → Windows에서 같은 realpath의 case 차이 또는 separator 차이가 있으면 최근 목록 중복이 생길 수 있으므로 `normalizePath(real)` 기준으로 dedupe해야 한다.
- [main.js:161] `normalizePath`가 내부에서 다시 `path.resolve()`를 호출한다 → `safeRealpath()` 결과를 다시 lexical resolve하는 구조라 동작은 대체로 안전하지만 UNC/device path 테스트가 없으므로 helper 단위 테스트로 고정해야 한다.

## 6. Optional 제안
- [renderer.js:466] `api.showInOS(r.path)` 반환 boolean을 무시한다 → 보안 문제는 아니지만 거부/실패 시 사용자에게 열기 실패 상태를 표시하면 allowlist 차단을 오작동으로 오해할 가능성이 줄어든다.
- [main.js:703] `searchFiles`는 regex를 사용하지 않아 regex injection 위험은 없다 → `clipString(query, MAX_QUERY_LEN)` 후 빈 문자열이 되는 입력은 [main.js:704]에서 `[]`로 처리되므로 현재 동작을 회귀 테스트로만 고정하면 된다.

## 7. 최종 권고
- 다음 행동 체크리스트: renderer가 저장 가능한 `defaultProjectPath`/`recentWorkspaces`를 workspace 권한 grant로 사용하지 않도록 분리.
- 다음 행동 체크리스트: `ensureAiopsProjectStructure`의 `agents`, `logs`, `backlog`, `CLAUDE.md` 쓰기 전에 symlink/junction 및 realpath 내부성 검사 추가.
- 다음 행동 체크리스트: `persistRecentWorkspace` 저장 경로도 `validateSettings` 또는 별도 schema를 통과하게 수정.
- 테스트 추가 필요 지점: `settings:set({ recentWorkspaces: ['C:\\Windows'] })` 후 재시작 시 `folder:tree/search/open-in-os/aiops:setup`이 허용되지 않는지 검증.
- 테스트 추가 필요 지점: `<workspace>/agents` 또는 `<workspace>/logs`가 workspace 밖 symlink/junction일 때 `aiops:setup`이 파일을 쓰지 않고 실패하는지 검증.
- 테스트 추가 필요 지점: `..`, UNC, `\\?\\`, `\\.\`, 8.3 short name, case-only POSIX 경로가 `isPathInsideAllowedWorkspace()`를 우회하지 못하는지 helper 테스트 추가.