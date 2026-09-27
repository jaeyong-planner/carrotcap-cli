# Review Report — task-023-r1 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`, `backlog/task-023.md`
- 변경 라인 수: 662줄 (660 additions, 2 deletions)
- 리뷰 시점: 2026-09-27T07:02:54Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- renderer 입력은 catalog ID로 제한되고 DOM은 `textContent`로 구성되어 XSS/Command Injection 방어는 양호하나, 패키징 누락·marketplace scope·공급망 검증·timeout 처리 문제가 남아 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [package.json:44] `build.files` allowlist에 `renderer-skills.js`가 없습니다. [index.html:184]가 해당 파일을 로드하므로 packaged app에서는 SKILLS UI가 초기화되지 않고, START는 스킬 설정을 건너뛰며 SKILLS 버튼은 `window.CarrotcapSkills` 호출 오류를 냅니다. → `renderer-skills.js`를 packaging 목록에 추가하고 packaged artifact 기반 E2E를 추가해야 합니다.

- [main-skills.js:181-187] marketplace가 없을 때 `claude plugin marketplace add`에 `--scope project`가 없습니다. 설치는 project scope이지만 marketplace 등록은 전역/사용자 범위로 남을 수 있어 “이 프로젝트에만”이라는 UI 안내와 backlog 설계를 위반합니다. → fallback argv에도 `--scope project`를 명시하고, marketplace가 없는 fake CLI E2E에서 scope를 검증해야 합니다.

- [main-skills.js:21-51] third-party 항목은 표시하지만, 설치 대상으로는 mutable marketplace ID만 전달합니다. [renderer-skills.js:52-57]도 source를 단순 텍스트로 보여 줄 뿐 SKILL.md, hook/셸 명령, 네트워크·삭제·키 접근 여부, immutable version/commit을 설치 전에 검토할 수 없습니다. 특히 `superpowers`와 `playwright`는 외부 제작이며 playwright는 `npx` 다운로드를 수행합니다. → 사용자 요청의 공급망 사전 확인 기준에 맞춰 immutable ref 및 권한/실행행위를 표시하고, 항목별 명시 동의를 받아야 합니다.

- [main-skills.js:137-150] Windows `.cmd/.bat` 실행 timeout에서 `child.kill()`은 shell wrapper만 종료할 수 있어 실제 `claude` 자식 프로세스가 계속 실행될 수 있습니다. `close` 후 `running`이 해제되면 후속 설치가 겹쳐 plugin state를 동시에 변경할 수 있습니다. → Windows에서는 process tree 종료를 보장하고 종료 완료 전에는 `running`을 유지해야 합니다.

## 5. Minor 이슈

- [main-skills.js:78-92] `buildSkillsBlock()`은 LF만 생성하고 `mergeSkillsBlock()`도 LF를 삽입합니다. 기존 `CLAUDE.md`가 CRLF일 때 혼합 줄바꿈이 생깁니다. [scripts/test-skills.js:34-35]는 block 개수만 검사해 CRLF 보존을 증명하지 못합니다. → 기존 파일의 EOL을 감지해 block도 동일 EOL로 생성하고 전체 EOL 보존을 테스트해야 합니다.

- [main-skills.js:201-206] `skills.json`을 먼저 기록한 뒤 `CLAUDE.md`를 씁니다. 후자에서 link/permission 오류가 나면 state는 “installed”로 남지만 규칙 block은 없으며, 다음 START는 설정 완료로 판단합니다. → 두 write를 임시 파일/rename 또는 rollback으로 일관되게 처리하고, `CLAUDE.md` write 실패 E2E를 추가해야 합니다.

- [main-skills.js:119-126] link·ancestor 검사는 있으나 검사와 `writeFileSync` 사이의 TOCTOU 및 기존 hard link file은 막지 못합니다. → project write 직전 재검증과 실패 시 state rollback을 수행하고, symlink/junction 및 기존 file-link 거부 테스트를 추가해야 합니다.

## 6. Optional 제안

- [main-skills.js:132-143] compromised renderer나 project folder는 executable을 바꾸지 못하지만, 직접 수정된 `settings.json`의 `cli.claude.command`는 임의의 절대 실행 파일 또는 PATH 명령을 실행할 수 있습니다. 현재 정책상 사용자가 직접 설정한 값은 신뢰한다는 전제가 필요합니다. → 설치 직전 resolved executable 경로를 UI에 표시하고 `claude` identity 검증 또는 재확인을 고려하세요.

- [scripts/test-electron-skills.js:54-106] START/부분 실패는 검증하지만 Escape, busy 상태 중 close 차단, BrowserView가 skills modal 동안 숨겨지는지, marketplace fallback, timeout/process-tree 종료는 검증하지 않습니다. → 해당 상태 전이를 E2E에 추가하세요.

## 7. 최종 권고

- `renderer-skills.js`를 packaged files에 포함하고 packaged build에서 SKILLS/START를 검증한다.
- marketplace fallback에 `--scope project`를 추가하고 fallback E2E를 만든다.
- third-party 설치 전 immutable source, 실행행위, 권한 정보를 제시하고 명시 동의를 받는다.
- timeout 시 자식 process tree 종료와 동시 실행 차단을 보장한다.
- CRLF, `CLAUDE.md`/state atomicity, symlink·junction·hard link 실패 복구 테스트를 추가한다.
- 참고: 이 리뷰 환경은 Temp directory 쓰기가 제한되어 `npm test` 및 `npm run test:skills`의 실행 완료 여부는 확인할 수 없었습니다.