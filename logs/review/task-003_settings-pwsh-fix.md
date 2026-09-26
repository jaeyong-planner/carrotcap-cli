# Review Report — main.js task-003 follow-up

## 1. 리뷰 대상
- 파일/모듈 목록: `main.js`
- 변경 라인 수: diff 미제공 및 현재 작업 디렉터리에 `.git` metadata 없음으로 정확 산출 불가; `main.js` 전체를 fresh read 기준으로 검토
- 리뷰 시점: 2026-05-06T02:43:00Z

## 2. 전체 판단
- ⚠️ 조건부 승인
- 대상 3건 판단: Critical #2 PARTIAL, Critical #3 RESOLVED, Major M1 RESOLVED — `settings:set` whitelist 적용과 shell quoting/absolute launcher 전환은 대체로 완료됐으나, `cli` key whitelist가 `constructor` reserved key를 아직 허용한다.

## 3. Critical 이슈
- 없음

## 4. Major 이슈
- 없음

## 5. Minor 이슈
- [main.js:78] `CLI_KEY_RE`가 `constructor`를 유효한 CLI key로 허용하고, [main.js:87]에서 `cli[key] = ...`로 그대로 저장한다. 현재 코드 경로에서 즉시 prototype pollution으로 이어지지는 않지만, task-003 검증 항목 A의 “prototype-poisoning keys (`__proto__`, `constructor`)” 차단 요구를 완전히 만족하지 않는다. → `key === '__proto__' || key === 'prototype' || key === 'constructor'`를 명시적으로 거부하도록 권고한다.

## 6. Optional 제안
- [main.js:41] `getSystem32Path()`가 `process.env.SystemRoot`를 신뢰한다. 일반 Windows 실행 환경에서는 `C:\Windows\System32`로 해석되어 Major M1은 해결되지만, 비정상 실행 환경에서 `SystemRoot`가 상대 경로로 주입되면 helper 이름과 달리 absolute path 보장이 약해진다. → `path.isAbsolute(root)` 검증 후 실패 시 `'C:\\Windows'` fallback을 사용하면 방어 의도가 더 명확해진다.

## 7. 최종 권고
- 다음 행동 체크리스트:
  - [main.js:78] `constructor`, `prototype`, `__proto__` reserved key 거부 로직 추가
  - [main.js:669] `settings:set` write path가 `validateSettings(next)`를 `saveSettings()` 전에 호출하는 현재 순서 유지
  - [main.js:512] Windows cli mode의 `& 'cmd' 'arg1'` PowerShell single-quote 방식 유지
  - [main.js:163], [main.js:164], [main.js:479], [main.js:514], [main.js:526] `reg.exe` / `powershell.exe` PATH lookup 재도입 금지
- 테스트 추가 필요 지점:
  - `validateSettings({ cli: { constructor: { command: 'claude', args: [] } } })`가 저장 결과에서 제거되는지
  - `cli.command`에 whitespace, `;`, `&`, backtick, `$()`가 포함될 때 거부되는지
  - `cli.args = ["--print", "hello world", "a'b", "`$x", "& whoami"]`가 PowerShell/POSIX quoting 후 단일 인자로 유지되는지
  - `settings:set` 호출 결과가 unknown top-level keys와 oversized arrays/strings를 저장하지 않는지