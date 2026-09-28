# Review Report — task-027 (Windows registered PATH)

## 1. 리뷰 대상

- `main.js`, `main-skills.js`, `main-winpath.js`, `package.json`
- `scripts/test-winpath.js`, `scripts/test-electron-smoke.js`, `backlog/task-027.md`
- 변경 라인 수: +277 / -6
- 리뷰 시점: 2026-09-27T23:04:37Z

## 2. 전체 판단

- ⚠️ 조건부 승인 / Changes requested
- PATH 병합·PowerShell 고정 명령·실패 throttle은 적절하나, 앱 실행 후 설치된 CLI가 UI에서 계속 “없음”으로 남을 수 있습니다.

## 3. Critical 이슈

- 없음.

## 4. Major 이슈

- [main.js:1894-1906] `cli:status`는 `registeredPathReady()`로 새 registry PATH를 읽은 뒤에도 기존 30초 `cliStatusCache`를 그대로 반환합니다. 또한 [renderer.js:83, 1268-1279]는 상태를 시작 시 한 번만 조회하므로, 시작 시 `false`였던 CLI는 설치·registry 갱신 뒤에도 Quick CLI 동작에서 계속 차단될 수 있습니다. → registered PATH snapshot 변경 시 `cliStatusCache`를 무효화하고, Quick CLI 실행 전 또는 PATH 갱신 후 `refreshCliStatus()`를 다시 호출해 renderer 상태도 갱신하십시오.

- [scripts/test-electron-smoke.js:389-405] smoke test는 새 pane 생성으로 registry PATH cache를 먼저 갱신한 뒤, `settings:set`으로 CLI status cache를 강제로 비웁니다. 따라서 `cli:status` 자체가 늦게 등록된 PATH를 감지·반영하지 못하는 위 결함을 검출하지 못합니다. → 새 terminal을 열거나 settings를 저장하지 않은 상태에서 tool 등록 후 `cli:status`와 Quick CLI 클릭 결과를 검증하는 E2E를 추가하십시오.

## 5. Minor 이슈

- [main-winpath.js:21-35] `keyOf('\\')`가 빈 문자열이 되어 `mergePath()`가 `\` PATH 항목을 제거합니다. `\`는 Windows에서 현재 drive의 root를 뜻하는 유효한 경로이므로 “앱 PATH 순서·동작 보존” 조건을 깨뜨릴 수 있습니다. → drive root 처리처럼 단일 backslash root도 별도 key로 보존하고, 이를 검증하는 unit test를 추가하십시오.

## 6. Optional 제안

- [main-winpath.js:61-65] 개발용 `CARROTCAP_TEST_REGISTRY_PATH`는 `readFileSync()`로 main process에서 읽습니다. production 경로에는 영향이 없지만, 네트워크 경로 등 부적절한 test path에서는 개발 smoke 실행이 멈출 수 있습니다. → test hook을 유지한다면 비동기 read 또는 test path의 로컬 일반 파일 검증을 적용하십시오.

## 7. 최종 권고

- [ ] registry PATH snapshot 변경과 `cliStatusCache`를 연동해 stale `false` 결과를 제거한다.
- [ ] renderer가 늦게 설치된 CLI 상태를 재조회하도록 한다.
- [ ] settings 저장·pane 생성 없이 late-installed CLI가 `cli:status` 및 Quick CLI에서 활성화되는 E2E를 추가한다.
- [ ] `\` root PATH 항목을 보존하도록 merge logic과 unit test를 보완한다.
- [ ] PowerShell 명령은 상수이며 `execFile`로 실행되고, production registry read는 비동기이므로 Command Injection 및 main-thread blocking 문제는 확인되지 않았다.