# Review Report — task-023-r6 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 1,614 additions / 5 deletions
- 리뷰 시점: 2026-09-27T07:44:17Z

## 2. 전체 판단

- ❌ 반려
- 프로젝트 경계 밖에 임시 파일을 쓸 수 있는 TOCTOU가 남아 있고, 설치본 대조가 모든 검사 대상 파일과 로컬 플러그인에 적용되지 않습니다.

## 3. Critical 이슈

- [main-skills.js:405] `assertAncestorsClean()`과 `safeRealpath(dir)` 검사 뒤 [main-skills.js:409] 임시 파일 생성 전까지 `.carrotcap` 디렉터리를 junction/symlink로 교체할 수 있습니다. 이 경우 `fs.writeFileSync(tmp, ...)`가 프로젝트 외부에 임시 파일을 생성하며, 경계 검사는 이미 쓰기가 끝난 [main-skills.js:411]에 수행됩니다. → 검증된 디렉터리에 바인딩된 no-follow 쓰기 방식으로 바꾸거나, 그 보장이 불가능하면 해당 경쟁 조건에서 fail-closed 하도록 설계를 변경하세요. 임시 파일 생성 직전 디렉터리 교체 테스트에서 외부 디렉터리에 파일이 전혀 생기지 않음을 검증해야 합니다. r5 Critical TOCTOU 이슈는 **PARTIAL**입니다.
- [main-skills.js:624] `CLAUDE.md`를 `fs.readFileSync()`으로 먼저 읽고 [main-skills.js:625]에 다시 검사·교체합니다. 두 동작 사이에 외부 파일을 가리키는 link가 삽입됐다가 일반 파일로 되돌아오면 외부 내용이 프로젝트 `CLAUDE.md`에 병합되어 유출될 수 있습니다. → 병합 입력을 읽기 전후 동일한 plain-file identity인지 확인하고, 안정성을 보장할 수 없으면 규칙 쓰기를 중단하세요.

## 4. Major 이슈

- [main-skills.js:380] `digest.media`는 파일 경로만 보관하며 [main-skills.js:389]에서 존재 여부만 검사합니다. 이미지·글꼴·PDF 등 검사 당시 표시된 파일이 설치 후 다른 내용으로 바뀌어도 검증을 통과합니다. 백로그의 “내용 hash, 추가·누락 파일 모두 실패” 요구를 충족하지 못합니다. → media도 raw-byte hash를 기록·비교하세요. r5의 설치본 대조 Major는 **PARTIAL**입니다.
- [main-skills.js:539] 로컬 공식 marketplace 플러그인은 내용을 표시하지만 digest를 보존하지 않으며, [main-skills.js:604] 설치 후 검증은 `remoteInspected`가 있는 외부 플러그인에만 실행됩니다. 창에서 확인한 `code-review` 등 로컬 플러그인이 설치 직전에 변경되거나 CLI가 다른 marketplace revision을 해석해도 사용자에게 보인 내용과의 일치가 검증되지 않습니다. → 로컬 항목도 검사 시 commit/file digest를 보관하고 설치 후 `verifyInstalledCopy()`와 동등한 검증을 수행하세요.
- [main-skills.js:431] remote tree의 symlink(`120000`) 및 submodule(`commit`)을 설치 전 거부합니다. → r5 remote link/submodule Major는 **RESOLVED**입니다.

## 5. Minor 이슈

- [scripts/test-skills.js:171] 설치본 검증 테스트는 media 파일의 누락만 확인하고 변경된 media 내용은 검증하지 않습니다. [scripts/test-electron-skills.js:208] E2E는 `superpowers` remote plugin만 설치본 대조합니다. → 변조된 media hash 거부, 로컬 Anthropic plugin의 검사 후 설치본 변경·추가·누락 거부 E2E를 추가하세요.
- [scripts/test-skills.js:215] 경쟁 조건 테스트는 [main-skills.js:413] `beforeRename` 시점의 교체만 재현합니다. 임시 파일 생성 전 디렉터리 교체 경로는 검증하지 않습니다. → `fs.writeFileSync()` 직전 junction 교체 fixture를 추가하고 외부 생성 파일이 없음을 확인하세요. r5 테스트 부족 Minor는 **PARTIAL**입니다.

## 6. Optional 제안

- [main-skills.js:481] Windows `.cmd/.bat` 실행은 `shell: true`이며 [main.js:105] 설정의 absolute command path가 허용됩니다. renderer·project folder가 command를 주입할 수는 없고 argv도 고정되어 있으나, `%VAR%` 등이 포함된 사용자 설정 경로는 `cmd.exe` 확장을 거칩니다. → `.cmd/.bat` absolute path의 `%` 및 cmd metacharacter를 거부하거나 cmd-safe escaping을 적용하세요. r5 executable 설정 Optional은 **UNRESOLVED**입니다.

## 7. 최종 권고

- [ ] 임시 파일 생성 전 directory swap으로도 프로젝트 외부에 쓰지 않도록 TOCTOU 경계를 수정한다.
- [ ] `CLAUDE.md` 병합 입력의 link-swap 정보 유출 경로를 차단한다.
- [ ] media를 포함한 모든 검사 파일의 raw-byte hash를 설치본과 대조한다.
- [ ] 로컬 공식 marketplace 플러그인에도 검사본-설치본 commit/content 검증을 적용한다.
- [ ] media 변조, 로컬 plugin source 변경, pre-write junction swap 테스트를 추가한다.
- [ ] 수정 후 `npm test` 및 `npm run test:skills`를 실행한다. 현재 리뷰 환경에서는 Temp directory 생성 권한이 없어 두 테스트가 `EPERM`으로 완료되지 않았습니다.