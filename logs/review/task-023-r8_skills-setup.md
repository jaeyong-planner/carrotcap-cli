# Review Report — task-023-r8 / feature/task-023-skills-setup

## 1. 리뷰 대상

- 파일/모듈 목록: `main-skills.js`, `main.js`, `preload.js`, `renderer-skills.js`, `renderer.js`, `renderer-browser.js`, `index.html`, `styles.css`, `scripts/test-skills.js`, `scripts/test-electron-skills.js`, `package.json`
- 변경 라인 수: 11개 대상 파일, +1,813 / -5
- 리뷰 시점: 2026-09-27T07:59:56Z

## 2. 전체 판단

- ⚠️ 조건부 승인
- r7의 파일 경계·timeout·공급망 검증 이슈는 해소됐으나, renderer가 사용자 동의 없이 third-party 설치를 요청할 수 있는 IPC 권한 문제가 남아 있습니다.

## 3. Critical 이슈

- [main-skills.js:433-455] r7의 junction 교체 시 외부에 빈 temporary file이 잠시 생성될 수 있는 문제는 **RESOLVED (수용된 residual)** 입니다. 생성 직후 프로젝트 내부 여부와 열린 FD identity를 검증하고, 검증 전에는 내용이 쓰이지 않으며 `wx`로 기존 파일도 덮어쓰지 않습니다. 수용된 위협 모델상 프로젝트 쓰기 권한자가 추가 권한을 얻지 않습니다.
- [main-skills.js:461-481] r7의 `CLAUDE.md` read-swap 문제는 **RESOLVED** 입니다. open 전후 identity와 경로 상태를 비교하고, 변경되면 병합 내용을 반환하지 않습니다.

## 4. Major 이슈

- [preload.js:75, main-skills.js:656-665] `confirmThirdParty`는 renderer가 임의로 전달하는 boolean일 뿐, 실제 사용자 동의를 main process가 보장하지 않습니다. 신뢰된 main frame 여부만 확인하므로 renderer의 XSS·향후 UI 결함·DevTools 호출로 `skillsInstall(root, ['playwright'], true)`를 직접 실행할 수 있습니다. 이는 “사용자 선택 없이는 설치하지 않음” 요구와 IPC 안전성 경계를 위반합니다. → `skills:install`에서 main process의 native confirmation dialog를 표시하고, 선택된 third-party 항목·출처·실행 경고를 사용자가 명시적으로 승인한 경우에만 CLI를 실행하세요. **UNRESOLVED**
- [main-skills.js:186-194, 667-673] r7의 malformed third-party source 허용 문제는 **RESOLVED** 입니다. `./` 하위 경로와 marketplace 내부 realpath만 허용하며, 기타 source는 설치 전 거부됩니다.
- [main-skills.js:543-575] r7의 timeout 뒤 다음 설치가 겹칠 수 있는 문제는 **RESOLVED** 입니다. Windows는 `taskkill /T /F` callback 완료, POSIX는 process group 종료 Promise 완료 뒤에 runner가 resolve됩니다.
- [main-skills.js:410-450, 712-715] r7의 `CLAUDE.md` read-write 사이 사용자 편집 덮어쓰기 문제는 **RESOLVED** 입니다. inode/dev/size/mtime stamp가 다르면 rename 전에 중단하고 `rulesPending`으로 남깁니다.
- [main-skills.js:394-407] r7의 media raw-byte integrity 검증 문제는 **RESOLVED** 입니다.
- [main-skills.js:625-627, 693-701] r7의 local marketplace plugin 설치본 대조 누락 문제는 **RESOLVED** 입니다.
- [main-skills.js:495-498] r7의 remote symlink/submodule 검증 누락 문제는 **RESOLVED** 입니다.

## 5. Minor 이슈

- [scripts/test-skills.js:237-245] r7의 pre-create junction race 테스트 부족은 **RESOLVED (수용된 residual)** 입니다. 테스트는 외부에 content가 쓰이지 않고 최종 외부 파일이 남지 않는 것을 확인하며, 빈 temporary file 순간 생성 위험은 수용 범위입니다.
- [scripts/test-electron-skills.js:261-274] r7의 local plugin integrity E2E는 **PARTIAL** 입니다. text 변경과 extra file은 검증하지만, unit test에서만 다루는 media byte 변경 및 inspected file 누락은 실제 Electron 설치 흐름에서 검증하지 않습니다. → local plugin cache fixture에서 media 변조와 파일 삭제 각각이 uninstall 및 미기록으로 이어지는 E2E를 추가하세요.

## 6. Optional 제안

- [main.js:105-109, main-skills.js:559-564, 609-614] absolute `.cmd`/`.bat` 경로는 `statSync`로 literal path를 검증한 뒤 `cmd.exe` shell에서 실행됩니다. `%VAR%`가 포함된 파일명은 cmd variable expansion 후 검증 대상과 다른 executable을 가리킬 수 있습니다. renderer나 project folder가 settings를 수정할 수는 없으므로 권한 상승은 아니지만, settings content가 실행 대상을 바꾸는 경로입니다. → `.cmd/.bat` absolute path에서 `%`, `!`, `^`, `&`, `|`, `<`, `>`를 거부하거나 `.exe`만 허용하세요.

## 7. 최종 권고

- [ ] [preload.js:75, main-skills.js:656-665] third-party 설치 전 main process native confirmation을 추가한다.
- [ ] [scripts/test-electron-skills.js:261-274] local plugin media 변조·파일 누락 E2E를 추가한다.
- [ ] [main.js:105-109] `.cmd/.bat` 경로의 cmd expansion 문자를 차단한다.
- [ ] 수정 후 `npm test` 및 `npm run test:skills`를 실행한다.