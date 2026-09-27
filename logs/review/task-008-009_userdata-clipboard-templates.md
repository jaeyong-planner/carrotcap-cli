# Review Report — task-008-009 (`aee5aaa`, `3b8b079`, `8554242`)

## 1. 리뷰 대상

- 파일/모듈 목록: `main.js`, `preload.js`, `renderer.js`, `package.json`, 테스트 스크립트, `templates/aiops/*`, 관련 backlog/문서
- 변경 라인 수: 659 additions, 154 deletions (task-008 이전 기준)
- 리뷰 시점: 2026-09-26T03:41:37Z

## 2. 전체 판단

- ❌ 반려
- 깨끗한 사용자 환경에서 `userData` 경로가 아직 없으면 `app.setPath()`가 초기화 전에 예외를 내어 앱이 시작하지 못하며, 손상된 기존 설정을 무조건 덮어써 데이터 손실이 발생한다.

- 이전 Major인 packaged `CLAUDE.md` 쓰기 경로 문제는 [main.js:32-39]의 userData 이전과 [main.js:416-418] 시딩으로 RESOLVED다.
- 이전 Minor 4건은 [main.js:1021], [main.js:1027-1028], [renderer.js:711-714], [scripts/test-electron-smoke.js:64-79]에서 RESOLVED다.
- 클립보드 IPC와 `term-menu:show`는 [main.js:928-933]의 trusted-sender/PTy-id wrapper를 통과하며, renderer가 clipboard를 읽는 것은 승인된 threat model 내에서 추가 정보 유출 경로가 없다.
- `attachClipboard`는 선택 없는 `Ctrl+C`에 `true`를 반환해 SIGINT를 유지하고, `Ctrl+Shift+V`/`Shift+Insert`는 이벤트를 차단한 뒤 `term.paste()`만 호출하므로 중복 paste가 발생하지 않는다. 전역 메뉴 리스너도 [renderer.js:489-499]에서 한 번만 등록된다.

## 3. Critical 이슈

- [main.js:32-34] 새 설치/새 사용자 환경에서는 `carrotcap-cli` 또는 `carrotcap-cli-dev` 하위 디렉터리가 존재하지 않는 상태로 `app.setPath('userData', ...)`를 먼저 호출한다. Electron의 `app.setPath`는 대상 디렉터리가 없으면 예외를 내므로, 바로 다음 줄의 `mkdirSync`와 `initUserState()`까지 도달하지 못하고 첫 실행이 크래시할 수 있다 → `app.getPath('appData')` 하위 대상 디렉터리를 먼저 생성한 뒤 `app.setPath()`를 호출하고, clean-profile Electron smoke test를 추가해야 한다.

- [main.js:410-415] `loadSettings()`가 JSON parse 실패·읽기 실패 시 `null`을 반환하고, 그 경우 기존 `settings.json` 존재 여부와 무관하게 기본 설정으로 덮어쓴다. 손상되었지만 복구 가능한 사용자 설정이 다음 실행 때 무경고로 유실된다 → 시딩 조건을 `!fs.existsSync(SETTINGS_PATH)`로 제한하고, 기존 파일이 파싱 불가하면 원본을 보존한 채 오류를 사용자에게 알리거나 timestamped backup을 만든 뒤 복구 절차를 제공해야 한다.

## 4. Major 이슈

- [main.js:585-603] `copyTemplateIfMissing()`의 `false` 반환을 무시한다. packaged build에서 `supervisor.md`, `task-001.md`, `workflow.md` 중 하나가 누락되거나 읽기 실패해도 [main.js:679]는 성공 결과를 반환하므로 renderer는 불완전한 AIOps 구조를 성공으로 표시한다 → 필수 템플릿 각각의 결과를 확인하고, 하나라도 배포하지 못하면 `{ ok: false }` 경로로 실패시켜야 한다.

- [main.js:573-634] 디렉터리 생성과 일부 템플릿 배포가 완료된 뒤에야 `CLAUDE-block.md` 누락을 확인하고 `null`을 반환한다. 재실행 자체는 누락 파일을 다시 시도하므로 영구적으로 막히지는 않지만, 호출자는 실패 원인을 구분할 수 없고 반쯤 생성된 상태를 성공과 혼동할 여지가 있다 → 모든 필수 템플릿의 가용성을 쓰기 전에 검증하거나, 배포 결과와 누락 파일명을 포함한 구조화된 실패 값을 반환해야 한다.

## 5. Minor 이슈

- [main.js:1036-1045] clipboard의 “1MB” 상한은 UTF-8 byte가 아닌 JavaScript UTF-16 code-unit `text.length`로 검증된다. emoji·한글 등 다중 byte 텍스트는 명시한 1MB보다 큰 데이터가 PTY로 전달될 수 있다 → `Buffer.byteLength(text, 'utf8')`로 read/write 모두 동일하게 제한하고 경계값 테스트를 추가해야 한다.

- [scripts/test-validate-settings.js:406-428] 템플릿 정상 배포·멱등성만 검증하며, 필수 템플릿 누락 시 실패 반환과 재실행 복구를 검증하지 않는다 → [main.js:585-634]의 실패 계약을 정한 뒤 missing-template 및 partial-state 재실행 테스트를 추가해야 한다.

## 6. Optional 제안

- [main.js:420-422] legacy `workspace-state.json` 저장 실패를 `saveWorkspaceState()`가 내부에서 삼킨 뒤에도 “migrated” 로그를 출력한다 → 저장 성공 여부를 반환해 실제 성공일 때만 migration 완료 로그를 남기면 운영 진단이 정확해진다.

## 7. 최종 권고

- [ ] [main.js:32] 이전에 userData 대상 디렉터리를 생성하고, 신규 OS 계정/삭제된 userData에서 앱이 시작되는 CDP smoke test를 추가한다.
- [ ] [main.js:412] 기존 설정 파일의 존재와 유효성을 구분해 손상된 사용자 설정을 덮어쓰지 않도록 수정하고 backup/오류 흐름을 검증한다.
- [ ] [main.js:585-634] 필수 템플릿 누락을 성공으로 반환하지 않도록 배포 결과를 집계하고, partial-state 재실행 시나리오를 테스트한다.
- [ ] [main.js:1036-1045] UTF-8 byte 기준 clipboard/PTY 1MB 제한을 적용하고 다중 byte 경계 테스트를 추가한다.
- [ ] writable 환경에서 `npm test`, `npm run test:smoke`, clean userData 프로필의 `npm run pack` 후 packaged 실행을 재검증한다. 현재 리뷰 환경에서는 `npm test`가 임시 디렉터리 생성 권한 제한(`EPERM`)으로 완료되지 않았다.