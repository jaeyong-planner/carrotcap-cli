# Review Report — task-023-r2 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 950줄 (948 additions, 2 deletions)
- 리뷰 시점: 2026-09-27T07:11:47Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r1의 패키징·project scope·CRLF·hard link·부분 실패 복구·Windows process tree 처리 문제는 대부분 해소되었으나, 원격 third-party 플러그인의 실제 실행행위 사전 확인은 아직 보장되지 않습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [package.json:47] r1 패키징 누락 — **RESOLVED**. `renderer-skills.js`가 `build.files` allowlist에 포함되었습니다.

- [main-skills.js:106,287-293] r1 marketplace fallback scope 누락 — **RESOLVED**. fallback argv에 `--scope project`가 포함되고 E2E도 이를 검증합니다.

- [main-skills.js:137-141] 원격 source인 `superpowers`는 pinned commit과 repository만 표시한 뒤 즉시 반환하므로 SKILL.md, hook, MCP, shell command, 네트워크·파일·키 접근 행위를 수집·표시하지 않습니다. [renderer-skills.js:75-86,105-107]은 이 정보를 확인했다고 동의받지만, 실제로는 실행 명령이 없는 일반 문구만 보여 줍니다. r1 공급망 확인 이슈는 **PARTIAL**입니다. → remote plugin도 pinned commit의 manifest·hooks·MCP·SKILL.md를 설치 전에 검사해 표시하거나, 검사 불가 시 해당 항목의 설치를 차단하고 검증 가능한 외부 확인 절차를 제공해야 합니다.

- [main-skills.js:226-249] r1 Windows timeout/process tree 종료 이슈 — **RESOLVED**. `.cmd/.bat` 실행은 `taskkill /T /F`로 트리를 종료하며 `close` 이후에만 다음 명령으로 진행합니다.

## 5. Minor 이슈

- [main-skills.js:88-101] r1 CRLF 보존 이슈 — **RESOLVED**. 기존 파일의 EOL을 감지해 block을 변환하며 [scripts/test-skills.js:36-39]가 CRLF/LF를 검증합니다.

- [main-skills.js:305-315] r1 `skills.json`과 `CLAUDE.md` 상태 불일치 이슈 — **RESOLVED**. 규칙 쓰기를 먼저 수행하고 실패 시 `rulesPending`을 기록해 START가 다시 제안합니다.

- [main-skills.js:203-215] r1 link/hard link 이슈 — **PARTIAL**. 기존 symlink·hard link·비일반 파일은 거부하고 post-write root 검증도 수행합니다. 다만 `assertAncestorsClean()`과 `writeFileSync()` 사이의 TOCTOU 교체가 남아 있고, escape 감지 뒤 이미 생성·변경된 외부 파일을 복구하지 않습니다. → 안전한 디렉터리 handle 기반 쓰기가 불가하면 최소한 post-write escape 시 생성 파일 정리와 실패 상태 기록을 보장해야 합니다.

- [scripts/test-electron-skills.js:57-134] timeout 후 process tree 종료·동시 install 거부·BrowserView가 skills modal 동안 실제로 숨겨지는 상태 전이가 테스트되지 않습니다. [scripts/test-skills.js:65-67]도 remote plugin은 URL/commit만 검증합니다. → hang하는 fake `.cmd`, 동시 IPC 호출, BrowserView bounds, remote hook/MCP 검사 불가 경로를 E2E/unit 테스트에 추가해야 합니다.

## 6. Optional 제안

- [main-skills.js:220-225, main.js:102-110,1822-1832] r1 설정 기반 executable 신뢰 가정 — **UNRESOLVED**. renderer와 project folder는 catalog ID 또는 allowlisted workspace만 전달하므로 임의 실행 파일을 주입할 수 없지만, 사용자가 직접 변경한 `settings.json`의 absolute `cli.claude.command`는 임의 실행 파일을 지정할 수 있습니다. → 설치 직전 resolved executable 경로를 UI에 표시하고 사용자 재확인을 받는 방안을 검토하세요.

## 7. 최종 권고

- 원격 third-party 플러그인의 pinned source에서 실행행위와 권한 관련 파일을 설치 전에 표시하거나, 표시 불가 시 설치를 막는다.
- TOCTOU escape 감지 후 외부 파일 변경이 남지 않도록 실패 복구를 추가한다.
- timeout/process-tree, concurrent install, BrowserView hidden, remote source inspection 경로의 자동 테스트를 추가한다.
- 위 Major 항목 해소 후 승인합니다.