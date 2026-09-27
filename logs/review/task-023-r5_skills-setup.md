# Review Report — task-023-r5 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 1,437 additions / 5 deletions
- 리뷰 시점: 2026-09-27T07:37:16Z
- 근거: `backlog/task-023.md`, `logs/review/task-023-r4_skills-setup.md`, `git diff feature/v0.2.0..HEAD`, `git show HEAD`

## 2. 전체 판단

- ❌ 반려
- project 경계 밖 파일을 덮어쓸 수 있는 TOCTOU 복구 경로가 남아 있어 즉시 수정이 필요합니다.

## 3. Critical 이슈

- [main-skills.js:452-468] `assertAncestorsClean()` 및 기존 파일 검증 후 `writeFileSync()` 사이에 `CLAUDE.md` 또는 `.carrotcap/skills.json`을 symlink/junction으로 교체하면 외부 대상에 쓰기가 발생합니다. 더구나 escape 감지 뒤 `before`를 같은 경로에 다시 `writeFileSync()` 하므로, 교체된 외부 링크 대상까지 프로젝트 파일의 이전 내용으로 덮어써 데이터 손실을 일으킬 수 있습니다. → escape 감지 후 링크를 따라 복구 쓰기를 절대 수행하지 말고, 파일/상위 디렉터리를 재검증한 안전한 atomic replace 방식으로 바꾸거나 해당 보장을 할 수 없으면 쓰기를 fail-closed 처리하세요. symlink/junction 교체 레이스에서 외부 파일이 변경되지 않는 테스트를 추가하세요. r4의 link/junction write-escape 이슈는 **UNRESOLVED**입니다.

## 4. Major 이슈

- [main-skills.js:359-392] 원격 GitHub tree에서 `type: "blob"`만 필터링하고 Git mode `120000`인 symlink blob을 거부하지 않습니다. 원격 symlink는 일반 텍스트처럼 검사·표시되지만 실제 설치 시에는 링크로 복원될 수 있어, hook 또는 prompt가 외부 파일을 참조하게 만들 수 있습니다. → tree entry의 `mode === "120000"` 및 `type === "commit"`을 검사해 symlink/submodule이 하나라도 있으면 설치 전 거부하세요. 원격 symlink fixture와 설치 거부 E2E를 추가하세요.

- [main-skills.js:494-500, main-skills.js:525-550] `superpowers`의 확인 SHA는 main-process 메모리와 설치 직전 로컬 marketplace metadata만 비교합니다. 실제 `claude plugin install superpowers@claude-plugins-official`에는 검사한 SHA가 전달되지 않고 설치 결과도 SHA/파일 hash로 검증하지 않습니다. 따라서 Claude CLI가 marketplace를 갱신하거나 다른 source ref를 해석하면, 사용자가 검토한 내용과 다른 콘텐츠가 설치될 수 있습니다. → install 명령이 검사한 immutable ref만 사용하도록 강제하고, 설치 후 실제 source SHA 또는 설치 파일 hash를 검사 결과와 대조한 뒤 불일치 시 실패 처리하세요.

- [main-skills.js:241-325, main-skills.js:383-392, renderer-skills.js:123-160] r4의 “extensionless executable 및 package lifecycle 미검사” Major는 **RESOLVED**입니다. media를 제외한 텍스트 파일, NUL binary, extensionless/shebang 파일 및 lifecycle script를 fail-closed로 처리합니다.

- [main-skills.js:237-392, renderer-skills.js:123-160] r4에 기록된 r3 원격 플러그인 본문 확인 Major는 **RESOLVED**입니다. 고정 SHA 기반 본문 검사, 위험 줄 표시, hook 실행 파일 본문 표시 및 검사 실패 시 차단이 구현되었습니다.

## 5. Minor 이슈

- [scripts/test-skills.js:164-182, scripts/test-electron-skills.js:191-215] 테스트는 extensionless 파일·lifecycle script·검사 후 marketplace metadata 변경은 검증하지만, 원격 symlink/submodule 거부와 실제 설치 결과가 확인 SHA와 일치하는지는 검증하지 않습니다. 현재 fake `.cmd`는 받은 argv만 기록하므로 Claude CLI의 marketplace refresh/설치 source 동작을 증명하지 못합니다. → Major 수정과 함께 symlink/submodule fixture, 설치 후 immutable source 검증 실패 fixture를 추가하세요.

- [scripts/test-skills.js:185-199, scripts/test-electron-skills.js:158-172] r4의 timeout/process-tree 종료·동시 설치·BrowserView 전이 테스트 부족 Minor는 **RESOLVED**입니다.

- [scripts/test-skills.js:118-182, scripts/test-electron-skills.js:191-215] r4의 원격 본문 검사 및 성공 흐름 E2E 부족 Minor는 **RESOLVED**입니다.

## 6. Optional 제안

- [main-skills.js:411-417, main-skills.js:474-479, main.js:102-110, main.js:1822-1832] r4의 설정 기반 executable 신뢰 가정은 **UNRESOLVED**입니다. renderer와 프로젝트 폴더는 executable을 주입하지 못하지만, 사용자가 수정한 absolute `cli.claude.command`가 `.cmd`이고 `%VAR%`를 포함하면 `shell: true`의 `cmd.exe` 환경변수 확장을 거쳐 의도와 다른 명령 해석이 발생할 수 있습니다. → resolved executable을 설치 확인 화면에 표시하고, `.cmd/.bat` 경로의 `%` 등 cmd metacharacter를 거부하거나 안전한 cmd escaping을 적용하세요.

## 7. 최종 권고

- [ ] `writeInside()`의 TOCTOU escape 복구가 외부 파일을 덮어쓰지 않도록 수정한다.
- [ ] 원격 plugin tree의 symlink(`120000`)와 submodule을 fail-closed 처리한다.
- [ ] 설치 대상이 사용자가 검사한 immutable SHA와 동일함을 install 후 검증한다.
- [ ] symlink/junction 교체 레이스, remote symlink/submodule, source SHA 불일치 테스트를 추가한다.
- [ ] 수정 후 `npm test` 및 `npm run test:skills`를 실행한다.