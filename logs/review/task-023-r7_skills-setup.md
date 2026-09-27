# Review Report — task-023-r7 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 전체 범위 18개 파일, +2,076 / -5
- 리뷰 시점: 2026-09-27T07:53:54Z

## 2. 전체 판단

- ❌ 반려
- 프로젝트 밖 임시 파일 생성 TOCTOU가 완전히 해소되지 않았고, third-party marketplace source 검증 우회 및 timeout 종료 경쟁 조건이 남아 있습니다.

## 3. Critical 이슈

- [main-skills.js:422-430] `.carrotcap` 디렉터리가 `beforeCreate` 이후 junction으로 교체되면 [main-skills.js:424] `fs.openSync(tmp, 'wx')`가 프로젝트 외부에 빈 임시 파일을 실제 생성합니다. 이후 경계 검사와 [main-skills.js:439] 삭제가 수행되지만, 외부 쓰기 자체는 이미 발생합니다. → 검증된 디렉터리 handle에 바인딩된 no-follow 생성 방식으로 바꾸거나, 이를 보장할 수 없는 플랫폼에서는 해당 경로의 쓰기를 fail-closed 하세요. r6의 임시 파일 TOCTOU Critical은 **PARTIAL**입니다.
- [main-skills.js:445-465] `CLAUDE.md`는 열린 file descriptor의 identity와 현재 경로 identity를 비교한 뒤에만 읽으므로, link swap 내용을 병합하는 경로는 차단되었습니다. r6의 `CLAUDE.md` read-swap Critical은 **RESOLVED**입니다.

## 4. Major 이슈

- [main-skills.js:186-187, 642-647] third-party marketplace entry의 `source`가 object도 `./` 상대 경로도 아닌 문자열이면 `inspectPlugin()`은 `available: true` 상태로 반환하면서 `needsRemoteCheck`를 설정하지 않습니다. 따라서 `superpowers`/`playwright`의 marketplace metadata가 malformed 또는 변조된 경우, 검사 결과 없이 동의 및 설치가 가능합니다. → 허용하지 않는 source 형식은 `available: false`로 처리하고, third-party는 검사 가능한 고정 GitHub commit 또는 검증된 로컬 source 외에는 무조건 거부하세요.
- [main-skills.js:528-551] timeout 시 `taskkill`을 비동기로 시작만 하고 완료를 기다리지 않습니다. `child`의 `close`가 먼저 발생하면 다음 설치가 시작될 수 있어, 이전 CLI의 자식 프로세스가 아직 실행 중인 경쟁 조건이 있습니다. → `taskkill` 완료 callback/Promise를 await한 뒤 runner를 resolve하고, POSIX에서도 process group 종료를 적용하세요.
- [main-skills.js:687-688] `CLAUDE.md`를 안전하게 읽은 뒤 write 시점까지 파일 identity를 유지·검증하지 않아, 그 사이 사용자가 수정한 내용이 `mergeSkillsBlock()` 결과로 덮어써질 수 있습니다. → 읽은 파일의 identity를 반환해 rename 직전에 비교하고, 변경 시 재시도 또는 충돌 오류로 중단하세요.
- [main-skills.js:396-400, 510-517] media raw-byte hash를 기록하고 설치본과 비교합니다. r6의 media integrity Major는 **RESOLVED**입니다.
- [main-skills.js:593, 602, 669-676] 로컬 marketplace plugin도 창에 표시된 digest와 설치 cache를 대조하고 불일치 시 uninstall합니다. r6의 local plugin integrity Major는 **RESOLVED**입니다.
- [main-skills.js:478-480] remote tree의 symlink와 submodule을 설치 전 거부합니다. 이전 remote link/submodule Major는 **RESOLVED**입니다.

## 5. Minor 이슈

- [scripts/test-skills.js:240-246] pre-create junction 테스트는 외부 디렉터리의 최종 목록만 확인합니다. 실제 구현은 외부에 빈 temporary file을 생성 후 삭제하므로, “외부 파일이 한 번도 생성되지 않음”을 검증하지 못합니다. → `openSync` 직후를 관찰하는 fixture를 추가해 외부 생성 자체를 실패로 검증하세요. r6의 pre-write TOCTOU 테스트 Minor는 **PARTIAL**입니다.
- [scripts/test-electron-skills.js:259-269] local plugin E2E는 변경된 text file 한 경우만 다룹니다. local plugin의 media 변조·추가 파일·누락 파일 및 malformed third-party source 거부를 E2E로 확인하지 않습니다. → 해당 fixture와 uninstall 검증을 추가하세요. r6의 설치본 대조 테스트 Minor는 **PARTIAL**입니다.

## 6. Optional 제안

- [main-skills.js:539-542, main.js:105-110] Windows `.cmd/.bat`은 `shell: true`로 실행됩니다. renderer와 project folder는 실행 경로를 제어할 수 없고 argv는 고정이지만, absolute `cli.claude.command`의 `%VAR%`는 `cmd.exe` 확장 대상입니다. → `.cmd/.bat` 경로의 `%`, `!`, cmd metacharacter를 거부하거나 cmd-safe escaping을 적용하세요. 이전 executable 설정 Optional은 **UNRESOLVED**입니다.

## 7. 최종 권고

- [ ] 외부 directory junction 교체 시 빈 temporary file조차 생성하지 않는 쓰기 경계를 구현한다.
- [ ] third-party marketplace source 형식을 strict allowlist로 검증하고, 검사 불가능한 source는 설치 거부한다.
- [ ] timeout 후 `taskkill` 완료까지 await하여 다음 설치와 겹치지 않게 한다.
- [ ] `CLAUDE.md` read-write 사이의 concurrent update를 충돌 처리한다.
- [ ] pre-create junction, malformed source, timeout 직후 후속 설치, local plugin media/extra/missing file E2E를 추가한다.
- [ ] 수정 후 `npm test`와 `npm run test:skills`를 실행한다. 본 리뷰에서는 변경 JavaScript 파일의 `node --check`는 성공했습니다.