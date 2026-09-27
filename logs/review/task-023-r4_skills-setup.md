# Review Report — task-023-r4 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 15개 파일, 1,536 additions / 5 deletions
- 리뷰 시점: 2026-09-27T07:30:40Z
- 근거: `backlog/task-023.md`, `logs/review/task-023-r3_skills-setup.md` 확인. 별도 AIOS KMS/WIKI 문서는 프로젝트 내에서 확인되지 않음.

## 2. 전체 판단

- ⚠️ 조건부 승인
- IPC·명령 인자·프로젝트 경로 검증과 r3의 원격 본문 검사 보완은 적절하나, third-party 콘텐츠 점검이 확장자 기반이라 실행 가능한 일부 파일과 package lifecycle을 확인 없이 통과시킬 수 있습니다.

## 3. Critical 이슈

- 없음

## 4. Major 이슈

- [main-skills.js:241-251, main-skills.js:290-307, main-skills.js:366-375, renderer-skills.js:123-160] third-party 공급망 검사 범위가 `SKILL.md`·일부 확장자 스크립트·`hooks/`로 제한됩니다. extensionless 실행 파일, `package.json`의 lifecycle script, 그 밖의 텍스트 실행 설정은 검사 대상에서 제외되지만 UI는 “본문 N개 확인”으로 표시합니다. 사용자는 네트워크·삭제·credential·프로그램 실행 위험이 없다고 오인한 채 설치할 수 있습니다. → third-party 설치 전 모든 regular text file을 명시적으로 분류하고, 미검사 실행 가능 파일·package manifest·확장자 없는 실행 파일은 내용을 표시하거나 fail-closed로 설치를 차단해야 합니다. 해당 fixture와 설치 차단 테스트를 추가하세요.

- [main-skills.js:237-313, main-skills.js:342-381, renderer-skills.js:123-160] r3 원격 플러그인 본문 확인 이슈 — **RESOLVED**. 고정 SHA의 `SKILL.md`·명령·에이전트 문서·확장자 스크립트와 hook 실행 파일을 읽고, 위험 줄·hook 본문·runtime download 경고를 표시하며 읽기 실패 시 설치를 거부합니다.

## 5. Minor 이슈

- [scripts/test-electron-skills.js:84, scripts/test-electron-skills.js:97-103, scripts/test-skills.js:105-152] 원격 플러그인의 성공 경로 E2E가 없습니다. 현재는 “구성 불러오기” 버튼 존재와 검사 전 main 거부만 확인하며, 실제로 구성 불러오기 → 결과 표시 → 동의 → 설치 argv 실행까지 이어지는 흐름을 검증하지 않습니다. → 고정 SHA fixture로 이 전체 흐름과 검사 결과가 설치 직전에도 유지되는지를 E2E로 추가하세요.

- [main-skills.js:434-452] r2 link/junction 및 write escape 이슈 — **RESOLVED**. 파일 타입·hard link·ancestor를 확인하고, write 뒤 realpath가 프로젝트 밖이면 새 파일 삭제 또는 기존 내용 복구를 수행합니다.

- [scripts/test-skills.js:169-183, scripts/test-electron-skills.js:153-178, renderer-browser.js:48-63] r2 timeout·동시 실행·BrowserView·원격 검사 테스트 부족 — **RESOLVED**. process-tree timeout, 동시 설치 거부, 허용 밖 폴더 거부, BrowserView 숨김 전이를 검증합니다.

- [scripts/test-skills.js:118-166] r3 본문 검사 테스트 부족 — **RESOLVED**. 원격 fixture의 network/delete/secrets/exec 탐지, 정확한 파일·라인, hook 본문 표시, unreadable/binary/missing/oversized 입력 거부를 검증합니다.

## 6. Optional 제안

- [main-skills.js:457-462, main-skills.js:396-400, main.js:102-110, main.js:1822-1832] r3 설정 기반 executable 신뢰 가정 — **UNRESOLVED**. renderer·프로젝트 폴더는 실행 파일을 제어하지 못하고 PATH 결과도 absolute path로 제한되지만, 사용자가 수정한 `settings.json`의 absolute `cli.claude.command`는 임의 실행 파일입니다. 또한 `.cmd` 실행은 `shell: true`여서 `%VAR%`가 포함된 경로는 `cmd.exe` 환경변수 확장의 영향을 받습니다. → 설치 확인 화면에 resolved executable 경로를 표시하고, Windows shell 경로의 `%` 확장 방지 여부를 검토하세요.

## 7. 최종 권고

- third-party 검사에서 extensionless executable file 및 `package.json` lifecycle을 확인하거나 fail-closed 처리한다.
- 원격 검사 성공 후 동의·설치까지의 E2E와 미검사 파일 차단 fixture를 추가한다.
- 수정 후 `npm test` 및 `npm run test:skills`를 실행한다.