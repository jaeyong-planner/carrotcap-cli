# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main.js`, `main-winpath.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `backlog/task-027.md`
- 변경 라인 수: +241 / -6
- 리뷰 시점: 2026-09-27T22:57:04Z
- 정적 diff 검토 수행

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- PowerShell 읽기 실패 시 5초 캐시가 작동하지 않아 새 터미널마다 최대 4.5초 지연될 수 있고, `findCommandSync`는 새 등록 PATH를 직접 갱신하지 못합니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main-winpath.js:68] 실패한 읽기는 `at`을 갱신하지 않습니다. 초기 읽기 실패 시 `cache`가 `null`이므로 이후 모든 `get()`이 PowerShell을 다시 실행하고, 마지막 성공 캐시가 있어도 만료 뒤 실패하면 매 호출마다 재시도합니다. `pty:spawn`은 이 호출을 최대 4.5초 기다리므로 PowerShell 정책 차단·실행 파일 누락·손상된 출력 환경에서 새 pane마다 지연됩니다. → 성공 시각과 별도로 `lastAttemptAt`을 읽기 시작 시 갱신하고, 성공·실패 모두 `REFRESH_MS` 동안 재시도를 억제하십시오. 마지막 성공 값은 그대로 fallback으로 사용하십시오.

- [main.js:1971] `findCommandSync()`는 `registeredPathEnv()`의 기존 cache만 사용하며 `registeredPath.get()`을 실행하거나 기다릴 수 없습니다. [main-skills.js:661]의 `claudeCommand()`가 이를 통해 SKILLS 설치를 시작하므로, 앱 시작 뒤 CLI를 설치했거나 5초 cache가 만료된 경우 새 PATH에 있는 `claude`를 찾지 못할 수 있습니다. → `findCommand` 경로를 async로 전환하고 `skills:add-marketplace` 및 `skills:install`에서 `await registeredPathReady()` 후 조회하거나, 동등하게 해당 진입점에서 refresh를 보장하십시오.

## 5. Minor 이슈

- [main.js:39] `Promise.race()`의 4.5초 `setTimeout`은 `registeredPath.get()`이 즉시 성공해도 취소되지 않습니다. pane 생성과 `cli:status` 호출마다 live timer가 남아 짧은 시간 동안 불필요한 timer가 누적됩니다. → timeout handle을 보관하고 registry Promise가 먼저 settle되면 `clearTimeout()` 하십시오.

- [main-winpath.js:20] `keyOf()`는 `C:\`와 `C:`를 동일한 key인 `c:`로 만듭니다. Windows에서 `C:`는 현재 drive directory를 뜻할 수 있어 `C:\`와 완전히 동등하지 않습니다. → drive root의 마지막 backslash는 보존하거나, root path를 별도로 판별하여 dedupe하십시오.

- [scripts/test-electron-smoke.js:384] smoke test는 새 terminal에서만 probe command 실행을 검증합니다. `cli:status`, `whichCommand`, 그리고 SKILLS의 `findCommandSync` 경로가 새 등록 PATH를 찾는지는 검증하지 않습니다. → probe 등록 후 `cli:status`가 probe CLI를 `true`로 반환하는 E2E와 SKILLS의 `claude` 검색 경로 검증을 추가하십시오.

- [scripts/test-winpath.js:53] 실패 fallback test는 마지막 성공 값을 유지하는지만 확인하고, 실패 후 5초 안에 재호출해도 PowerShell 실행 횟수가 증가하지 않는지는 확인하지 않습니다. → 실패한 초기 읽기와 stale cache 읽기 각각에서 연속 `get()` 호출이 한 번의 실행만 만드는 test를 추가하십시오.

## 6. Optional 제안

- [scripts/test-winpath.js:67] 실제 레지스트리 test가 User PATH 비어 있음 또는 Machine PATH에 `System32`가 없는 최소화된 Windows 환경에서 실패할 수 있습니다. → “읽기 성공 및 문자열 타입”을 검증하고 특정 로컬 PATH 내용은 optional diagnostic으로 분리하십시오.

## 7. 최종 권고

- [ ] 실패한 registry read에도 5초 재시도 제한을 적용한다.
- [ ] `findCommandSync`를 사용하는 SKILLS 흐름이 최신 registered PATH를 refresh한 뒤 조회하도록 수정한다.
- [ ] `registeredPathReady()` timeout timer를 정리한다.
- [ ] 실패 throttle, 새 PATH의 `cli:status`, SKILLS CLI 발견 E2E를 추가한다.
- [ ] Windows에서 PowerShell 실행 불가 상태와 앱 실행 후 CLI 설치 상태를 각각 검증한다.