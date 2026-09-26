# Review Report — main.js + preload.js (task-002)

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`, `preload.js`
- 변경 라인 수: full file
- 리뷰 시점: 2026-05-06

## 2. 전체 판단
- ❌ 반려
- Electron 27 환경에서 `sandbox: false`와 검증 없는 IPC bridge가 결합되어 renderer compromise 시 main process 권한으로 파일 시스템 접근, 임의 command 실행 경로, PTY 조작이 가능하다.

## 3. Critical 이슈
- [main.js:549] `sandbox: false`가 설정되어 있지만 해당 예외가 왜 필요한지 코드상 근거가 없고, Electron 27.3.11의 오래된 runtime에서 renderer process OS sandbox가 비활성화된다 -> `sandbox: true` 전환 가능성을 먼저 검증하고, 불가능하면 preload 의존성/제약 사유와 residual risk를 명시하며 IPC allowlist를 강화해야 한다.
- [main.js:564] `settings:set`이 key whitelist/schema 없이 renderer가 보낸 객체 전체를 `settings.json`에 저장한다 -> `aor.engineRoot`, `aor.engineRootCandidates`, `cli.*.command`, `cli.*.args`, `defaultProjectPath`, `ui.*` 등 허용 key와 타입/길이/경로 정책을 명시적으로 검증해야 한다.
- [main.js:416] `settings.cli[cliKey]`의 `command`와 `args`를 문자열 join 후 PowerShell `-Command`로 전달한다 -> `settings:set`으로 값이 오염되면 command injection이 가능하므로 shell string 조립을 제거하거나 CLI allowlist와 argument escaping/structured spawn 정책을 적용해야 한다.
- [main.js:579] `folder:tree`가 renderer 제공 `rootPath`를 그대로 재귀 탐색하고 결과에 절대 경로를 포함한다 -> 사용자가 선택한 workspace/root allowlist 내부인지 `realpath` 기준으로 검증하고, 임의 시스템 경로 열람을 차단해야 한다.
- [main.js:580] `folder:search`가 renderer 제공 `rootPath`와 `query`를 검증하지 않아 임의 디렉터리 검색 및 경로 노출이 가능하다 -> `folder:tree`와 동일한 root constraint, query 타입/길이 제한, symlink 처리 정책을 추가해야 한다.
- [main.js:581] `shell.showItemInFolder(p)`가 renderer 제공 경로를 그대로 OS shell에 넘긴다 -> 선택된 workspace 내부 파일인지 `realpath`로 확인하고, 존재 여부/타입을 검증한 뒤 호출해야 한다.
- [main.js:592] `pty:spawn`이 renderer 제공 payload의 `cwd`, `mode`, `cliKey`, `cols`, `rows`를 구조 검증 없이 사용한다 -> `cwd`는 허용 root 내부로 제한하고, `mode/cliKey` allowlist 및 `cols/rows` 범위 검증을 추가해야 한다.
- [main.js:593] `pty:write`가 renderer 제공 `data`를 크기/encoding 제한 없이 활성 PTY에 전달한다 -> 최대 payload 크기, 문자열 타입, 제어 시퀀스 정책, session ownership 검증을 추가해야 한다.
- [main.js:583] `aiops:setup`이 renderer 제공 `projectRoot` 아래에 `agents/`, `logs/`, `backlog/`, `CLAUDE.md`를 생성/수정할 수 있다 -> dialog로 선택된 프로젝트 또는 명시적으로 저장된 workspace 내부로 제한해야 하며, 임의 경로 쓰기 primitive가 되지 않게 해야 한다.

## 4. Major 이슈
- [main.js:78] `execFileSync('reg', ...)`가 절대 경로가 아닌 실행 파일 이름으로 호출되어 process `PATH`/검색 순서 오염 시 다른 `reg` 실행 파일이 선택될 수 있다 -> `%SystemRoot%\System32\reg.exe` 같은 절대 경로를 사용하고 환경 변수도 최소화해야 한다.
- [main.js:87] HKCU `Environment\Path`에 쓰는 `next`가 기존 registry 값 전체와 `installDir`를 합친 값인데, 기존 값의 길이/제어문자/비정상 항목 검증이 없다 -> 기존 Path를 보존하더라도 항목 단위 검증, 최대 길이 확인, 실패 시 명시적 오류 처리를 추가해야 한다.
- [main.js:91] `execFileSync('powershell.exe', ...)`도 절대 경로가 아니어서 실행 파일 경로가 오염될 수 있다 -> `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` 또는 검증된 절대 경로를 사용해야 한다.
- [main.js:357] `resolvePtyArgs`가 `opts.cwd && fs.existsSync(opts.cwd)`만 확인해 파일 경로도 cwd 후보가 될 수 있고 허용 root 검증이 없다 -> directory 여부와 `realpath` 기반 allowlist 검증을 추가해야 한다.
- [main.js:365] `aiops` 모드에서 `requestedProjectRoot`가 검증 없이 `ensureAiopsProjectStructure`로 전달되어 임의 위치에 프로젝트 구조를 생성할 수 있다 -> 선택된 project root 내부인지 확인하고 symlink 우회도 차단해야 한다.
- [main.js:569] `aor:set-claude-md`의 대상 경로는 `APP_ROOT/CLAUDE.md`로 고정되어 path traversal은 없지만, `content` 타입/크기 제한이 없어 renderer가 대용량 데이터 또는 비문자열 값을 전달할 수 있다 -> 문자열 타입과 최대 크기를 검증하고 write 실패를 structured error로 반환해야 한다.
- [main.js:602] `pty:resize`가 `cols`/`rows` 타입과 범위를 검증하지 않아 비정상 값이 native PTY resize 경로로 전달된다 -> 정수 범위 예: `1..500` 검증 후 호출해야 한다.
- [main.js:608] `pty:kill`이 session id만 알면 어떤 PTY든 종료할 수 있다 -> renderer frame/session ownership 또는 nonce 기반 capability를 둬야 한다.
- [preload.js:26] `onPtyData`가 `handler` 타입을 검증하지 않고 이벤트 payload 전체를 그대로 전달한다 -> function 타입 확인과 payload shape 검증을 추가해 renderer-side type confusion을 줄여야 한다.

## 5. Minor 이슈
- [main.js:102] `loadSettings`가 파일 읽기/JSON parse 오류를 모두 `null`로 삼켜 손상된 설정과 파일 부재를 구분하지 못한다 -> parse 실패와 파일 없음은 구분해 로그/복구 UX를 제공해야 한다.
- [main.js:495] `buildFolderTree`의 `readdirSync` 실패가 silent return 처리되어 권한 오류, symlink 문제, 너무 긴 경로를 UI와 로그에서 구분할 수 없다 -> 최소한 debug/warn 또는 결과 내 error marker를 반환해야 한다.
- [main.js:520] `searchFiles`의 `readdirSync` 실패도 silent return 처리되어 검색 누락 원인을 알 수 없다 -> 권한 오류와 접근 불가 디렉터리를 관측 가능하게 해야 한다.
- [main.js:605] `pty:resize` 실패를 빈 `catch {}`로 삼켜 native PTY 오류를 추적할 수 없다 -> session id와 검증된 크기를 포함한 warn 로그를 남겨야 한다.
- [main.js:610] `pty:kill` 실패를 빈 `catch {}`로 삼켜 종료 실패 후에도 `sessions.delete(id)`가 실행될 수 있다 -> kill 실패 시 session 상태를 유지하거나 실패 상태를 반환해야 한다.
- [preload.js:7] `setSettings`가 renderer 입력을 그대로 IPC로 전달하며 preload 계층에서 기본 타입 방어가 없다 -> main validation이 필수지만, preload에서도 API별 최소 타입 guard를 두면 오용을 줄일 수 있다.
- [preload.js:22] `writePty`가 `id`/`data` 타입 제한 없이 전송한다 -> preload API boundary에서 문자열 id와 제한된 크기의 문자열 data만 허용해야 한다.

## 6. Optional 제안
- [main.js:46] `execFileSync`를 함수 내부에서 require하고 있어 테스트 시 mocking과 정적 분석이 어렵다 -> dependency boundary를 분리하면 registry self-heal 로직의 단위 테스트가 쉬워진다.
- [main.js:488] `buildFolderTree(rootPath, maxDepth = 4)`의 depth/skip list가 고정되어 있다 -> 보안 검증과 별개로 설정 가능한 workspace policy로 분리하면 테스트와 유지보수가 쉬워진다.
- [main.js:513] `searchFiles(rootPath, query, limit = 200)`의 `limit`과 depth가 호출부에서 고정되어 있다 -> 성능 테스트 기준을 명확히 하기 위해 상수화하는 것이 좋다.
- [preload.js:4] 노출 API가 14개 이상으로 늘었지만 channel별 risk level 구분이 없다 -> 파일 시스템/PTY/settings처럼 위험도가 높은 API를 별도 namespace로 나누면 감사가 쉬워진다.

## 7. 최종 권고
- 다음 행동 체크리스트: `sandbox: true` 가능성 검증, 불가 시 사유 문서화 및 residual risk 명시.
- 다음 행동 체크리스트: 모든 IPC handler에 schema validation 추가: 타입, 길이, enum, 숫자 범위, path `realpath` 검증.
- 다음 행동 체크리스트: `settings:set`은 whitelist 기반 partial update로 바꾸고 `cli.*`와 `aor.*`는 별도 권한/확인 절차를 둔다.
- 다음 행동 체크리스트: `folder:*`, `aiops:setup`, `pty:spawn.cwd`, `shell.showItemInFolder`는 dialog로 선택된 workspace 내부만 허용한다.
- 다음 행동 체크리스트: `reg.exe`와 `powershell.exe` 호출은 절대 경로로 고정하고 registry Path 값은 항목 단위로 검증한다.
- 테스트 추가 필요 지점: 악성 `settings:set` payload로 `cli.command/args`, `aor.engineRoot`, `defaultProjectPath`가 거부되는지 확인.
- 테스트 추가 필요 지점: `folder:tree/search/open-in-os`에 `C:\`, `..\`, symlink, 존재하지 않는 경로, 파일 경로를 넣었을 때 차단되는지 확인.
- 테스트 추가 필요 지점: `pty:spawn`에 비정상 `cwd`, `cols/rows`, `mode`, `cliKey`를 넣었을 때 spawn이 발생하지 않는지 확인.
- 테스트 추가 필요 지점: `pty:write`에 대용량 payload, non-string payload, 존재하지 않는 session id를 넣었을 때 제한/로그가 동작하는지 확인.
- 테스트 추가 필요 지점: 손상된 `settings.json`과 접근 불가 디렉터리에서 silent fail 대신 관측 가능한 오류가 남는지 확인.