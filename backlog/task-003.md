# task-003 — settings 검증 + 셸 경로 고정 (Critical #2, #3 + Major M1)

## 상태
- 생성일: 2026-05-06
- PM: Claude Code
- 상위 입력: `logs/review/task-002_main-preload-security.md`
- 우선순위: P0 (Command injection 가능 경로)

## 목적
Codex 리뷰(task-002)에서 보고된 Critical 이슈 중 다음 3건을 안전하게 닫는다:

1. **Critical #2 (main.js:564)** — `settings:set`이 whitelist 없이 임의 객체 저장 → renderer 오염 시 임의 키 주입
2. **Critical #3 (main.js:416)** — `cli.command` + `cli.args` 문자열 join 후 PowerShell `-Command` 전달 → settings 오염 시 PowerShell command injection
3. **Major M1 (main.js:78, 87, 91)** — `reg.exe` / `powershell.exe`를 절대 경로 없이 호출 → PATH 오염 시 다른 실행 파일 선택 가능

## 비범위 (Out of Scope, 후속 task로 분리)
- Critical #1: `sandbox: false` 검토/활성화 → task-006
- Critical #4~#6: `folder:tree/search/open-in-os` 경로 검증 → task-004
- Critical #7~#8: `pty:spawn/write` payload 검증 → task-005
- Critical #9: `aiops:setup` 임의 경로 쓰기 → task-004
- Major M3, M4: pty:resize/kill 검증 → task-005

## 구현 설계

### A. Settings whitelist (Critical #2)
- `validateSettings(input)` 함수 추가 — 입력 객체를 새 객체로 화이트리스트 복제.
- 허용 키:
  - `aor.enabled` (boolean), `aor.engineRoot` (string ≤1024), `aor.engineRootCandidates` (array<string> ≤32항), `aor.autoStart` (boolean)
  - `cli.<key>.command` (key/command 모두 정규식 `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`), `cli.<key>.args` (array<string> ≤32, 각 ≤256)
  - `defaultShell` (string ≤256), `defaultProjectPath` (string ≤1024)
  - `ui.theme` (enum: dark|light|system), `ui.fontSize` (8..64 정수), `ui.fontFamily` (string ≤256)
- 알 수 없는 키/형식은 **조용히 폐기** (renderer가 임의 데이터를 settings.json에 박지 못하게)
- 저장은 `saveSettings(validateSettings(next))` 경로로만.

### B. PowerShell command 안전화 (Critical #3)
- `pwshSingleQuote(s)` helper: PowerShell 단일따옴표 escaping (`'` → `''`).
- `cli` 모드 PowerShell args를 다음처럼 재구성:
  ```
  -Command "& '<cmd>' '<arg1>' '<arg2>' ..."
  ```
- POSIX 측은 `posixShellQuote` 도입 (`'`로 감싸고 내부 `'`는 `'\''`).
- A의 whitelist 정규식이 1차 방어, escaping이 2차 defense in depth.

### C. 시스템 셸 절대 경로 (Major M1)
- `getSystem32Path()` — `process.env.SystemRoot || 'C:\\Windows'` 기반.
- `getRegExePath()` — `<System32>/reg.exe`.
- `getPowerShellExePath()` — `<System32>/WindowsPowerShell/v1.0/powershell.exe`.
- `ensureCliRegistration` 안의 두 `execFileSync` 호출을 절대 경로로 교체.
- `defaultShell()`도 동일 정책 적용 (Windows에서만, 비Windows는 그대로).

## 변경 파일
- `main.js` — 위 helper 추가 + 3개 호출부 수정

## 검증 기준
1. `settings:set`에 `__proto__`, `constructor`, 알 수 없는 최상위 키, `cli.command = "evil; rm -rf /"` 같은 페이로드 던졌을 때 폐기/거부.
2. `cli` 모드에서 `command = "claude"`, `args = ["--print", "hello'world"]` 같은 인자가 정상 실행되고 따옴표가 깨지지 않음.
3. `ensureCliRegistration`이 `reg.exe`/`powershell.exe`를 절대 경로로 호출.
4. 패킹 파일 목록(`build.files`)을 변경하지 않고 (새 파일 없이) main.js 인라인으로 처리.
5. Codex 리뷰 통과 — 동일 영역 Critical/Major 신규 이슈 없음.

## 다음 단계
- 구현 → Codex 재리뷰 → 리뷰 반영 → task-004로 진행
